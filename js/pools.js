/**
 * Пулы объектов. Все игровые сущности выделяются один раз при загрузке,
 * внутри requestAnimationFrame новые объекты не создаются.
 */

/**
 * @param {number} size
 * @param {() => object} factory
 */
export function createPool(size, factory) {
  const items = new Array(size);
  for (let i = 0; i < size; i++) items[i] = factory();
  let cursor = 0;

  return {
    items,
    size,

    /** Берёт свободный слот; если все заняты — переиспользует самый старый. */
    acquire() {
      for (let i = 0; i < size; i++) {
        const index = (cursor + i) % size;
        if (!items[index].active) {
          cursor = (index + 1) % size;
          return items[index];
        }
      }
      const index = cursor;
      cursor = (cursor + 1) % size;
      return items[index];
    },

    reset() {
      for (let i = 0; i < size; i++) items[i].active = false;
      cursor = 0;
    },
  };
}

export function createNote() {
  return {
    active: false,
    type: 'tap',       // tap | hold | swipe | avoid | orb | bloom
    lane: 0,
    x: 0.5,            // нормализованная координата для RELAX
    time: 0,           // время в песне, секунды
    duration: 0,       // длина удержания
    dir: null,         // направление свайпа
    strength: 0.5,
    judged: false,
    hit: false,
    state: 'idle',     // idle | holding | done
    headJudge: null,   // оценка начала удержания
    holdPointer: -1,
    holdAcc: 0,
    holdFilled: 0,
    tickCount: 0,
    taps: 0,           // сколько тапов нужно нотам-«долбилкам»
    tapsDone: 0,
    chainId: -1,       // принадлежность к цепочке (RELAX)
    chainIndex: 0,
    linkTime: -1,      // предыдущая нота цепочки для соединительной линии
    linkX: 0,
    swipePointer: -1,
    fade: 0,
    spawnY: -0.08,
    velX: 0,
    velY: 0.25,
    gravity: 1.05,
    sizeScale: 1,
    spin: 0,
    fruitKind: 0,
    peakTime: 0,
    sliceAngle: 0,
  };
}

export function createParticle() {
  return {
    active: false,
    x: 0, y: 0,
    vx: 0, vy: 0,
    life: 0, maxLife: 0,
    size: 3,
    gravity: 0,
    drag: 0.92,
    color: '#ffffff',
  };
}

export function createRing() {
  return {
    active: false,
    x: 0, y: 0,
    life: 0, maxLife: 0,
    from: 0, to: 0,
    width: 3,
    color: '#ffffff',
  };
}

export function createFloater() {
  return {
    active: false,
    x: 0, y: 0,
    vy: 0,
    size: 2,
    phase: 0,
    alpha: 0.2,
  };
}
