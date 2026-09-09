/**
 * Upstash Redis через HTTP.
 *
 * Обычный драйвер с TCP-подключением в serverless плох: каждая функция живёт
 * миллисекунды, а пул соединений не успевает переиспользоваться. REST-протокол
 * Upstash — это просто fetch, поэтому лишних подключений не остаётся.
 *
 * Имена переменных зависят от префикса, выбранного при подключении
 * интеграции, поэтому они подбираются, а не задаются жёстко — см. credentials().
 */

/** Пары имён, которые ставят известные интеграции. */
const KNOWN = [
  ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
  ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
];

const URL_SUFFIX = '_REST_API_URL';
const TOKEN_SUFFIX = '_REST_API_TOKEN';

/**
 * Находит адрес и токен хранилища.
 *
 * Интеграция Vercel разрешает выбрать произвольный префикс переменных, поэтому
 * жёсткий список имён — это ловушка: с префиксом STORAGE появится
 * STORAGE_REST_API_URL, и подключение молча не найдётся. Если известные имена
 * не подошли, подбираем любой префикс, но обязательно берём адрес и токен от
 * одного и того же — иначе при двух хранилищах склеим половинки от разных.
 *
 * Берём только `*_REST_API_URL`: переменная `*_URL` у Upstash содержит строку
 * вида redis://, а по ней fetch не сходит.
 */
function credentials() {
  for (const [urlName, tokenName] of KNOWN) {
    if (process.env[urlName] && process.env[tokenName]) {
      return { url: clean(process.env[urlName]), token: process.env[tokenName] };
    }
  }
  for (const key of Object.keys(process.env)) {
    if (!key.endsWith(URL_SUFFIX) || !process.env[key]) continue;
    const tokenName = `${key.slice(0, -URL_SUFFIX.length)}${TOKEN_SUFFIX}`;
    if (process.env[tokenName]) {
      return { url: clean(process.env[key]), token: process.env[tokenName] };
    }
  }
  return { url: '', token: '' };
}

function clean(value) {
  return String(value).replace(/\/+$/, '');
}

/** Хранилище не подключено — вызывающий код должен ответить 503, а не упасть. */
function configured() {
  const { url, token } = credentials();
  return Boolean(url && token);
}

async function request(path, body) {
  const { url: base, token } = credentials();
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
