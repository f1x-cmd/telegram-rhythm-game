/**
 * Ключи Redis и чтение таблиц. Вынесено отдельно, чтобы /api/score и
 * /api/leaderboard считали место игрока по одной и той же логике.
 */

const { cmd, pipeline } = require('./store');

/** Сумма очков за всё время — её ведёт сервер, клиент свою не присылает. */
const TOTAL_KEY = 'lb:total';

/** Лучший результат на конкретной карте: режим + трек + сложность. */
function chartKey(mode, track, difficulty) {
  return `lb:c:${mode}:${track}:${difficulty}`;
}

function userKey(id) {
  return `u:${id}`;
}

function dauKey(date) {
  return `dau:${date}`;
}

/** YYYY-MM-DD по UTC: сервер не должен зависеть от часового пояса игрока. */
function today(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Топ игроков с именами и, если известен id, местом самого игрока.
 * @returns {{rows: Array, me: object|null, size: number}}
 */
async function readBoard(key, limit, selfId) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));

  const [raw, size] = await pipeline([
    ['ZREVRANGE', key, 0, safeLimit - 1, 'WITHSCORES'],
    ['ZCARD', key],
  ]);

  const flat = Array.isArray(raw) ? raw : [];
  const entries = [];
  for (let i = 0; i < flat.length; i += 2) {
    entries.push({ id: String(flat[i]), score: Math.round(Number(flat[i + 1]) || 0) });
  }

  // Имена и аватары — одним запросом, иначе на 50 строк выйдет 50 round-trip
  const profiles = entries.length
    ? await pipeline(entries.map((entry) => ['HMGET', userKey(entry.id), 'name', 'photo']))
    : [];

  const rows = entries.map((entry, index) => {
    const profile = Array.isArray(profiles[index]) ? profiles[index] : [];
    return {
      place: index + 1,
      name: profile[0] || 'Player',
      photo: profile[1] || null,
      score: entry.score,
      self: selfId ? entry.id === String(selfId) : false,
    };
  });

  let me = null;
  if (selfId) {
    const [rank, score] = await pipeline([
      ['ZREVRANK', key, String(selfId)],
      ['ZSCORE', key, String(selfId)],
    ]);
    if (rank !== null && rank !== undefined) {
      me = { place: Number(rank) + 1, score: Math.round(Number(score) || 0) };
    }
  }

  return { rows, me, size: Number(size) || rows.length };
}

/** Место игрока в общей таблице после записи результата. */
async function placeOf(key, id) {
  const rank = await cmd('ZREVRANK', key, String(id));
  return rank === null || rank === undefined ? null : Number(rank) + 1;
}

module.exports = { TOTAL_KEY, chartKey, userKey, dauKey, today, readBoard, placeOf };
