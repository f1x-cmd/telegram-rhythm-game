/**
 * Мелочи, общие для всех функций: разбор тела, ответы, единая форма ошибки.
 */

/** Vercel разбирает JSON сам, но при ручном вызове тело приходит потоком. */
async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body); } catch (_) { return null; }
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // Тело запроса к этим ручкам всегда маленькое; больше — значит мусор
    if (size > 16 * 1024) return null;
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { return null; }
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Ответы персональные и меняются после каждой партии
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function fail(res, status, reason) {
  send(res, status, { ok: false, error: reason });
}

/** Только POST: initData нельзя класть в query, он утечёт в логи и историю. */
function requirePost(req, res) {
  if (req.method === 'POST') return true;
  res.setHeader('Allow', 'POST');
  fail(res, 405, 'method not allowed');
  return false;
}

module.exports = { readJson, send, fail, requirePost };
