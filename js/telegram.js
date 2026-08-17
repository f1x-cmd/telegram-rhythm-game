/**
 * Тонкая обёртка над Telegram WebApp SDK.
 * Все вызовы безопасны вне Telegram (обычный браузер).
 */

const sdk = typeof window !== 'undefined' ? window.Telegram?.WebApp ?? null : null;

// В обычном браузере SDK тоже загружается, но platform остаётся 'unknown'.
// Тогда не трогаем его API, чтобы не получать предупреждения в консоли.
const tg = sdk && sdk.platform && sdk.platform !== 'unknown' ? sdk : null;

export const isTelegram = Boolean(tg);

function supports(version) {
  if (!tg) return false;
  return typeof tg.isVersionAtLeast === 'function' ? tg.isVersionAtLeast(version) : false;
}

export function initTelegram() {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    tg.setHeaderColor?.('#08080f');
    tg.setBackgroundColor?.('#08080f');
    tg.disableVerticalSwipes?.();
  } catch (_) { /* старая версия клиента */ }
}

/**
 * Тактильный отклик.
 * @param {'light'|'medium'|'heavy'|'soft'|'rigid'|'error'|'success'|'warning'|'selection'} kind
 */
export function haptic(kind) {
  if (!kind || !supports('6.1')) return;
  const hf = tg?.HapticFeedback;
  if (!hf) return;
  try {
    if (kind === 'selection') hf.selectionChanged();
    else if (kind === 'error' || kind === 'success' || kind === 'warning') hf.notificationOccurred(kind);
    else hf.impactOccurred(kind);
  } catch (_) { /* вне Telegram */ }
}

export function getUser() {
  const user = tg?.initDataUnsafe?.user;
  if (!user) return { id: null, name: 'Player', photo: null };
  return {
    id: user.id ?? null,
    name: user.first_name || user.username || 'Player',
    photo: user.photo_url ?? null,
  };
}

/** Код языка из настроек Telegram, например 'ru' или 'pt-br'. */
export function getLanguage() {
  // initDataUnsafe — обычные данные, читаем их даже если platform === 'unknown'
  return (tg ?? sdk)?.initDataUnsafe?.user?.language_code ?? null;
}

function localGet(key) {
  try { return window.localStorage.getItem(key); } catch (_) { return null; }
}

/** Синхронное чтение локальной копии: нужно до первого кадра (язык интерфейса). */
export function peekLocal(key) {
  return localGet(key);
}

function localSet(key, value) {
  try { window.localStorage.setItem(key, value); } catch (_) { /* приватный режим */ }
}

/** Хранилище: CloudStorage в Telegram (6.9+), localStorage в браузере. */
export const storage = {
  get(key) {
    const cloud = supports('6.9') ? tg?.CloudStorage : null;
    if (!cloud?.getItem) return Promise.resolve(localGet(key));

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      // Страховка: если клиент не вызовет колбэк, читаем локальную копию
      setTimeout(() => finish(localGet(key)), 800);
      try {
        cloud.getItem(key, (err, value) => finish(err ? localGet(key) : (value ?? localGet(key))));
      } catch (_) {
        finish(localGet(key));
      }
    });
  },

  set(key, value) {
    const raw = String(value);
    localSet(key, raw); // локальная копия всегда, чтобы работало и без сети
    const cloud = supports('6.9') ? tg?.CloudStorage : null;
    if (!cloud?.setItem) return Promise.resolve(true);

    return new Promise((resolve) => {
      try { cloud.setItem(key, raw, () => resolve(true)); } catch (_) { resolve(true); }
    });
  },
};

/** Попытка поделиться результатом (доступно только внутри Telegram). */
export function shareResult(text) {
  if (!tg) return false;
  try {
    const url = `https://t.me/share/url?url=${encodeURIComponent('https://t.me')}&text=${encodeURIComponent(text)}`;
    tg.openTelegramLink?.(url);
    return true;
  } catch (_) {
    return false;
  }
}
