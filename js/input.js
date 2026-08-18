/**
 * Отслеживание указателей (pointerdown / pointermove / pointerup).
 * Слоты выделены заранее, метки времени берутся из AudioContext.
 */

const MAX_POINTERS = 10;

function createSlot() {
  return {
    active: false,
    id: -1,
    x: 0, y: 0,          // координаты внутри игрового поля, пиксели
    startX: 0, startY: 0,
    startTime: 0,        // время AudioContext на момент нажатия
    moveX: 0, moveY: 0,  // накопленное смещение
    swipeUsed: false,
    lane: -1,
    prevX: 0,
    prevY: 0,
  };
}

export class PointerTracker {
  constructor() {
    this.slots = new Array(MAX_POINTERS);
    for (let i = 0; i < MAX_POINTERS; i++) this.slots[i] = createSlot();
  }

  reset() {
    for (const slot of this.slots) slot.active = false;
  }

  find(id) {
    for (const slot of this.slots) {
      if (slot.active && slot.id === id) return slot;
    }
    return null;
  }

  /** Первый активный указатель (для RELAX достаточно одного). */
  primary() {
    for (const slot of this.slots) {
      if (slot.active) return slot;
    }
    return null;
  }

  down(id, x, y, time) {
    let slot = this.find(id);
    if (!slot) {
      for (const candidate of this.slots) {
        if (!candidate.active) { slot = candidate; break; }
      }
    }
    if (!slot) return null;

    slot.active = true;
    slot.id = id;
    slot.x = x;
    slot.y = y;
    slot.startX = x;
    slot.startY = y;
    slot.startTime = time;
    slot.moveX = 0;
    slot.moveY = 0;
    slot.swipeUsed = false;
    slot.lane = -1;
    slot.prevX = x;
    slot.prevY = y;
    return slot;
  }

  move(id, x, y) {
    const slot = this.find(id);
    if (!slot) return null;
    slot.prevX = slot.x;
    slot.prevY = slot.y;
    slot.moveX = x - slot.startX;
    slot.moveY = y - slot.startY;
    slot.x = x;
    slot.y = y;
    return slot;
  }

  up(id) {
    const slot = this.find(id);
    if (!slot) return null;
    slot.active = false;
    return slot;
  }
}
