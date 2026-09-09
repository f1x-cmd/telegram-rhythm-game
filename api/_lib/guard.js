/**
 * Проверка результата партии на здравый смысл.
 *
 * Очки считаются на телефоне игрока, поэтому абсолютной защиты быть не может —
 * это правда для любой клиентской рит-игры. Задача скромнее: отсечь запросы
 * «у меня миллиард», отправленные мимо игры, и не тронуть ни одного живого
 * игрока. Границы намеренно щедрые: ложный отказ хуже пропущенного читера.
 */

/** Потолок очков на одну нот	у, с запасом на все множители режима. */
const PER_NOTE = {
  // DRIVE: 1000 базовых x 1.2 PERFECT+ x 4.0 комбо x 1.45 FEVER x 1.15 SMASH
  drive: 9000,
  // RELAX дороже: «дыхание» 1600 x 4.0 комбо x 1.5 SWEET x 2 BLISS, плюс цепочки
  relax: 26000,
};

/** Запас на множитель ивента из LiveOps — оператор может поднять его руками. */
const EVENT_HEADROOM = 10;

/** Абсолютный предел: столько не набрать даже теоретически. */
const ABSOLUTE_MAX = 50000000;

const LIMITS = {
  notes: 5000,
  durationSec: 1800,
  maxCombo: 5000,
};

/**
 * @param {object} run результат партии из клиента
 * @returns {{ok: true, run: object} | {ok: false, reason: string}}
 */
function checkRun(run) {
  if (!run || typeof run !== 'object') return { ok: false, reason: 'no run' };

  const mode = run.mode === 'drive' ? 'drive' : 'relax';
  const score = Number(run.score);
  const notes = Number(run.notes);
  const durationSec = Number(run.durationSec);
  const maxCombo = Number(run.maxCombo);
  const accuracy = Number(run.accuracy);

  for (const [name, value] of [['score', score], ['notes', notes], ['durationSec', durationSec]]) {
    if (!Number.isFinite(value) || value < 0) return { ok: false, reason: `bad ${name}` };
  }
  if (!Number.isInteger(score)) return { ok: false, reason: 'score not integer' };
  if (score > ABSOLUTE_MAX) return { ok: false, reason: 'score above absolute cap' };
  if (notes > LIMITS.notes) return { ok: false, reason: 'too many notes' };
  if (durationSec > LIMITS.durationSec) return { ok: false, reason: 'run too long' };
  if (Number.isFinite(maxCombo) && maxCombo > LIMITS.maxCombo) {
    return { ok: false, reason: 'combo too high' };
  }
  if (Number.isFinite(accuracy) && (accuracy < 0 || accuracy > 1)) {
    return { ok: false, reason: 'bad accuracy' };
  }

  // Ноты не могут возникать быстрее самой плотной карты. Восемь в секунду —
  // втрое выше боевой плотности, то есть заведомо недостижимо честной игрой.
  if (notes > durationSec * 8 + 50) return { ok: false, reason: 'notes vs duration' };

  // Комбо не бывает длиннее, чем всего нот
  if (Number.isFinite(maxCombo) && maxCombo > notes + 1) {
    return { ok: false, reason: 'combo vs notes' };
  }

  const ceiling = Math.max(50000, notes * PER_NOTE[mode] * EVENT_HEADROOM);
  if (score > ceiling) return { ok: false, reason: 'score vs notes' };

  return {
    ok: true,
    run: {
      mode,
      score,
      notes: Math.round(notes),
      durationSec: Math.round(durationSec),
      maxCombo: Number.isFinite(maxCombo) ? Math.round(maxCombo) : 0,
      accuracy: Number.isFinite(accuracy) ? Math.round(accuracy * 1000) / 1000 : 0,
      difficulty: normalizeDifficulty(run.mode, run.difficulty),
      track: normalizeTrack(run.track),
      failed: Boolean(run.failed),
    },
  };
}

/** В RELAX сложности нет — рекорды там всегда под ключом zen. */
function normalizeDifficulty(mode, difficulty) {
  if (mode !== 'drive') return 'zen';
  return ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium';
}

/** Идентификатор трека попадает в ключ Redis, поэтому чистим строго. */
function normalizeTrack(track) {
  const clean = String(track || 'custom').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  return clean || 'custom';
}

module.exports = { checkRun, normalizeTrack, PER_NOTE, ABSOLUTE_MAX };
