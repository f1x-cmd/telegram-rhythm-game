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

/** Кнопка «Назад» Telegram — стандарт TMA для выхода из партии. */
export function showBackButton(visible) {
  if (!tg?.BackButton) return;
  try {
    if (visible) tg.BackButton.show();
    else tg.BackButton.hide();
  } catch (_) { /* */ }
}

export function onBackButton(handler) {
  if (!tg?.BackButton?.onClick) return;
  try {
    tg.BackButton.onClick(handler);
  } catch (_) { /* */ }
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
  const user = (tg ?? sdk)?.initDataUnsafe?.user;
  if (!user) return { id: null, name: 'Player', photo: null, username: '' };
  return {
    id: user.id ?? null,
    name: user.first_name || user.username || 'Player',
    photo: user.photo_url ?? null,
    username: user.username ? `@${user.username}` : '',
  };
}

/** startapp-параметр: из initData или из hash, которым SDK наполняет Mini App. */
export function getStartParam() {
  const fromInit = (tg ?? sdk)?.initDataUnsafe?.start_param;
  if (fromInit) return String(fromInit);
  try {
    const hash = window.location.hash || '';
    const match = hash.match(/tgWebAppStartParam=([^&]+)/);
    if (match) return decodeURIComponent(match[1]);
  } catch (_) { /* битый hash */ }
  return null;
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
export function shareResult(text, url) {
  if (!tg) {
    try { navigator.clipboard?.writeText(url ? `${text}\n${url}` : text); } catch (_) { /* */ }
    return false;
  }
  try {
    const target = url || 'https://t.me';
    const share = `https://t.me/share/url?url=${encodeURIComponent(target)}&text=${encodeURIComponent(text)}`;
    tg.openTelegramLink?.(share);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Открывает инвойс Stars или запасную ссылку доната.
 * @returns {'invoice'|'link'|'copy'}
 */
export function openDonate(stars, options = {}) {
  const invoice = options.invoices?.[stars];
  if (invoice && typeof tg?.openInvoice === 'function') {
    try {
      tg.openInvoice(invoice, () => {});
      return 'invoice';
    } catch (_) { /* нет Stars на клиенте */ }
  }

  let url = '';
  if (options.url) url = String(options.url).replace('{stars}', String(stars));
  else if (options.bot) url = `https://t.me/${options.bot}?start=donate${stars}`;

  if (url) {
    try {
      if (tg?.openLink) tg.openLink(url);
      else if (tg?.openTelegramLink) tg.openTelegramLink(url);
      else window.open(url, '_blank', 'noopener');
      return 'link';
    } catch (_) { /* */ }
  }

  try { navigator.clipboard?.writeText(String(stars)); } catch (_) { /* */ }
  return 'copy';
}
