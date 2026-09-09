/**
 * POST /api/stats — сводка для оператора: DAU, партии, треки.
 *
 * Доступ только по подписи Telegram и только для id из ADMIN_IDS. Список живёт
 * в переменной окружения, а не в коде игры: клиентский js/config.js виден всем,
 * и решать по нему, кого пускать к серверным данным, нельзя.
 */

const { verifyInitData } = require('./_lib/telegram');
const { pipeline, configured } = require('./_lib/store');
const { TOTAL_KEY, dauKey, today } = require('./_lib/boards');
const { readJson, send, fail, requirePost } = require('./_lib/http');

/** Сколько дней показывать в графике активности. */
const DAYS = 14;

function adminIds() {
  return String(process.env.ADMIN_IDS || '')
    .split(/[,;\s]+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

function lastDays(count) {
  const days = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    days.push(today(now - i * 24 * 60 * 60 * 1000));
  }
  return days;
}

module.exports = async function handler(req, res) {
  if (!requirePost(req, res)) return;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return fail(res, 503, 'bot token not configured');
  if (!configured()) return fail(res, 503, 'store not configured');

  const body = await readJson(req);
  if (!body) return fail(res, 400, 'bad json');

  const user = verifyInitData(body.initData, token);
  if (!user) return fail(res, 401, 'bad signature');

  const allowed = adminIds();
  // Пустой список означает «никому», а не «всем»
  if (!allowed.length || !allowed.includes(user.id)) return fail(res, 403, 'not an operator');

  const days = lastDays(DAYS);

  try {
    const replies = await pipeline([
      ['HGETALL', 'stats'],
      ['ZCARD', TOTAL_KEY],
      ...days.map((day) => ['SCARD', dauKey(day)]),
    ]);

    const flat = Array.isArray(replies[0]) ? replies[0] : [];
    const counters = {};
    for (let i = 0; i < flat.length; i += 2) {
      counters[String(flat[i])] = Number(flat[i + 1]) || 0;
    }

    const dau = {};
    days.forEach((day, index) => {
      dau[day] = Number(replies[2 + index]) || 0;
    });

    return send(res, 200, {
      ok: true,
      players: Number(replies[1]) || 0,
      plays: counters.plays || 0,
      byMode: { relax: counters['plays:relax'] || 0, drive: counters['plays:drive'] || 0 },
      cleared: counters.cleared || 0,
      failed: counters.failed || 0,
      byTrack: Object.fromEntries(
        Object.entries(counters)
          .filter(([key]) => key.startsWith('track:'))
          .map(([key, value]) => [key.slice(6), value]),
      ),
      dau,
      today: dau[days[0]] || 0,
    });
  } catch (error) {
    console.error('stats:', error && error.message);
    return fail(res, 502, 'store unavailable');
  }
};
