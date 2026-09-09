/**
 * Общая таблица лидеров: единственная часть игры, которая знает про сервер.
 *
 * Всё здесь необязательно. Нет сети, нет функций, игра открыта вне Telegram —
 * модуль молча отключается, а игра работает как раньше на локальных рекордах.
 * Партию нельзя терять из-за таблицы лидеров.
 */

import { getInitData } from './telegram.js';

const SCORE_URL = '/api/score';
const BOARD_URL = '/api/leaderboard';
const STATS_URL = '/api/stats';

/** Сервер отвечает быстро или не отвечает вовсе: экран результата не ждёт. */
const TIMEOUT_MS = 6000;

/** Что сервер сказал в последний раз — чтобы не долбиться в отсутствующий бэкенд. */
let reachable = null; // null — ещё не знаем, true/false — знаем

async function post(url, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    // Ручки нет, метод не поддержан или хранилище не подключено — бэкенда для
    // нас не существует, больше не зовём. Статический сервер отвечает 405,
    // а не 404, поэтому одного 404 в этом списке недостаточно.
    if ([404, 405, 501, 503].includes(response.status)) {
      reachable = false;
      return null;
    }

    const data = await response.json().catch(() => null);
    // Бэкенд считается живым только когда ответил своим форматом. Осмысленный
    // отказ (401, 422, 429) — тоже признак жизни, в отличие от чужой страницы.
    if (data && typeof data.ok === 'boolean') reachable = true;
    if (!data || data.ok !== true) return null;
    return data;
  } catch (_) {
    // Таймаут или обрыв связи. Флаг не трогаем: сеть могла пропасть на минуту,
    // и запирать таблицу лидеров до перезапуска игры из-за этого неправильно.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Известно ли, что бэкенда нет. Пока null — стоит попробовать. */
export function backendOff() {
  return reachable === false;
}

/**
 * Отправляет результат партии. Возвращает место в общей таблице или null.
 * Сумму очков за всё время считает сервер — здесь её не отправляем, чтобы
 * не создавать соблазн подделать.
 */
export async function submitRun(stats, context) {
  if (backendOff()) return null;
  const initData = getInitData();
  if (!initData) return null; // вне Telegram подписать результат нечем

  return post(SCORE_URL, {
    initData,
    run: {
      mode: stats.mode,
      track: context.track,
      difficulty: context.difficulty,
      score: Math.round(stats.score || 0),
      notes: Math.round(stats.total || 0),
      maxCombo: Math.round(stats.maxCombo || 0),
      accuracy: Number(stats.accuracy) || 0,
      durationSec: Math.round(context.durationSec || 0),
      failed: Boolean(stats.failed),
    },
  });
}

/**
 * Таблица лидеров в форме, которую ждёт кабинет.
 * @returns {{rows: Array, place: number, size: number}|null}
 */
export async function fetchBoard(options = {}) {
  if (backendOff()) return null;
  const data = await post(BOARD_URL, {
    // Подпись необязательна: без неё таблица придёт без отметки «вы»
    initData: getInitData(),
    board: options.board === 'chart' ? 'chart' : 'total',
    mode: options.mode,
    track: options.track,
    difficulty: options.difficulty,
    limit: options.limit ?? 50,
  });
  if (!data) return null;

  const rows = Array.isArray(data.rows) ? data.rows : [];
  return {
    rows,
    size: Number(data.size) || rows.length,
    place: data.me ? data.me.place : (rows.find((row) => row.self)?.place ?? 0),
    remote: true,
  };
}

/** Сводка для консоли оператора. Сервер сам решает, кого пускать. */
export async function fetchStats() {
  const initData = getInitData();
  if (!initData) return null;
  return post(STATS_URL, { initData });
}
