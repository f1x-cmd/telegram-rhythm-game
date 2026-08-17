/**
 * Общие константы игры: зоны экрана, окна точности, режимы, треки.
 */

export const LANES = 4;

/** Вертикальные зоны (0 = верх экрана, 1 = низ). */
export const ZONE = {
  spawnEnd: 0.15,     // ноты проявляются из градиента
  approachEnd: 0.70,  // зона считывания траектории — свободна от UI
  hitLine: 0.75,      // линия судейства
};

/** Базовые окна точности в секундах (спецификация 2.3). */
export const TIMING = {
  PERFECT_PLUS: 0.022,
  PERFECT: 0.045,
  GREAT: 0.080,
  GOOD: 0.120,
};

export const JUDGE = {
  PERFECT_PLUS: { label: 'PERFECT+', mult: 1.2, hp: 2.0, haptic: 'light', color: '#FFFFFF' },
  PERFECT:      { label: 'PERFECT',  mult: 1.0, hp: 1.0, haptic: 'light', color: '#00F0FF' },
  GREAT:        { label: 'GREAT',    mult: 0.7, hp: 0.5, haptic: 'soft',  color: '#00FF66' },
  GOOD:         { label: 'GOOD',     mult: 0.4, hp: 0.0, haptic: null,    color: '#FFCC00' },
  MISS:         { label: 'MISS',     mult: 0.0, hp: -8.0, haptic: 'error', color: '#FF3300' },
};

export const JUDGE_KEYS = ['PERFECT_PLUS', 'PERFECT', 'GREAT', 'GOOD', 'MISS'];

export const COLORS = {
  tap:   '#00F0FF',
  hold:  '#FF007A',
  swipe: '#00FF66',
  avoid: '#FF3300',
  mash:  '#FFAA00',
  orb:   '#6FE9FF',
  bloom: '#B98CFF',
  chain: '#7CFFC4',
  still: '#FFD98C',
};

/** Нота-«долбилка» в DRIVE: серия быстрых тапов по дорожке. */
export const MASH = { taps: 5, window: 0.75 };

export const SCORE_BASE = 1000;
export const MAX_HP = 100;
export const SHIELD_TIME = 15;      // секунд неуязвимости на старте
export const SHIELD_MISSES = 3;     // первые промахи без урона
export const AVOID_PENALTY = -15;   // касание красной ноты
export const SWIPE_MIN_PX = 30;
export const SWIPE_WINDOW = 0.16;   // секунд на завершение свайпа
export const HOLD_TICK = 0.05;      // проверка удержания каждые 50 мс
export const COMBO_SHAKE = [10, 25, 50];

/** Настройки сложности режима DRIVE. Названия — в i18n (ключи diff.*). */
export const DRIVE_DIFFICULTY = {
  easy: {
    nps: 2.0, approach: 2.2, windowScale: 1.6,
    chord: 1, types: ['tap', 'hold'], hpDrain: 0.6,
  },
  medium: {
    nps: 3.4, approach: 1.9, windowScale: 1.25,
    chord: 2, types: ['tap', 'hold', 'swipe', 'mash'], hpDrain: 1.0,
  },
  hard: {
    nps: 6.0, approach: 1.55, windowScale: 1.0,
    chord: 2, types: ['tap', 'hold', 'swipe', 'avoid', 'mash'], hpDrain: 1.25,
  },
};

/** Настройки режима RELAX. */
export const RELAX = {
  nps: 1.5,
  approach: 3.4,
  collectorRadius: 0.105,  // доля ширины поля
  noteRadius: 0.058,
  flowGain: 7,             // прирост flow за ноту
  flowDecay: 2.2,          // спад flow в секунду
  flowDuration: 12,        // длительность состояния потока
  scoreOrb: 500,
  scoreBloom: 1400,
  // Цепочка: несколько нот на одной дуге, бонус за полный сбор
  chainMin: 4,
  chainMax: 6,
  chainStep: 0.24,
  scoreChain: 320,
  scoreChainBonus: 2200,
  // «Замри»: держать палец на ноте, пока она опускается
  stillDuration: 1.15,
  scoreStill: 1800,
};

/** Названия режимов не переводятся, подписи берутся из i18n (mode.*.subtitle). */
export const MODES = {
  relax: {
    id: 'relax',
    title: 'RELAX',
    accent: '#6FE9FF',
    barLabel: 'FLOW',
  },
  drive: {
    id: 'drive',
    title: 'DRIVE',
    accent: '#FF007A',
    barLabel: 'HP',
  },
};

export const TRACKS = [
  { id: 'slow60',   title: 'Slow 60',       url: 'audio/slow60.mp3',        mood: 'relax' },
  { id: 'horizon',  title: 'Neon Horizon',  url: 'audio/Neon Horizon.mp3',  mood: 'both' },
  { id: 'pulse',    title: 'Neon Pulse',    url: 'audio/Neon Pulse.mp3',    mood: 'both' },
  { id: 'velocity', title: 'Neon Velocity', url: 'audio/Neon Velocity.mp3', mood: 'drive' },
];

/** Ранги по итоговой точности. */
export const RANKS = [
  { min: 0.95, label: 'S', color: '#FFD98C' },
  { min: 0.88, label: 'A', color: '#00F0FF' },
  { min: 0.75, label: 'B', color: '#00FF66' },
  { min: 0.60, label: 'C', color: '#FFCC00' },
  { min: 0.00, label: 'D', color: '#FF7755' },
];

export function rankFor(accuracy) {
  for (const rank of RANKS) {
    if (accuracy >= rank.min) return rank;
  }
  return RANKS[RANKS.length - 1];
}

/** Множитель комбо: min(1 + floor(combo/10) * 0.1, 4.0). */
export function comboMultiplier(combo) {
  return Math.min(1 + Math.floor(combo / 10) * 0.1, 4.0);
}

/**
 * Ссылка Mini App для инвайтов. Заполните bot и app — тогда шаринг
 * откроет t.me/bot/app?startapp=…; пока пусто, копируется код приглашения.
 */
export const TELEGRAM_APP = {
  bot: '',
  app: 'rhythm',
};

/**
 * Донат в кабинете. invoice[stars] — ссылка createInvoiceLink (Telegram Stars),
 * url — запасной t.me/tribute или бот, {stars} подставляется в шаблон.
 */
export const DONATE = {
  packs: [50, 150, 500],
  invoices: {},
  url: '',
  bot: '',
};

/**
 * Доступ в админ-панель (admin.html).
 * pin — локальный пароль; ids — Telegram user id, которые входят без пароля.
 */
export const ADMIN = {
  pin: 'rhythm',
  ids: [],
};

/** Лиги кабинета по сумме очков за всё время. */
export const LEAGUES = [
  { id: 'master',  min: 1500000, color: '#FF007A' },
  { id: 'diamond', min: 600000,  color: '#6FE9FF' },
  { id: 'gold',    min: 180000,  color: '#FFD98C' },
  { id: 'silver',  min: 40000,   color: '#C0C7D6' },
  { id: 'bronze',  min: 0,       color: '#C47A4A' },
];

/** Титул игрока по сумме очков. */
export const TITLES = [
  { id: 'legend', min: 1200000 },
  { id: 'rhythm', min: 350000 },
  { id: 'neon',   min: 90000 },
  { id: 'pulse',  min: 20000 },
  { id: 'rookie', min: 0 },
];

export function leagueFor(totalScore) {
  for (const league of LEAGUES) {
    if (totalScore >= league.min) return league;
  }
  return LEAGUES[LEAGUES.length - 1];
}

export function titleFor(totalScore) {
  for (const title of TITLES) {
    if (totalScore >= title.min) return title;
  }
  return TITLES[TITLES.length - 1];
}

/** Рейтинг навыка: растёт от суммы очков, партий и лучшего комбо. */
export function skillRating(career) {
  const score = career.totalScore || 0;
  const plays = career.plays || 0;
  const combo = career.maxCombo || 0;
  return Math.max(800, Math.round(800 + Math.sqrt(score) * 2.4 + plays * 4 + combo * 0.6));
}
