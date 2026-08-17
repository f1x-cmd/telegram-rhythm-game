/**
 * Локальная телеметрия для админки.
 * Это не игровой тайминг: метки времени нужны отчётам LiveOps.
 */

import { storage, peekLocal } from './telegram.js';

const KEY = 'telemetry_v1';
const MAX = 250;

let events = [];
let loaded = false;

export async function loadTelemetry() {
  if (loaded) return events;
  const raw = await storage.get(KEY) ?? peekLocal(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) events = parsed.slice(-MAX);
    } catch (_) { events = []; }
  }
  loaded = true;
  return events;
}

export function logEvent(type, payload = {}) {
  events.push({ at: Date.now(), type, ...payload });
  if (events.length > MAX) events = events.slice(-MAX);
  storage.set(KEY, JSON.stringify(events));
}

export function telemetry() {
  return events;
}

export function clearTelemetry() {
  events = [];
  storage.set(KEY, '[]');
}

function dayKey(ts) {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

export function summarize() {
  const now = Date.now();
  const today = dayKey(now);
  const plays = events.filter((e) => e.type === 'play');
  const todayPlays = plays.filter((e) => dayKey(e.at) === today);
  const scores = plays.map((e) => Number(e.score) || 0);
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const best = scores.length ? Math.max(...scores) : 0;
  const byMode = { relax: 0, drive: 0 };
  const byTrack = {};
  for (const play of plays) {
    byMode[play.mode === 'drive' ? 'drive' : 'relax'] += 1;
    const id = play.track || 'custom';
    byTrack[id] = (byTrack[id] || 0) + 1;
  }
  const days = {};
  for (const play of plays) {
    const key = dayKey(play.at);
    days[key] = (days[key] || 0) + 1;
  }
  return {
    total: plays.length,
    today: todayPlays.length,
    avg,
    best,
    fails: plays.filter((e) => e.failed).length,
    invites: events.filter((e) => e.type === 'invite').length,
    donates: events.filter((e) => e.type === 'donate').length,
    byMode,
    byTrack,
    days,
    lastAt: events.length ? events[events.length - 1].at : 0,
  };
}
