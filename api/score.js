/**
 * POST /api/score — приём результата партии.
 *
 * Всё, что приходит от клиента, считается недоверенным. Личность игрока берётся
 * только из подписи Telegram, сумма очков за всё время накапливается на сервере
 * (ZINCRBY), а не присылается клиентом — иначе достаточно было бы отправить
 * «моя сумма за всё время = миллиард», минуя проверку одной партии.
 */

const { verifyInitData } = require('./_lib/telegram');
const { checkRun } = require('./_lib/guard');
const { cmd, pipeline, configured } = require('./_lib/store');
const { TOTAL_KEY, chartKey, userKey, dauKey, today } = require('./_lib/boards');
const { readJson, send, fail, requirePost } = require('./_lib/http');

/** Пауза между записями от одного игрока: трек длиннее двух минут. */
const COOLDOWN_SEC = 10;

/** Сколько держать дневные срезы: хватает на график за месяц с запасом. */
const DAU_TTL_SEC = 45 * 24 * 60 * 60;

module.exports = async function handler(req, res) {
  if (!requirePost(req, res)) return;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return fail(res, 503, 'bot token not configured');
  if (!configured()) return fail(res, 503, 'store not configured');

  const body = await readJson(req);
  if (!body) return fail(res, 400, 'bad json');

  const user = verifyInitData(body.initData, token);
  if (!user) return fail(res, 401, 'bad signature');

  const checked = checkRun(body.run);
  if (!checked.ok) return fail(res, 422, checked.reason);
  const run = checked.run;

  try {
    // Ограничение частоты: NX не даст перезаписать живой ключ
    const allowed = await cmd('SET', `rl:${user.id}`, '1', 'NX', 'EX', COOLDOWN_SEC);
    if (allowed === null) return fail(res, 429, 'too soon');

    const chart = chartKey(run.mode, run.track, run.difficulty);
    const day = dauKey(today());

    await pipeline([
      // Сумма за всё время — накапливается здесь, клиент её не диктует
      ['ZINCRBY', TOTAL_KEY, run.score, user.id],
      // Личный рекорд на карте: GT обновит, только если результат выше
      ['ZADD', chart, 'GT', 'CH', run.score, user.id],
      ['HSET', userKey(user.id), 'name', user.name, 'photo', user.photo || '', 'at', Date.now()],
      ['SADD', day, user.id],
      ['EXPIRE', day, DAU_TTL_SEC],
      ['HINCRBY', 'stats', 'plays', 1],
      ['HINCRBY', 'stats', `plays:${run.mode}`, 1],
      ['HINCRBY', 'stats', run.failed ? 'failed' : 'cleared', 1],
      ['HINCRBY', 'stats', `track:${run.track}`, 1],
    ]);

    const [place, total, best] = await pipeline([
      ['ZREVRANK', TOTAL_KEY, user.id],
      ['ZSCORE', TOTAL_KEY, user.id],
      ['ZSCORE', chart, user.id],
    ]);

    return send(res, 200, {
      ok: true,
      place: place === null || place === undefined ? null : Number(place) + 1,
      total: Math.round(Number(total) || 0),
      best: Math.round(Number(best) || 0),
    });
  } catch (error) {
    // Не роняем партию из-за хранилища: результат уже показан игроку локально
    console.error('score:', error && error.message);
    return fail(res, 502, 'store unavailable');
  }
};
