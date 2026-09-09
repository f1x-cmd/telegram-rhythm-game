/**
 * Обезличенные события в Vercel Web Analytics — единственный источник цифр
 * по всем игрокам сразу. Локальный журнал (telemetry.js) остаётся для админки
 * и по-прежнему видит только своё устройство.
 *
 * Сюда не попадают ни имена, ни ID, ни точные очки: аналитика умеет только
 * складывать одинаковые значения, поэтому уникальные числа сделали бы отчёт
 * бесполезным, а игрока — узнаваемым.
 */

/** Итоговый счёт зависит от длины трека, поэтому в отчёт идёт диапазон. */
function scoreBand(value) {
  const score = Number(value) || 0;
  if (score < 25000) return '<25k';
  if (score < 75000) return '25-75k';
  if (score < 150000) return '75-150k';
  if (score < 300000) return '150-300k';
  return '300k+';
}

/** Точность — главный сигнал для баланса: не слишком ли тяжело. */
function accuracyBand(value) {
  const pct = Math.round((Number(value) || 0) * 100);
  if (pct < 40) return '0-40%';
  if (pct < 60) return '40-60%';
  if (pct < 75) return '60-75%';
  if (pct < 88) return '75-88%';
  if (pct < 95) return '88-95%';
  return '95-100%';
}

/**
 * Досидел ли игрок до конца или бросил на первых секундах.
 * Подписи диапазонов — только ASCII: отбраковку не-ASCII значений на стороне
 * Vercel по документации не проверить, а терять события молча нельзя.
 */
function durationBand(value) {
  const sec = Number(value) || 0;
  if (sec < 15) return '<15s';
  if (sec < 45) return '15-45s';
  if (sec < 120) return '45-120s';
  return '120s+';
}

/**
 * Форма события для каждого типа. Все значения — из заранее известного
 * короткого набора, иначе группировка в отчёте развалится.
 */
const SHAPE = {
  play: (p) => ({
    mode: p.mode === 'drive' ? 'drive' : 'relax',
    // В RELAX сложности нет, выбранный чип к партии не относится
    difficulty: p.mode === 'drive' ? String(p.difficulty || 'medium') : 'zen',
    track: String(p.track || 'custom'),
    outcome: p.failed ? 'failed' : 'cleared',
    accuracy: accuracyBand(p.accuracy),
    score: scoreBand(p.score),
    duration: durationBand(p.durationSec),
  }),
  invite: (p) => ({
    kind: String(p.kind || 'friend'),
  }),
  donate: (p) => ({
    stars: Number(p.stars) || 0,
  }),
};

/**
 * Отправляет событие, если страница загрузила счётчик Vercel.
 * Вне продакшена (локальный сервер, admin.html) молча ничего не делает.
 */
export function trackEvent(type, payload = {}) {
  const shape = SHAPE[type];
  if (!shape) return;
  if (typeof window === 'undefined' || typeof window.va !== 'function') return;
  try {
    window.va('event', { name: type, data: shape(payload) });
  } catch (_) { /* счётчик недоступен — отчёт не важнее партии */ }
}
