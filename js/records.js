/**
 * Личные рекорды по треку, режиму и сложности.
 * Хранятся в CloudStorage Telegram, с локальной копией в браузере.
 */

import { storage } from './telegram.js';

const KEY = 'records_v1';

let table = {};
let loaded = false;

function makeKey(modeId, trackId, difficulty) {
  return `${modeId}|${trackId}|${modeId === 'drive' ? difficulty : 'zen'}`;
}

export async function loadRecords() {
  if (loaded) return table;
  const raw = await storage.get(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') table = parsed;
    } catch (_) {
      table = {};
    }
  }
  loaded = true;
  return table;
}

export function bestFor(modeId, trackId, difficulty) {
  return table[makeKey(modeId, trackId, difficulty)] ?? 0;
}

/**
 * Записывает результат, если он лучше прежнего.
 * @returns {{isRecord: boolean, previous: number, best: number}}
 */
export function submit(modeId, trackId, difficulty, score) {
  const key = makeKey(modeId, trackId, difficulty);
  const previous = table[key] ?? 0;
  if (score <= previous) return { isRecord: false, previous, best: previous };

  table[key] = score;
  storage.set(KEY, JSON.stringify(table));
  return { isRecord: true, previous, best: score };
}
