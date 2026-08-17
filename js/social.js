/**
 * Социальный слой кабинета: друзья, клан, общая таблица сети.
 * Без сервера таблица растёт через startapp-ссылки Telegram:
 * друг открыл инвайт — появился у него; он прислал вызов — появился у вас.
 */

import { storage, peekLocal, getUser, getStartParam, shareResult } from './telegram.js';
import { TELEGRAM_APP, leagueFor, titleFor, skillRating } from './config.js';
import { career } from './career.js';
import { t, formatNumber } from './i18n.js';

const KEY = 'social_v1';
const ID_KEY = 'player_id';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let state = {
  friends: [],
  clan: null, // { code, name, role, members: [] }
  network: [], // игроки из вызовов — «общий» рейтинг вашей сети
};
let loaded = false;
let pendingToast = '';

function persist() {
  storage.set(KEY, JSON.stringify(state));
}

function guestId() {
  let id = peekLocal(ID_KEY);
  if (id) return id;
  id = `g${Math.random().toString(36).slice(2, 10)}`;
  try { window.localStorage.setItem(ID_KEY, id); } catch (_) { /* */ }
  storage.set(ID_KEY, id);
  return id;
}

export function me() {
  const user = getUser();
  return {
    id: user.id ? String(user.id) : guestId(),
    name: user.name || 'Player',
    photo: user.photo,
    username: user.username || '',
    self: true,
  };
}

function selfEntry() {
  const player = me();
  return {
    id: player.id,
    name: player.name,
    photo: player.photo,
    username: player.username,
    score: career().totalScore,
    self: true,
  };
}

function upsert(list, entry) {
  const next = {
    id: String(entry.id),
    name: entry.name || 'Player',
    photo: entry.photo || null,
    username: entry.username || '',
    score: Math.max(0, Number(entry.score) || 0),
    updatedAt: Date.now(),
  };
  const index = list.findIndex((item) => item.id === next.id);
  if (index >= 0) {
    const prev = list[index];
    list[index] = {
      ...prev,
      ...next,
      name: next.name !== 'Player' ? next.name : prev.name,
      photo: next.photo || prev.photo,
      score: Math.max(prev.score || 0, next.score),
    };
  } else {
    list.push(next);
  }
}

function ranked(list) {
  const self = selfEntry();
  const map = new Map();
  map.set(self.id, self);
  for (const item of list) {
    if (item.id === self.id) continue;
    map.set(item.id, { ...item, self: false });
  }
  const rows = [...map.values()].sort((a, b) => b.score - a.score || (Number(b.self) - Number(a.self)) || a.name.localeCompare(b.name));
  return rows.map((row, index) => ({ ...row, place: index + 1, total: rows.length }));
}

function myPlace(rows) {
  const mine = rows.find((row) => row.self);
  return mine ? mine.place : rows.length || 1;
}

function makeClanCode() {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

function appUrl(startParam) {
  if (!TELEGRAM_APP.bot || !TELEGRAM_APP.app) return '';
  const query = startParam ? `?startapp=${encodeURIComponent(startParam)}` : '';
  return `https://t.me/${TELEGRAM_APP.bot}/${TELEGRAM_APP.app}${query}`;
}

export function invitePayload(kind = 'friend') {
  const player = selfEntry();
  if (kind === 'clan' && state.clan) {
    return `k${state.clan.code}_${player.id}_${player.score}`;
  }
  if (kind === 'challenge') {
    return `c${player.id}_${player.score}`;
  }
  return `f${player.id}_${player.score}`;
}

export function shareInvite(kind = 'friend') {
  const payload = invitePayload(kind);
  const url = appUrl(payload);
  const text = kind === 'clan' && state.clan
    ? t('profile.shareClanText', { clan: state.clan.name, code: state.clan.code, score: formatNumber(selfEntry().score) })
    : kind === 'challenge'
      ? t('profile.challengeText', { name: me().name, score: formatNumber(selfEntry().score) })
      : t('profile.inviteText', { name: me().name, score: formatNumber(selfEntry().score) });

  const body = url ? text : `${text}\n${t('profile.inviteCode', { code: payload })}`;
  const shared = shareResult(body, url || undefined);
  return { shared, payload, url };
}

export async function loadSocial() {
  if (!loaded) {
    const raw = await storage.get(KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          state.friends = Array.isArray(parsed.friends) ? parsed.friends : [];
          state.network = Array.isArray(parsed.network) ? parsed.network : [];
          state.clan = parsed.clan && typeof parsed.clan === 'object' ? parsed.clan : null;
        }
      } catch (_) { /* */ }
    }
    loaded = true;
  }

  const start = getStartParam();
  if (start) applyStartParam(start);
  return snapshot();
}

function applyStartParam(raw) {
  const param = String(raw).trim();
  const self = me();

  let match = param.match(/^f([A-Za-z0-9]+)(?:_(\d+))?$/);
  if (match && match[1] !== self.id) {
    const entry = { id: match[1], name: t('profile.friend'), score: Number(match[2]) || 0 };
    upsert(state.friends, entry);
    upsert(state.network, entry);
    pendingToast = 'profile.toastFriend';
    persist();
    return;
  }

  match = param.match(/^c([A-Za-z0-9]+)_(\d+)$/);
  if (match && match[1] !== self.id) {
    const entry = { id: match[1], name: t('profile.rival'), score: Number(match[2]) || 0 };
    upsert(state.network, entry);
    upsert(state.friends, entry);
    pendingToast = 'profile.toastChallenge';
    persist();
    return;
  }

  match = param.match(/^k([A-Z0-9]{4})(?:_([A-Za-z0-9]+)_(\d+))?$/i);
  if (match) {
    const code = match[1].toUpperCase();
    if (!state.clan || state.clan.code !== code) {
      state.clan = { code, name: code, role: 'member', members: [] };
    }
    if (match[2] && match[2] !== self.id) {
      upsert(state.clan.members, { id: match[2], name: t('profile.member'), score: Number(match[3]) || 0 });
      upsert(state.network, { id: match[2], name: t('profile.member'), score: Number(match[3]) || 0 });
    }
    pendingToast = 'profile.toastClan';
    persist();
  }
}

export function takeToast() {
  const key = pendingToast;
  pendingToast = '';
  return key;
}

/** Обновляет свою строку в клане после партии. */
export function syncSelfScore() {
  if (!state.clan) return;
  upsert(state.clan.members, selfEntry());
  persist();
}

export function createClan(name) {
  const trimmed = String(name || '').trim().slice(0, 18);
  if (!trimmed) return null;
  const self = selfEntry();
  state.clan = {
    code: makeClanCode(),
    name: trimmed,
    role: 'leader',
    members: [{ id: self.id, name: self.name, photo: self.photo, score: self.score }],
  };
  persist();
  return state.clan;
}

export function joinClan(code) {
  const clean = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (clean.length < 4) return null;
  if (!state.clan || state.clan.code !== clean) {
    state.clan = { code: clean, name: clean, role: 'member', members: [] };
  }
  upsert(state.clan.members, selfEntry());
  persist();
  return state.clan;
}

export function leaveClan() {
  state.clan = null;
  persist();
}

export function snapshot() {
  const stats = career();
  const player = me();
  const league = leagueFor(stats.totalScore);
  const title = titleFor(stats.totalScore);
  const rating = skillRating(stats);

  const globalRows = ranked([...state.network, ...state.friends, ...(state.clan?.members ?? [])]);
  const friendRows = ranked(state.friends);
  const clanRows = state.clan ? ranked(state.clan.members) : [];

  return {
    player,
    stats,
    league,
    title,
    rating,
    global: { rows: globalRows, place: myPlace(globalRows), size: globalRows.length },
    friends: { rows: friendRows, place: myPlace(friendRows), size: friendRows.length },
    clan: state.clan
      ? {
        ...state.clan,
        rows: clanRows,
        place: myPlace(clanRows),
        size: clanRows.length,
      }
      : null,
  };
}

export function socialDump() {
  return {
    friends: state.friends,
    clan: state.clan,
    network: state.network,
  };
}
