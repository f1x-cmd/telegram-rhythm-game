/**
 * POST /api/leaderboard — топ игроков и место запросившего.
 *
 * POST, а не GET: initData содержит данные пользователя, а такому не место
 * в query-строке — она попадает в логи, историю и Referer.
 *
 * Подпись здесь необязательна: таблицу можно посмотреть и без неё, просто без
 * отметки «вы». Если подпись пришла и не сошлась — тихо игнорируем, а не
 * отказываем: игрок не виноват, что она устарела, пока он играл.
 */

const { verifyInitData } = require('./_lib/telegram');
const { configured } = require('./_lib/store');
const { TOTAL_KEY, chartKey, readBoard } = require('./_lib/boards');
const { normalizeTrack } = require('./_lib/guard');
const { readJson, send, fail, requirePost } = require('./_lib/http');

module.exports = async function handler(req, res) {
  if (!requirePost(req, res)) return;
  if (!configured()) return fail(res, 503, 'store not configured');

  const body = await readJson(req);
  if (!body) return fail(res, 400, 'bad json');

  let selfId = null;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (body.initData && token) {
    const user = verifyInitData(body.initData, token);
    if (user) selfId = user.id;
  }

  const key = body.board === 'chart'
    ? chartKey(
      body.mode === 'drive' ? 'drive' : 'relax',
      normalizeTrack(body.track),
      ['easy', 'medium', 'hard'].includes(body.difficulty) ? body.difficulty : 'zen',
    )
    : TOTAL_KEY;

  try {
    const board = await readBoard(key, body.limit, selfId);
    return send(res, 200, { ok: true, board: body.board === 'chart' ? 'chart' : 'total', ...board });
  } catch (error) {
    console.error('leaderboard:', error && error.message);
    return fail(res, 502, 'store unavailable');
  }
};
