/**
 * Office Rage: падение сверху и коллизии лезвия для DRIVE.
 * Позиции — от AudioContext.currentTime.
 */

import { OFFICE, OFFICE_PROPS, OFFICE_BOMB, OFFICE_BONUS } from './config.js';

export function officePosition(note, now, audio, width, height) {
  const launch = audio.toAudioTime(note.time);
  const elapsed = now - launch;
  if (elapsed < 0) return null;

  const g = (note.gravity ?? OFFICE.gravity) * height;
  const x = note.x * width + note.velX * width * elapsed;
  const y = note.spawnY * height + note.velY * height * elapsed + 0.5 * g * elapsed * elapsed;
  const rotation = note.spin * elapsed;

  return { x, y, rotation, elapsed };
}

export function officeRadius(note, width) {
  const base = note.type === 'golden' ? OFFICE.goldenRadius : OFFICE.radius;
  const scale = note.sizeScale ?? 1;
  return width * base * scale * (note.type === 'golden' ? 1.1 : 1);
}

/** Хитбокс шире картинки — свайп по стрелке и краю тоже режет. */
export function officeHitRadius(note, width) {
  return officeRadius(note, width) * (OFFICE.hitPad ?? 1.55);
}

export function officeProp(note) {
  if (note.type === 'avoid') return OFFICE_BOMB;
  if (note.type === 'golden') return OFFICE_BONUS;
  const n = OFFICE_PROPS.length;
  const idx = ((note.fruitKind % n) + n) % n;
  return OFFICE_PROPS[idx];
}

function segmentHitsCircle(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1) {
    return Math.hypot(x1 - cx, y1 - cy) <= r
      || Math.hypot(x2 - cx, y2 - cy) <= r;
  }

  let t = ((cx - x1) * dx + (cy - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  return Math.hypot(px - cx, py - cy) <= r;
}

export function bladeHitsCircle(x1, y1, x2, y2, cx, cy, r) {
  return Math.hypot(x1 - cx, y1 - cy) <= r
    || Math.hypot(x2 - cx, y2 - cy) <= r
    || segmentHitsCircle(x1, y1, x2, y2, cx, cy, r);
}

export function bladeAngle(x1, y1, x2, y2) {
  return Math.atan2(y2 - y1, x2 - x1);
}

const DIR_ANGLES = {
  left: Math.PI,
  right: 0,
  up: -Math.PI / 2,
  down: Math.PI / 2,
};

/**
 * Совпадает ли направление жеста со стрелкой на предмете (medium / hard).
 *
 * Принимает уже готовый вектор: вызывающий сам решает, брать весь ход пальца
 * или последний отрезок. Слишком короткий жест направления не задаёт и по
 * стрелке не засчитывается — иначе тапом можно было бы игнорировать стрелки,
 * ради которых сложность и существует.
 *
 * @param {{dir: string|null}} note
 * @param {number} dx смещение жеста по X
 * @param {number} dy смещение жеста по Y
 * @param {boolean} required включена ли проверка на этой сложности
 */
export function sliceMatchesDir(note, dx, dy, required) {
  if (!required || !note.dir) return true;
  const target = DIR_ANGLES[note.dir];
  if (target === undefined) return true;
  if (Math.hypot(dx, dy) < OFFICE.dirMinPx) return false;

  const angle = Math.atan2(dy, dx);
  let delta = Math.abs(angle - target);
  if (delta > Math.PI) delta = Math.PI * 2 - delta;
  return delta <= (OFFICE.dirToleranceDeg * Math.PI) / 180;
}

/** Когда предмет проходит «идеальную» высоту для разреза. */
export function fallPeakOffset(spawnY, velY, gravity, targetY = OFFICE.sliceTargetY) {
  const a = 0.5 * gravity;
  const b = velY;
  const c = spawnY - targetY;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return 1.1;
  return Math.max(0.35, (-b + Math.sqrt(disc)) / (2 * a));
}
