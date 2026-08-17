/**
 * Карьера игрока: сумма очков, стрик, лучшие показатели.
 * Это не тайминг игры — даты и счётчики живут в CloudStorage.
 */

import { storage } from './telegram.js';

const KEY = 'career_v1';

const EMPTY = {
  totalScore: 0,
  plays: 0,
  bestScore: 0,
  maxCombo: 0,
  perfects: 0,
  notes: 0,
  relaxPlays: 0,
  drivePlays: 0,
  streak: 0,
  bestStreak: 0,
  lastPlayDate: '',
};

let state = { ...EMPTY };
let loaded = false;

function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function yesterday() {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export async function loadCareer() {
  if (loaded) return state;
  const raw = await storage.get(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') state = { ...EMPTY, ...parsed };
    } catch (_) { /* битая запись */ }
  }
  loaded = true;
  return state;
}

export function career() {
  normalizeStreak();
  return state;
}

function normalizeStreak() {
  const date = today();
  if (!state.lastPlayDate) return;
  if (state.lastPlayDate !== date && state.lastPlayDate !== yesterday()) {
    if (state.streak !== 0) {
      state.streak = 0;
      storage.set(KEY, JSON.stringify(state));
    }
  }
}

/**
 * Зачитывает партию в карьеру. Стрик растёт за календарный день с игрой.
 * @param {{score: number, maxCombo: number, metrics?: Record<string, number>, mode?: string}} stats
 */
export function addCareer(stats) {
  const score = Math.max(0, stats.score || 0);
  state.totalScore += score;
  state.plays += 1;
  if (score > state.bestScore) state.bestScore = score;
  if ((stats.maxCombo || 0) > state.maxCombo) state.maxCombo = stats.maxCombo || 0;
  state.perfects += stats.metrics?.perfect || 0;
  state.notes += stats.metrics?.notes || 0;
  if (stats.mode === 'drive') state.drivePlays += 1;
  else state.relaxPlays += 1;

  const date = today();
  if (state.lastPlayDate === date) {
    // уже играли сегодня — стрик не трогаем
  } else if (state.lastPlayDate === yesterday()) {
    state.streak += 1;
  } else {
    state.streak = 1;
  }
  if (state.streak > state.bestStreak) state.bestStreak = state.streak;
  state.lastPlayDate = date;

  storage.set(KEY, JSON.stringify(state));
  return state;
}
