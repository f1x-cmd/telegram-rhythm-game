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
  orb:   '#8FE9FF',
  bloom: '#C4A8FF',
  chain: '#9ADBC4',
  still: '#FFE4A8',
  glass: '#E8F4FF',
  rage:  '#FF4D2E',
  fever: '#FFD166',
};

/** Прирост ярости DRIVE за попадание. */
export const RAGE_GAIN = {
  PERFECT_PLUS: 14,
  PERFECT: 10,
  GREAT: 7,
  GOOD: 4,
  HOLD_TICK: 1,
  MASH_FINISH: 18,
  DODGE: 6,
};

export const RAGE_MISS = 9;
export const RAGE_FEVER_TIME = 14;
export const DRIVE_SMASH_ZONE_Y = 0.52; // доля экрана — зона «бей куда угодно»

/** Office Rage: предметы падают сверху, режутся свайпом по экрану. */
export const OFFICE = {
  spawnYTop: { min: -0.12, max: -0.03 },
  gravity: 1.05,
  fallVy: { min: 0.2, max: 0.38 },
  driftX: 0.26,
  sliceTargetY: 0.52,
  radius: 0.085,
  goldenRadius: 0.104,
  sliceMinPx: 12,
  bladeLife: 0.42,
  helpRadius: 0.26,
  dustAmount: 0.52,
  dustDecay: 0.32,
};

/** @deprecated alias */
export const FRUIT = OFFICE;

/** Офисный реквизит: то, что хочется разрезать после рабочего дня. */
export const OFFICE_PROPS = [
  { id: 0, color: '#F4F4EE', accent: '#5B7DB1', debris: '#D8D8CC', icon: 'doc' },
  { id: 1, color: '#2A2A2E', accent: '#6FE9FF', debris: '#888890', icon: 'phone' },
  { id: 2, color: '#C4A882', accent: '#FFE8CC', debris: '#E8D0A8', icon: 'mug' },
  { id: 3, color: '#FF5555', accent: '#FFD0D0', debris: '#FFAAAA', icon: 'call' },
  { id: 4, color: '#3A3A42', accent: '#9AA3B5', debris: '#888890', icon: 'keyboard' },
  { id: 5, color: '#E8E0C8', accent: '#C45A4A', debris: '#D8D0B8', icon: 'mail' },
  { id: 6, color: '#4A5568', accent: '#7EC8E3', debris: '#8890A0', icon: 'laptop' },
  { id: 7, color: '#C45A3A', accent: '#2A2A2A', debris: '#E09070', icon: 'stapler' },
  { id: 8, color: '#3D8B6E', accent: '#C4A882', debris: '#7EC4A0', icon: 'cactus' },
  { id: 9, color: '#2A2A32', accent: '#FF4D2E', debris: '#888890', icon: 'headset' },
];

export const OFFICE_BOMB = { id: 20, color: '#1a1a1a', accent: '#FF4D2E', debris: '#AA8866', icon: 'bomb' };
export const OFFICE_BONUS = { id: 21, color: '#FFD166', accent: '#FFF8DC', debris: '#FFF0A8', icon: 'bonus' };

/** @deprecated */
export const FRUIT_KINDS = OFFICE_PROPS;

/** Нота-«долбилка» в DRIVE: серия быстрых тапов по дорожке. */
export const MASH = { taps: 5, window: 0.75 };

export const SCORE_BASE = 1000;
export const MAX_HP = 100;
export const SHIELD_TIME = 15;      // секунд неуязвимости на старте
export const SHIELD_MISSES = 3;     // первые промахи без урона
export const AVOID_PENALTY = -15;   // касание красной ноты
export const SWIPE_MIN_PX = 24;
export const SWIPE_WINDOW = 0.14;   // свайп за ≤ 140 ms (масштабируется windowScale)
export const HOLD_TICK = 0.05;      // проверка удержания каждые 50 мс
export const COMBO_SHAKE = [10, 25, 50];
export const DRIVE_ASSIST_TIME = 20; // секунд щита точности в DRIVE
export const DRIVE_MISS_HP = -5;     // мягче спецификации для hyper-casual

/** Лимит пользовательского аудио (~20 МБ), чтобы decode не подвисал на мобилках. */
export const CUSTOM_AUDIO_MAX_BYTES = 20 * 1024 * 1024;

/** Настройки сложности режима DRIVE. Названия — в i18n (ключи diff.*). */
export const DRIVE_DIFFICULTY = {
  easy: {
    nps: 1.25, approach: 2.7, windowScale: 1.85,
    chord: 1, types: ['office', 'bonus'], hpDrain: 0.45,
    laneSnap: true, holdLanePad: 0.5, smashZone: true, canFail: false,
    fruitNinja: true, bombMode: 'help', sliceDir: false,
    fallGravity: 0.92, fallVy: { min: 0.22, max: 0.36 }, sizeScale: 1.18,
  },
  medium: {
    nps: 1.65, approach: 2.25, windowScale: 1.55,
    chord: 1, types: ['office', 'bonus', 'avoid'], hpDrain: 0.65,
    laneSnap: true, holdLanePad: 0.38, smashZone: true, canFail: false,
    fruitNinja: true, bombMode: 'dust', sliceDir: true,
    fallGravity: 0.88, fallVy: { min: 0.2, max: 0.32 }, sizeScale: 1.22,
  },
  hard: {
    nps: 1.55, approach: 2.4, windowScale: 1.35,
    chord: 1, types: ['office', 'bonus', 'avoid'], hpDrain: 1.0,
    laneSnap: false, holdLanePad: 0.24, smashZone: true, canFail: true,
    fruitNinja: true, bombMode: 'damage', sliceDir: true,
    fallGravity: 0.58, fallVy: { min: 0.11, max: 0.2 }, sizeScale: 1.42,
  },
};

/** RELAX — медитативный дрейф: без проигрыша, музыка главнее очков. */
export const RELAX = {
  nps: 1.15,
  approach: 4.2,
  collectorRadius: 0.13,
  noteRadius: 0.055,
  magnetReach: 1.65,
  sweetLine: 0.1,
  calmFromMusic: 4.5,      // %/сек — полоска растёт от музыки сама
  calmGain: 11,
  calmDecay: 1.2,
  blissDuration: 18,
  scoreOrb: 420,
  scoreBloom: 1200,
  chainMin: 3,
  chainMax: 5,
  chainStep: 0.32,
  scoreChain: 280,
  scoreChainBonus: 1800,
  breathDuration: 1.4,     // «дыхание» — медленно веди палец
  scoreBreath: 1600,
};

/** Названия режимов не переводятся, подписи берутся из i18n (mode.*.subtitle). */
export const MODES = {
  relax: {
    id: 'relax',
    title: 'RELAX',
    accent: '#7EC8E3',
    barLabel: 'CALM',
  },
  drive: {
    id: 'drive',
    title: 'DRIVE',
    accent: '#FF4D2E',
    barLabel: 'RAGE',
  },
};

export const TRACKS = [
  { id: 'slow60',      title: 'Slow 60',       url: 'audio/slow60.mp3',        mood: 'relax' },
  { id: 'horizon',     title: 'Neon Horizon',  url: 'audio/Neon Horizon.mp3',  mood: 'both' },
  { id: 'pulse',       title: 'Neon Pulse',    url: 'audio/Neon Pulse.mp3',    mood: 'both' },
  { id: 'velocity',    title: 'Neon Velocity', url: 'audio/Neon Velocity.mp3', mood: 'drive' },
  { id: 'fastsnakes',  title: 'Fast Snakes',   url: 'audio/fastSnakes.mp3',    mood: 'drive' },
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
  bot: 'rhythm_game_play_bot',
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
