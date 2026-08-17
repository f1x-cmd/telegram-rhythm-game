/**
 * Цель дня: одно задание на календарные сутки с накопительным прогрессом.
 * Календарная дата берётся из системных часов — это не игровой тайминг,
 * поэтому на синхронизацию с музыкой не влияет.
 */

import { storage } from './telegram.js';
import { t, formatNumber } from './i18n.js';
import { dailyTargets, forcedDailyId } from './liveops.js';

const KEY = 'daily_v1';

const BASE_GOALS = [
  { id: 'notes',   metric: 'notes',   target: 220 },
  { id: 'score',   metric: 'score',   target: 120000 },
  { id: 'combo',   metric: 'combo',   target: 60, best: true },
  { id: 'perfect', metric: 'perfect', target: 120 },
  { id: 'flow',    metric: 'flow',    target: 3 },
];

function pool() {
  const targets = dailyTargets();
  return BASE_GOALS.map((goal) => ({
    ...goal,
    target: Number(targets[goal.id]) || goal.target,
  }));
}

let state = { date: '', goalId: BASE_GOALS[0].id, progress: 0, done: false };
let loaded = false;

function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Стабильный выбор задания по строке даты. */
function goalForDate(date) {
  let hash = 0;
  for (let i = 0; i < date.length; i++) hash = (hash * 31 + date.charCodeAt(i)) >>> 0;
  const goals = pool();
  const forced = forcedDailyId();
  if (forced) {
    return goals.find((item) => item.id === forced) ?? goals[0];
  }
  return goals[hash % goals.length];
}

function reset(date) {
  state = { date, goalId: goalForDate(date).id, progress: 0, done: false };
}

export async function loadDaily() {
  if (!loaded) {
    const raw = await storage.get(KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') state = { ...state, ...parsed };
      } catch (_) { /* повреждённая запись — начнём заново */ }
    }
    loaded = true;
  }
  const date = today();
  if (state.date !== date) reset(date);
  return status();
}

export function status() {
  const date = today();
  if (state.date !== date) reset(date);

  const goals = pool();
  const goal = goals.find((item) => item.id === state.goalId) ?? goals[0];
  return {
    id: goal.id,
    // Заголовок собирается при каждом чтении, чтобы отражать текущий язык
    title: t(`goal.${goal.id}`, { target: formatNumber(goal.target) }),
    target: goal.target,
    progress: Math.min(state.progress, goal.target),
    done: state.done,
    ratio: Math.min(1, state.progress / goal.target),
  };
}

/**
 * Зачитывает результат партии в прогресс дня.
 * @param {{metrics: Record<string, number>}} stats
 * @returns {{justCompleted: boolean} & ReturnType<typeof status>}
 */
export function addResult(stats) {
  const goals = pool();
  const goal = goals.find((item) => item.id === state.goalId) ?? goals[0];
  const value = stats.metrics?.[goal.metric] ?? 0;

  // Комбо не суммируется — считаем лучший результат за день
  state.progress = goal.best
    ? Math.max(state.progress, value)
    : state.progress + value;

  const wasDone = state.done;
  state.done = state.progress >= goal.target;
  storage.set(KEY, JSON.stringify(state));

  return { ...status(), justCompleted: state.done && !wasDone };
}

export function dailyPool() {
  return pool();
}

/** Админка: сменить сегодняшнее задание и обнулить прогресс. */
export function adminSetGoal(id) {
  const goals = pool();
  const goal = goals.find((item) => item.id === id);
  if (!goal) return status();
  state = { date: today(), goalId: goal.id, progress: 0, done: false };
  storage.set(KEY, JSON.stringify(state));
  return status();
}
