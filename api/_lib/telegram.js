/**
 * Проверка подписи Telegram initData.
 *
 * Единственное, что отделяет таблицу лидеров от мусора: без этой проверки
 * любой человек отправит в /api/score запрос с чужим id и счётом 999999999,
 * даже не открывая игру. Клиенту здесь не верят ни в одном байте — id игрока
 * берётся только из подписанных данных, а не из тела запроса.
 *
 * Алгоритм из документации Telegram Mini Apps:
 *   secret       = HMAC_SHA256(key = "WebAppData", msg = bot_token)
 *   expected     = HMAC_SHA256(key = secret, msg = data_check_string)
 *   data_check_string — пары "key=value" без hash, отсортированные по ключу,
 *   склеенные через \n.
 */

const crypto = require('crypto');

/** Сколько живёт подпись. Telegram переоткрывает Mini App и обновляет её. */
const MAX_AGE_SEC = 24 * 60 * 60;

/**
 * @param {string} initData строка из Telegram.WebApp.initData
 * @param {string} botToken токен бота из переменной окружения
 * @returns {{id: string, name: string, photo: string|null, authDate: number}|null}
 *          null — подпись не сошлась, устарела или в данных нет пользователя
 */
function verifyInitData(initData, botToken) {
  if (typeof initData !== 'string' || !initData || !botToken) return null;

  let params;
  try {
    params = new URLSearchParams(initData);
  } catch (_) {
    return null;
  }

  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  // Сортируем строго по ключу: сортировка склеенных пар даёт другой порядок,
  // если один ключ является префиксом другого перед цифрой.
  const dataCheckString = [...params.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  // Сравнение за постоянное время: побайтовое сравнение подсказывает атакующему,
  // сколько символов он угадал.
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(hash, 'hex');
  if (left.length !== right.length || left.length === 0) return null;
  if (!crypto.timingSafeEqual(left, right)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  const age = Math.floor(Date.now() / 1000) - authDate;
  // Отрицательный возраст — часы игрока в будущем; небольшой запас допустим
  if (age > MAX_AGE_SEC || age < -300) return null;

  let user;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch (_) {
    return null;
  }
  if (!user || user.id === undefined || user.id === null) return null;

  return {
    id: String(user.id),
    name: String(user.first_name || user.username || 'Player').slice(0, 32),
    photo: typeof user.photo_url === 'string' ? user.photo_url.slice(0, 300) : null,
    authDate,
  };
}

module.exports = { verifyInitData, MAX_AGE_SEC };
