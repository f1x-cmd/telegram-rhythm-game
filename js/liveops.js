/**
 * LiveOps: настройки, которые админка пишет, а игра читает на старте.
 * Хранится локально (CloudStorage / localStorage) — без сервера это контур
 * этого устройства. JSON можно выгрузить и залить на другое.
 */

import { storage } from './telegram.js';
import {
  TRACKS, DONATE, TELEGRAM_APP, DRIVE_DIFFICULTY, RELAX,
  SHIELD_TIME, SHIELD_MISSES,
} from './config.js';

const KEY = 'liveops_v1';

const DEFAULTS = {
  maintenance: false,
  maintenanceText: '',
  banner: '',
  featuredMode: '',
  eventName: '',
  eventMult: 1,
  eventUntil: '',
  disabledTracks: [],
  allowUpload: true,
  allowDonate: true,
  donatePacks: [50, 150, 500],
  donateUrl: '',
  donateBot: '',
  telegramBot: 'rhythm_game_play_bot',
  telegramApp: 'rhythm',
  forceDaily: '',
  dailyTargets: { notes: 220, score: 120000, combo: 60, perfect: 120, flow: 3 },
  nps: { easy: 2, medium: 3.4, hard: 6, relax: 1.5 },
  shieldTime: 15,
  shieldMisses: 3,
  bans: [],
  audit: [],
};

let state = { ...DEFAULTS, dailyTargets: { ...DEFAULTS.dailyTargets }, nps: { ...DEFAULTS.nps } };
let loaded = false;
let customNps = false;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const CONFIG_BOT = TELEGRAM_APP.bot;
const CONFIG_APP = TELEGRAM_APP.app;

function applyRuntime() {
  TELEGRAM_APP.bot = state.telegramBot || CONFIG_BOT || '';
  TELEGRAM_APP.app = state.telegramApp || CONFIG_APP || 'rhythm';
  DONATE.packs = Array.isArray(state.donatePacks) && state.donatePacks.length
    ? state.donatePacks.map(Number).filter((n) => n > 0)
    : [...DEFAULTS.donatePacks];
  DONATE.url = state.donateUrl || '';
  DONATE.bot = state.donateBot || '';

  if (customNps) {
    DRIVE_DIFFICULTY.easy.nps = Number(state.nps.easy) || DRIVE_DIFFICULTY.easy.nps;
    DRIVE_DIFFICULTY.medium.nps = Number(state.nps.medium) || DRIVE_DIFFICULTY.medium.nps;
    DRIVE_DIFFICULTY.hard.nps = Number(state.nps.hard) || DRIVE_DIFFICULTY.hard.nps;
    RELAX.nps = Number(state.nps.relax) || RELAX.nps;
  }

  // щит — экспортированные константы нельзя переприсвоить снаружи модуля,
  // поэтому читаем через getters ниже; здесь только нормализуем числа
  state.shieldTime = Math.max(0, Number(state.shieldTime) || 0);
  state.shieldMisses = Math.max(0, Number(state.shieldMisses) || 0);
}

export async function loadLiveOps(options = {}) {
  const force = options?.force === true;
  if (loaded && !force) {
    applyRuntime();
    return state;
  }
  const raw = await storage.get(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        state = {
          ...DEFAULTS,
          ...parsed,
          dailyTargets: { ...DEFAULTS.dailyTargets, ...(parsed.dailyTargets || {}) },
          nps: { ...DEFAULTS.nps, ...(parsed.nps || {}) },
          disabledTracks: Array.isArray(parsed.disabledTracks) ? parsed.disabledTracks : [],
          bans: Array.isArray(parsed.bans) ? parsed.bans : [],
          donatePacks: Array.isArray(parsed.donatePacks) ? parsed.donatePacks : [...DEFAULTS.donatePacks],
          audit: Array.isArray(parsed.audit) ? parsed.audit.slice(-80) : [],
        };
        customNps = Boolean(parsed.nps) && !(
          Number(parsed.nps.easy) === 2
          && Number(parsed.nps.medium) === 3.4
          && Number(parsed.nps.hard) === 6
        );
      }
    } catch (_) { /* битый JSON — заводские значения */ }
  }
  loaded = true;
  applyRuntime();
  return state;
}

export function liveops() {
  return state;
}

export function saveLiveOps(patch, who = 'admin') {
  if (patch?.nps) customNps = true;
  state = {
    ...state,
    ...patch,
    dailyTargets: { ...state.dailyTargets, ...(patch.dailyTargets || {}) },
    nps: { ...state.nps, ...(patch.nps || {}) },
  };
  const note = patch._audit || 'update';
  delete state._audit;
  state.audit = [
    { at: Date.now(), who, note },
    ...(state.audit || []),
  ].slice(0, 80);
  applyRuntime();
  storage.set(KEY, JSON.stringify(state));
  return state;
}

export function resetLiveOps() {
  customNps = false;
  state = clone(DEFAULTS);
  applyRuntime();
  storage.set(KEY, JSON.stringify(state));
  return state;
}

export function activeTracks() {
  const hidden = new Set(state.disabledTracks || []);
  return TRACKS.filter((track) => !hidden.has(track.id));
}

/** Официальные треки, подходящие режиму RELAX / DRIVE. */
export function tracksForMode(modeId) {
  return activeTracks().filter((track) => track.mood === 'both' || track.mood === modeId);
}

export function isTrackOn(id) {
  return !(state.disabledTracks || []).includes(id);
}

export function scoreMultiplier() {
  const mult = Number(state.eventMult) || 1;
  if (mult === 1) return 1;
  if (!state.eventUntil) return Math.max(1, mult);
  const until = Date.parse(state.eventUntil);
  if (!Number.isFinite(until) || Date.now() > until) return 1;
  return Math.max(1, mult);
}

/** Активный ивент для баннера меню (без истёкших дат). */
export function activeEvent() {
  const mult = scoreMultiplier();
  if (mult <= 1) return null;
  return {
    name: state.eventName || '',
    mult,
    until: state.eventUntil || '',
  };
}

export function shieldConfig() {
  return {
    time: Number(state.shieldTime) || SHIELD_TIME,
    misses: Number(state.shieldMisses) || SHIELD_MISSES,
  };
}

export function dailyTargets() {
  return state.dailyTargets;
}

export function forcedDailyId() {
  return state.forceDaily || '';
}

export function isBanned(id) {
  if (!id) return false;
  return (state.bans || []).includes(String(id));
}

export function donateRuntime() {
  return {
    packs: DONATE.packs,
    invoices: DONATE.invoices,
    url: DONATE.url,
    bot: DONATE.bot,
  };
}

export function exportLiveOps() {
  return JSON.stringify(state, null, 2);
}

export function importLiveOps(json, who = 'admin') {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object') throw new Error('invalid');
  return saveLiveOps({ ...parsed, _audit: 'import json' }, who);
}
