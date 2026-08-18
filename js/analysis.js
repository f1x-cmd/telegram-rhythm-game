/**
 * Анализ аудиобуфера: Energy Onset Detection, оценка BPM и фазы сетки,
 * генерация карт нот для режимов DRIVE и RELAX.
 */

import { LANES, DRIVE_DIFFICULTY, RELAX, MASH, OFFICE } from './config.js';

const FRAME = 1024;
const HOP = 512;

/** Детерминированный ГПСЧ, чтобы карта одного трека была стабильной. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mixToMono(buffer) {
  const len = buffer.length;
  const mono = new Float32Array(len);
  const channels = buffer.numberOfChannels;
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += data[i];
  }
  const scale = 1 / channels;
  for (let i = 0; i < len; i++) mono[i] *= scale;
  return mono;
}

/**
 * Анализ буфера: огибающие энергии по низу/верху спектра, пики-онсеты, BPM, фаза.
 * @param {AudioBuffer} buffer
 */
export function analyzeAudio(buffer) {
  const sr = buffer.sampleRate;
  const mono = mixToMono(buffer);
  const frames = Math.max(1, Math.floor((mono.length - FRAME) / HOP));

  const total = new Float32Array(frames);
  const lowEnergy = new Float32Array(frames);
  const highEnergy = new Float32Array(frames);

  // Однополюсный фильтр разделяет бас (кик) и верх (хэты) без полного FFT
  const cutoff = 160;
  const alpha = Math.min(1, (2 * Math.PI * cutoff) / sr);
  let lp = 0;

  for (let f = 0; f < frames; f++) {
    const start = f * HOP;
    let sumAll = 0;
    let sumLow = 0;
    let sumHigh = 0;
    for (let i = 0; i < FRAME; i++) {
      const x = mono[start + i];
      lp += alpha * (x - lp);
      const high = x - lp;
      sumAll += x * x;
      sumLow += lp * lp;
      sumHigh += high * high;
    }
    total[f] = Math.sqrt(sumAll / FRAME);
    lowEnergy[f] = Math.sqrt(sumLow / FRAME);
    highEnergy[f] = Math.sqrt(sumHigh / FRAME);
  }

  // Спектральный поток: только нарастание энергии
  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    flux[f] = Math.max(0, total[f] - total[f - 1]);
  }

  const onsets = pickPeaks(flux, lowEnergy, highEnergy, sr);
  const beatInterval = estimateBeatInterval(flux, sr);
  const beatPhase = estimatePhase(onsets, beatInterval);

  return {
    duration: buffer.duration,
    onsets,
    beatInterval,
    bpm: Math.round(60 / beatInterval),
    beatPhase,
  };
}

/** Пики потока выше локального адаптивного порога. */
function pickPeaks(flux, lowEnergy, highEnergy, sr) {
  const frames = flux.length;
  const frameTime = HOP / sr;
  const windowFrames = Math.max(4, Math.round(0.35 / frameTime));
  const minGapFrames = Math.max(1, Math.round(0.075 / frameTime));

  let maxFlux = 0;
  for (let f = 0; f < frames; f++) if (flux[f] > maxFlux) maxFlux = flux[f];
  if (maxFlux <= 0) return [];

  const onsets = [];
  let lastPeak = -minGapFrames;

  for (let f = 2; f < frames - 2; f++) {
    // Локальное среднее как порог
    const from = Math.max(0, f - windowFrames);
    const to = Math.min(frames, f + windowFrames);
    let mean = 0;
    for (let i = from; i < to; i++) mean += flux[i];
    mean /= (to - from);

    const value = flux[f];
    if (value < mean * 1.5 || value < maxFlux * 0.06) continue;
    if (value < flux[f - 1] || value < flux[f + 1]) continue;
    if (f - lastPeak < minGapFrames) continue;

    lastPeak = f;
    const low = lowEnergy[f];
    const high = highEnergy[f];
    const denom = low + high || 1;
    onsets.push({
      time: f * frameTime,
      strength: Math.min(1, value / maxFlux),
      bass: low / denom,
    });
  }

  return onsets;
}

/** Автокорреляция потока для поиска интервала доли (BPM 70–180). */
function estimateBeatInterval(flux, sr) {
  const frameTime = HOP / sr;
  const minLag = Math.round(60 / 180 / frameTime);
  const maxLag = Math.round(60 / 70 / frameTime);
  const frames = flux.length;
  if (frames < maxLag * 2) return 0.5;

  let bestLag = minLag;
  let bestScore = -1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let f = 0; f + lag < frames; f++) score += flux[f] * flux[f + lag];
    // Нормализация, чтобы длинные лаги не выигрывали автоматически
    score /= (frames - lag);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  let interval = bestLag * frameTime;
  // Приводим к «музыкальному» диапазону 100–160 BPM удвоением/делением
  while (60 / interval < 100) interval /= 2;
  while (60 / interval > 170) interval *= 2;
  return interval;
}

/** Подбор фазы сетки: максимизируем сумму сил онсетов на долях. */
function estimatePhase(onsets, beatInterval) {
  if (onsets.length === 0) return 0;
  const steps = 48;
  let bestPhase = 0;
  let bestScore = -1;

  for (let s = 0; s < steps; s++) {
    const phase = (s / steps) * beatInterval;
    let score = 0;
    for (const onset of onsets) {
      const rel = (onset.time - phase) / beatInterval;
      const dist = Math.abs(rel - Math.round(rel));
      score += onset.strength * (1 - dist * 2);
    }
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }
  return bestPhase;
}

/** Квантование онсетов к сетке с дедупликацией. */
function quantize(analysis, subdivision) {
  const { onsets, beatInterval, beatPhase, duration } = analysis;
  const step = beatInterval / subdivision;
  const map = new Map();

  for (const onset of onsets) {
    const time = Math.round((onset.time - beatPhase) / step) * step + beatPhase;
    if (time < 0.5 || time > duration - 0.6) continue;
    const key = Math.round(time * 1000);
    const existing = map.get(key);
    if (!existing || onset.strength > existing.strength) {
      map.set(key, { time, strength: onset.strength, bass: onset.bass });
    }
  }

  return Array.from(map.values()).sort((a, b) => a.time - b.time);
}

/** Жадный отбор самых сильных онсетов с ограничением плотности. */
function thinByDensity(candidates, targetNps, duration, minGap) {
  const budget = Math.max(8, Math.floor(duration * targetNps));
  const byStrength = candidates.slice().sort((a, b) => b.strength - a.strength);
  const chosen = [];

  for (const candidate of byStrength) {
    if (chosen.length >= budget) break;
    let ok = true;
    for (let i = 0; i < chosen.length; i++) {
      if (Math.abs(chosen[i].time - candidate.time) < minGap) { ok = false; break; }
    }
    if (ok) chosen.push(candidate);
  }

  return chosen.sort((a, b) => a.time - b.time);
}

/** Резервная сетка, если анализ ничего не нашёл. */
function fallbackGrid(duration, interval) {
  const notes = [];
  for (let t = 1.0; t < duration - 0.6; t += interval) {
    notes.push({ time: t, strength: 0.6, bass: 0.5 });
  }
  return notes;
}

/**
 * Карта для DRIVE: дорожки, tap / hold / swipe / avoid, аккорды.
 * @returns {{notes: Array, beatInterval: number, bpm: number, beatPhase: number}}
 */
export function buildDriveChart(analysis, difficultyKey) {
  const diff = DRIVE_DIFFICULTY[difficultyKey] ?? DRIVE_DIFFICULTY.medium;
  if (diff.fruitNinja) return buildFruitChart(analysis, difficultyKey);
  return buildLaneChart(analysis, difficultyKey);
}

/**
 * Office Rage: офисный реквизит вылетает по дугам под бит.
 */
export function buildFruitChart(analysis, difficultyKey) {
  const diff = DRIVE_DIFFICULTY[difficultyKey] ?? DRIVE_DIFFICULTY.medium;
  const { beatInterval, duration } = analysis;
  const random = mulberry32(Math.round(duration * 131) + 919);

  let candidates = quantize(analysis, 1);
  if (candidates.length < 6) candidates = fallbackGrid(duration, beatInterval);

  const minGap = Math.max(beatInterval * 0.55, (1 / diff.nps) * 0.65);
  const picked = thinByDensity(candidates, diff.nps, duration, minGap);

  const strengths = picked.map((n) => n.strength).sort((a, b) => b - a);
  const strongCut = strengths[Math.floor(strengths.length * 0.2)] ?? 0.65;

  const notes = [];
  const canBomb = diff.types.includes('avoid') || diff.bombMode === 'help';
  const canBonus = diff.types.includes('bonus') || diff.types.includes('office');
  let bombCooldown = diff.bombMode === 'help' ? 6 : 10;

  const pickDir = () => {
    const roll = random();
    if (roll < 0.28) return 'left';
    if (roll < 0.56) return 'right';
    if (roll < 0.78) return 'up';
    return 'down';
  };

  for (let i = 0; i < picked.length; i++) {
    const current = picked[i];
    if (current.skip) continue;

    const spawnX = 0.1 + random() * 0.8;
    const velX = (0.5 - spawnX) * (0.5 + random() * 0.45);
    const velY = -(OFFICE.launchVy.min + random() * (OFFICE.launchVy.max - OFFICE.launchVy.min));
    const peakOffset = -velY / OFFICE.gravity;

    let type = 'fruit';
    let fruitKind = Math.floor(random() * 4);

    if (canBomb && bombCooldown <= 0 && random() < (diff.bombMode === 'help' ? 0.22 : 0.13)) {
      type = 'avoid';
      fruitKind = 4;
      bombCooldown = diff.bombMode === 'help' ? 7 + Math.floor(random() * 4) : 12 + Math.floor(random() * 5);
    } else if (canBonus && current.strength >= strongCut && random() < 0.18) {
      type = 'golden';
      fruitKind = 5;
    } else {
      bombCooldown--;
    }

    notes.push({
      time: current.time,
      peakTime: current.time + peakOffset,
      x: spawnX,
      spawnY: OFFICE.spawnY,
      velX,
      velY,
      spin: (random() - 0.5) * 10,
      fruitKind,
      type,
      lane: 0,
      duration: 0,
      dir: diff.sliceDir && type !== 'avoid' ? pickDir() : null,
      taps: 0,
      strength: current.strength,
    });
  }

  notes.sort((a, b) => a.time - b.time);
  return { notes, beatInterval, bpm: analysis.bpm, beatPhase: analysis.beatPhase, fruitNinja: true };
}

/**
 * Классические 4 дорожки (legacy, если fruitNinja выключен).
 */
function buildLaneChart(analysis, difficultyKey) {
  const diff = DRIVE_DIFFICULTY[difficultyKey] ?? DRIVE_DIFFICULTY.medium;
  const { beatInterval, duration } = analysis;
  const random = mulberry32(Math.round(duration * 1000) + Math.round(beatInterval * 10000));

  let candidates = quantize(analysis, 2);
  if (candidates.length < 8) candidates = fallbackGrid(duration, beatInterval);

  const minGap = Math.max(beatInterval / 2 - 0.005, (1 / diff.nps) * 0.5);
  const picked = thinByDensity(candidates, diff.nps, duration, minGap);

  const strengths = picked.map((n) => n.strength).sort((a, b) => b - a);
  const strongCut = strengths[Math.floor(strengths.length * 0.18)] ?? 0.7;

  const notes = [];
  const canHold = diff.types.includes('hold');
  const canSwipe = diff.types.includes('swipe');
  const canMash = diff.types.includes('mash');
  let lane = 1;
  let direction = 1;
  let holdCooldown = 0;
  let swipeCooldown = 0;
  let mashCooldown = 4;

  /** Сколько выбранных нот попадает в интервал — столько придётся убрать. */
  const countInside = (from, until) => {
    let inside = 0;
    for (let j = from; j < picked.length && picked[j].time < until; j++) {
      if (!picked[j].skip) inside++;
    }
    return inside;
  };

  const clearRange = (from, until) => {
    for (let j = from; j < picked.length && picked[j].time < until; j++) {
      picked[j].skip = true;
    }
  };

  for (let i = 0; i < picked.length; i++) {
    const current = picked[i];
    if (current.skip) continue;

    // Выбор дорожки: бас тянет к краям, остальное шагает змейкой
    if (current.bass > 0.62) {
      lane = current.strength > strongCut ? 0 : LANES - 1;
    } else {
      lane += direction;
      if (lane > LANES - 1) { lane = LANES - 2; direction = -1; }
      if (lane < 0) { lane = 1; direction = 1; }
      if (random() < 0.18) direction *= -1;
    }

    let type = 'tap';
    let holdDuration = 0;
    let dir = null;
    let taps = 0;

    // Удержание: под него специально освобождаем место в плотном потоке
    if (canHold && holdCooldown <= 0 && (current.bass > 0.45 || random() < 0.3)) {
      const beats = random() < 0.55 ? 1 : 2;
      const candidateDuration = beatInterval * beats;
      const clearUntil = current.time + candidateDuration + beatInterval * 0.5;
      if (countInside(i + 1, clearUntil) <= beats * 2 + 1) {
        clearRange(i + 1, clearUntil);
        type = 'hold';
        holdDuration = candidateDuration;
        holdCooldown = 5;
      }
    }

    // «Долбилка» на самых громких моментах — главный выпуск пара
    if (type === 'tap' && canMash && mashCooldown <= 0 && current.strength >= strongCut) {
      const clearUntil = current.time + MASH.window + beatInterval * 0.5;
      if (countInside(i + 1, clearUntil) <= 4) {
        clearRange(i + 1, clearUntil);
        type = 'mash';
        holdDuration = MASH.window;
        taps = MASH.taps;
        mashCooldown = 9;
      }
    }

    if (type === 'tap' && canSwipe && swipeCooldown <= 0 && current.strength >= strongCut && random() < 0.32) {
      type = 'swipe';
      dir = random() < 0.5 ? 'up' : (lane <= 1 ? 'right' : 'left');
      swipeCooldown = 4;
    }

    holdCooldown--;
    swipeCooldown--;
    mashCooldown--;

    notes.push({ time: current.time, lane, type, duration: holdDuration, dir, taps, strength: current.strength });

    // Аккорды только на hard и реже
    if (diff.chord > 1 && type === 'tap' && current.strength >= strongCut && random() < 0.08) {
      const second = (lane + 2) % LANES;
      notes.push({ time: current.time, lane: second, type: 'tap', duration: 0, dir: null, strength: current.strength });
    }
  }

  notes.sort((a, b) => a.time - b.time);

  // Красные ноты ставим на свободную дорожку рядом с занятыми
  if (diff.types.includes('avoid')) {
    const extra = [];
    for (let t = analysis.beatPhase + beatInterval * 8; t < duration - 2; t += beatInterval) {
      if (random() > 0.07) continue;
      const occupied = new Set();
      for (let k = 0; k < notes.length; k++) {
        if (Math.abs(notes[k].time - t) < 0.34) occupied.add(notes[k].lane);
      }
      if (occupied.size === 0 || occupied.size >= LANES) continue;
      for (let l = 0; l < LANES; l++) {
        if (occupied.has(l)) continue;
        extra.push({ time: t, lane: l, type: 'avoid', duration: 0, dir: null, strength: 0.5 });
        break;
      }
    }
    notes.push(...extra);
    notes.sort((a, b) => a.time - b.time);
  }
  return { notes, beatInterval, bpm: analysis.bpm, beatPhase: analysis.beatPhase };
}

/**
 * Карта для RELAX: свободные координаты по плавной кривой,
 * чтобы ноты собирались одним движением пальца.
 */
export function buildRelaxChart(analysis) {
  const { beatInterval, duration } = analysis;
  const random = mulberry32(Math.round(duration * 977) + 17);

  let candidates = quantize(analysis, 1);
  if (candidates.length < 6) candidates = fallbackGrid(duration, beatInterval * 2);

  const minGap = Math.max(beatInterval * 0.9, (1 / RELAX.nps) * 0.75);
  const picked = thinByDensity(candidates, RELAX.nps, duration, minGap);

  const notes = [];
  let phase = random() * Math.PI * 2;
  let chainId = 0;
  let chainCooldown = 2;
  let stillCooldown = 4;

  /** Освобождаем место под длинные элементы, чтобы они не наслаивались. */
  const countInside = (from, until) => {
    let inside = 0;
    for (let j = from; j < picked.length && picked[j].time < until; j++) {
      if (!picked[j].skip) inside++;
    }
    return inside;
  };

  const clearRange = (from, until) => {
    for (let j = from; j < picked.length && picked[j].time < until; j++) {
      picked[j].skip = true;
    }
  };

  const curveX = () => Math.min(0.88, Math.max(0.12, 0.5 + 0.36 * Math.sin(phase)));
  const base = (time, x, type) => ({
    time, x, type,
    lane: 0, duration: 0, dir: null, taps: 0,
    chainId: -1, chainIndex: 0, linkTime: -1, linkX: x,
    strength: 0.6,
  });

  for (let i = 0; i < picked.length; i++) {
    const current = picked[i];
    if (current.skip) continue;

    // Плавная синусоида: соседние ноты лежат на одной дуге
    phase += 0.62 + 0.28 * Math.sin(i * 0.41);

    // «Дыхание»: медленно веди палец вместе с нотой
    if (stillCooldown <= 0 && random() < 0.38) {
      const until = current.time + RELAX.breathDuration + 0.5;
      if (countInside(i + 1, until) <= 2) {
        clearRange(i + 1, until);
        const note = base(current.time, curveX(), 'breath');
        note.duration = RELAX.breathDuration;
        note.strength = current.strength;
        notes.push(note);
        stillCooldown = 9;
        chainCooldown--;
        continue;
      }
    }

    // Цепочки реже — больше одиночных «орбов» для дрейфа
    if (chainCooldown <= 0 && random() < 0.55) {
      const length = RELAX.chainMin + Math.floor(random() * (RELAX.chainMax - RELAX.chainMin + 1));
      const step = RELAX.chainStep;
      const until = current.time + step * length + 0.4;

      if (countInside(i + 1, until) <= 3) {
        clearRange(i + 1, until);
        let linkTime = -1;
        let linkX = 0;

        for (let k = 0; k < length; k++) {
          phase += 0.42;
          const x = curveX();
          const note = base(current.time + k * step, x, 'chain');
          note.chainId = chainId;
          note.chainIndex = k;
          note.linkTime = linkTime;
          note.linkX = linkTime < 0 ? x : linkX;
          note.strength = current.strength;
          notes.push(note);
          linkTime = note.time;
          linkX = x;
        }

        chainId++;
        chainCooldown = 6;
        stillCooldown--;
        continue;
      }
    }

    const isBloom = current.strength > 0.48 && (i % 4 === 0 || random() < 0.28);
    const note = base(current.time, curveX(), isBloom ? 'bloom' : 'orb');
    note.strength = current.strength;
    notes.push(note);
    chainCooldown--;
    stillCooldown--;
  }

  notes.sort((a, b) => a.time - b.time);
  return { notes, beatInterval, bpm: analysis.bpm, beatPhase: analysis.beatPhase, chains: chainId };
}
