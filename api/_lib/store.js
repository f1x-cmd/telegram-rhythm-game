/**
 * Upstash Redis через HTTP.
 *
 * Обычный драйвер с TCP-подключением в serverless плох: каждая функция живёт
 * миллисекунды, а пул соединений не успевает переиспользоваться. REST-протокол
 * Upstash — это просто fetch, поэтому лишних подключений не остаётся.
 *
 * Переменные окружения ставит интеграция Vercel. Поддерживаем оба набора имён:
 * marketplace даёт KV_REST_API_*, прямая регистрация в Upstash — UPSTASH_*.
 */

const URL_ENV = ['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL'];
const TOKEN_ENV = ['KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN'];

function pick(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value.replace(/\/+$/, '');
  }
  return '';
}

/** Хранилище не подключено — вызывающий код должен ответить 503, а не упасть. */
function configured() {
  return Boolean(pick(URL_ENV) && pick(TOKEN_ENV));
}

async function request(path, body) {
  const base = pick(URL_ENV);
  const token = pick(TOKEN_ENV);
  if (!base || !token) throw new Error('store not configured');

  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`upstash ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

/** Одна команда: cmd('ZADD', 'lb:total', 'GT', 100, 'id'). */
async function cmd(...args) {
  const payload = await request('', args.map(String));
  if (payload && payload.error) throw new Error(`upstash: ${payload.error}`);
  return payload ? payload.result : null;
}

/**
 * Несколько команд одним запросом. Для serverless это важно: каждый лишний
 * round-trip к хранилищу — это задержка, которую ждёт игрок.
 * @param {Array<Array<string|number>>} commands
 */
async function pipeline(commands) {
  if (!commands.length) return [];
  const payload = await request('/pipeline', commands.map((c) => c.map(String)));
  if (!Array.isArray(payload)) throw new Error('upstash: unexpected pipeline reply');
  return payload.map((entry) => {
    if (entry && entry.error) throw new Error(`upstash: ${entry.error}`);
    return entry ? entry.result : null;
  });
}

module.exports = { cmd, pipeline, configured };
