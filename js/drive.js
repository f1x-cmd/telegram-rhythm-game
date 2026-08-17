/**
 * Режим DRIVE.
 * Четыре дорожки, окна точности из спецификации, HP и щит новичка.
 * Типы нот: tap (циан), hold (розовый), swipe (зелёный), avoid (красный).
 */

import {
  LANES, ZONE, TIMING, JUDGE, JUDGE_KEYS, COLORS, SCORE_BASE, MAX_HP,
  AVOID_PENALTY, SWIPE_MIN_PX, SWIPE_WINDOW,
  HOLD_TICK, COMBO_SHAKE, DRIVE_DIFFICULTY, comboMultiplier,
} from './config.js';
import { haptic } from './telegram.js';
import { t } from './i18n.js';
import { shieldConfig } from './liveops.js';

export class DriveMode {
  constructor(game) {
    this.game = game;
    this.accent = COLORS.hold;

    this.diff = DRIVE_DIFFICULTY.medium;
    this.windowScale = 1;
    this.approach = 1.9;
    this.beatInterval = 0.5;

    this.hp = MAX_HP;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.misses = 0;
    this.dodged = 0;
    this.holdTicks = 0;
    this.mashDone = 0;
    this.rushes = 0;
    this.total = 0;
    this.counts = {};
    this.shieldTime = 15;
    this.shieldMisses = 3;
    this.shieldActive = true;

    this.laneFlash = new Float32Array(LANES);
    this.laneHit = new Float32Array(LANES);

    this.finished = false;
    this.failed = false;
  }

  get barValue() {
    return this.hp;
  }

  start(chart, difficultyKey) {
    const { notePool } = this.game;
    notePool.reset();

    this.diff = DRIVE_DIFFICULTY[difficultyKey] ?? DRIVE_DIFFICULTY.medium;
    this.windowScale = this.diff.windowScale;
    this.approach = this.diff.approach;
    this.beatInterval = chart.beatInterval || 0.5;

    this.total = 0;
    const limit = Math.min(chart.notes.length, notePool.size);
    for (let i = 0; i < limit; i++) {
      const source = chart.notes[i];
      const note = notePool.acquire();
      note.active = true;
      note.type = source.type;
      note.lane = source.lane;
      note.x = 0;
      note.time = source.time;
      note.duration = source.duration || 0;
      note.dir = source.dir;
      note.taps = source.taps || 0;
      note.tapsDone = 0;
      note.strength = source.strength;
      note.judged = false;
      note.hit = false;
      note.state = 'idle';
      note.headJudge = null;
      note.holdPointer = -1;
      note.holdAcc = 0;
      note.holdFilled = 0;
      note.tickCount = 0;
      note.fade = 0;
      if (source.type !== 'avoid') this.total++;
    }

    this.hp = MAX_HP;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.misses = 0;
    this.dodged = 0;
    this.holdTicks = 0;
    this.mashDone = 0;
    this.rushes = 0;
    const shield = shieldConfig();
    this.shieldTime = shield.time;
    this.shieldMisses = shield.misses;
    this.shieldActive = true;
    this.finished = false;
    this.failed = false;

    for (const key of JUDGE_KEYS) this.counts[key] = 0;
    for (let i = 0; i < LANES; i++) {
      this.laneFlash[i] = 0;
      this.laneHit[i] = 0;
    }

    this.game.audio.setAmbience(0);
  }

  stop() { /* нечего освобождать */ }

  // ── Ввод ─────────────────────────────────────────────────────────────────

  onDown(slot) {
    const now = this.game.audio.time;
    const lane = this._laneOf(slot.x);
    slot.lane = lane;
    this.laneFlash[lane] = now + 0.12;
    this.game.audio.click(0.18);

    const missWindow = TIMING.GOOD * this.windowScale;

    // Красная нота: касание запрещено
    const avoid = this._findNote(lane, now, missWindow * 1.3, 'avoid');
    if (avoid) {
      this._hitAvoid(avoid, now);
      return;
    }

    // «Долбилка» держит окно всю свою длину, поэтому ищется отдельно
    const mash = this._findMash(lane, now);
    if (mash) {
      this._tapMash(mash, now);
      return;
    }

    const note = this._findNote(lane, now, missWindow, 'press');
    if (!note) return;

    const abs = this.game.audio.toAudioTime(note.time);
    const delta = Math.abs(now - abs);

    if (note.type === 'hold') {
      note.state = 'holding';
      note.holdPointer = slot.id;
      note.holdAcc = 0;
      note.tickCount = 0;
      note.headJudge = this._judgeKey(delta);
      this._applyJudgment(note.headJudge, note, now, { silentMissSound: true });
    } else {
      note.judged = true;
      note.hit = true;
      note.fade = 0;
      this._applyJudgment(this._judgeKey(delta), note, now);
    }
  }

  onMove(slot) {
    if (slot.swipeUsed) return;
    const dx = slot.moveX;
    const dy = slot.moveY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (absX < SWIPE_MIN_PX && absY < SWIPE_MIN_PX) return;

    const now = this.game.audio.time;
    if (now - slot.startTime > SWIPE_WINDOW * this.windowScale) return;

    const dir = absY >= absX ? (dy < 0 ? 'up' : 'down') : (dx < 0 ? 'left' : 'right');
    const lane = this._laneOf(slot.startX);
    const missWindow = TIMING.GOOD * this.windowScale;
    const note = this._findNote(lane, slot.startTime, missWindow, 'swipe');
    if (!note || note.dir !== dir) return;

    slot.swipeUsed = true;
    note.judged = true;
    note.hit = true;
    note.fade = 0;
    const abs = this.game.audio.toAudioTime(note.time);
    this._applyJudgment(this._judgeKey(Math.abs(slot.startTime - abs)), note, now);
  }

  onUp(slot) {
    const { notePool } = this.game;
    for (let i = 0; i < notePool.size; i++) {
      const note = notePool.items[i];
      if (note.active && note.state === 'holding' && note.holdPointer === slot.id) {
        this._breakHold(note, this.game.audio.time);
      }
    }
  }

  // ── Логика ───────────────────────────────────────────────────────────────

  update(now, songTime, dt) {
    const { audio, notePool, pointers } = this.game;
    const missWindow = TIMING.GOOD * this.windowScale;

    this.shieldActive = songTime < this.shieldTime || this.misses < this.shieldMisses;

    for (let i = 0; i < notePool.size; i++) {
      const note = notePool.items[i];
      if (!note.active) continue;

      if (note.judged && note.state !== 'holding') {
        note.fade += dt * 3.5;
        if (note.fade >= 1) note.active = false;
        continue;
      }

      const abs = audio.toAudioTime(note.time);

      if (note.state === 'holding') {
        const slot = pointers.find(note.holdPointer);
        const laneOk = Boolean(slot) && this._laneOf(slot.x) === note.lane;

        if (!laneOk) {
          this._breakHold(note, now);
          continue;
        }

        note.holdAcc += dt;
        while (note.holdAcc >= HOLD_TICK) {
          note.holdAcc -= HOLD_TICK;
          note.tickCount++;
          this.holdTicks++;
          this.score += Math.round(40 * comboMultiplier(this.combo));
          if (note.tickCount % 2 === 0) haptic('selection');
        }

        note.holdFilled = Math.min(1, Math.max(0, (now - abs) / note.duration));
        if (now >= abs + note.duration) this._completeHold(note, now);
        continue;
      }

      if (note.type === 'avoid') {
        if (now > abs + missWindow) {
          note.judged = true;
          note.hit = false;
          note.fade = 0;
          this.dodged++;
          this.score += 250;
        }
        continue;
      }

      if (note.type === 'mash') {
        if (now > abs + note.duration) {
          note.judged = true;
          note.fade = 0;
          if (note.tapsDone === 0) {
            note.hit = false;
            this._applyJudgment('MISS', note, now);
          } else {
            // Серия начата, но не добита — частичный зачёт без обрыва комбо
            note.hit = true;
            this.counts.GOOD++;
            this.score += Math.round(300 * comboMultiplier(this.combo));
            this.game.hud.showJudgment('OK', 'good');
          }
        }
        continue;
      }

      if (now > abs + missWindow) {
        note.judged = true;
        note.hit = false;
        note.fade = 0;
        this._applyJudgment('MISS', note, now);
      }
    }

    if (this.hp <= 0) {
      this.hp = 0;
      this.failed = true;
      this.finished = true;
      return;
    }

    if (audio.duration > 0 && songTime > audio.duration + 1.5) {
      this.finished = true;
    }
  }

  _laneOf(x) {
    const laneWidth = this.game.width / LANES;
    return Math.min(LANES - 1, Math.max(0, Math.floor(x / laneWidth)));
  }

  /**
   * Поиск ближайшей по времени ноты в дорожке.
   * @param {'press'|'swipe'|'avoid'} kind
   */
  _findNote(lane, time, window, kind) {
    const { notePool, audio } = this.game;
    let best = null;
    let bestDelta = Infinity;

    for (let i = 0; i < notePool.size; i++) {
      const note = notePool.items[i];
      if (!note.active || note.judged || note.lane !== lane) continue;
      if (note.state === 'holding') continue;

      if (kind === 'press' && note.type !== 'tap' && note.type !== 'hold') continue;
      if (kind === 'swipe' && note.type !== 'swipe') continue;
      if (kind === 'avoid' && note.type !== 'avoid') continue;

      const delta = Math.abs(time - audio.toAudioTime(note.time));
      if (delta <= window && delta < bestDelta) {
        bestDelta = delta;
        best = note;
      }
    }
    return best;
  }

  /** Активная нота-«долбилка» в дорожке. */
  _findMash(lane, now) {
    const { notePool, audio } = this.game;
    const missWindow = TIMING.GOOD * this.windowScale;

    for (let i = 0; i < notePool.size; i++) {
      const note = notePool.items[i];
      if (!note.active || note.judged || note.type !== 'mash' || note.lane !== lane) continue;
      const abs = audio.toAudioTime(note.time);
      if (now >= abs - missWindow && now <= abs + note.duration) return note;
    }
    return null;
  }

  _tapMash(note, now) {
    const { fx, audio, hud, width, height } = this.game;
    const laneWidth = width / LANES;
    const x = note.lane * laneWidth + laneWidth / 2;
    const y = ZONE.hitLine * height;

    note.tapsDone++;
    this.laneHit[note.lane] = now + 0.16;
    audio.punch(0.8);
    fx.burst(x, y, 7, COLORS.mash, { speed: 280, gravity: 660, life: 0.35, size: 3, lift: 90 });
    haptic('rigid');

    if (note.tapsDone < note.taps) {
      this.score += Math.round(120 * comboMultiplier(this.combo));
      return;
    }

    // Серия выбита полностью
    note.judged = true;
    note.hit = true;
    note.fade = 0;
    this.mashDone++;
    this.counts.PERFECT_PLUS++;
    this._bumpCombo();
    this.score += Math.round(SCORE_BASE * 1.2 * comboMultiplier(this.combo));
    this.hp = Math.min(MAX_HP, this.hp + 2);

    fx.burst(x, y, 26, COLORS.mash, { speed: 430, gravity: 700, life: 0.6, size: 4, lift: 150 });
    fx.ring(x, y, COLORS.mash, laneWidth * 0.2, width * 0.9, 0.5, 4);
    fx.shake(now, 9);
    fx.flashScreen(0.16, COLORS.mash);
    hud.showJudgment('SMASH!', 'mash');
    haptic('heavy');
  }

  /** Растит комбо и считает «разгоны» — серии по 25 нот без промаха. */
  _bumpCombo() {
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    if (this.combo % 25 === 0) this.rushes++;
  }

  _judgeKey(delta) {
    const s = this.windowScale;
    if (delta <= TIMING.PERFECT_PLUS * s) return 'PERFECT_PLUS';
    if (delta <= TIMING.PERFECT * s) return 'PERFECT';
    if (delta <= TIMING.GREAT * s) return 'GREAT';
    if (delta <= TIMING.GOOD * s) return 'GOOD';
    return 'MISS';
  }

  _applyJudgment(key, note, now, options = {}) {
    const judgment = JUDGE[key];
    const { fx, audio, hud, width, height } = this.game;
    this.counts[key]++;

    if (key === 'MISS') {
      this.combo = 0;
      this.misses++;
      if (!options.silentMissSound) audio.miss();
      fx.flashScreen(0.1, COLORS.avoid);
    } else {
      this._bumpCombo();
      this.score += Math.round(SCORE_BASE * judgment.mult * comboMultiplier(this.combo));

      const intensity = key === 'PERFECT_PLUS' ? 1.15 : key === 'PERFECT' ? 1 : 0.75;
      audio.punch(intensity);
    }

    // HP: щит новичка гасит любой урон
    let delta = judgment.hp;
    if (delta < 0) {
      delta *= this.diff.hpDrain;
      if (this.shieldActive) delta = 0;
    }
    this.hp = Math.min(MAX_HP, Math.max(0, this.hp + delta));

    // Визуальный отклик у линии судейства
    const laneWidth = width / LANES;
    const x = note.lane * laneWidth + laneWidth / 2;
    const y = ZONE.hitLine * height;
    this.laneHit[note.lane] = now + 0.22;

    if (key === 'PERFECT_PLUS' || key === 'PERFECT') {
      fx.burst(x, y, 15 + Math.floor(Math.random() * 11), judgment.color, {
        speed: 320, gravity: 700, life: 0.5, size: 3.4, lift: 120,
      });
      fx.ring(x, y, judgment.color, laneWidth * 0.2, laneWidth * 1.05, 0.4, 3);
    } else if (key !== 'MISS') {
      fx.burst(x, y, 8, judgment.color, { speed: 220, gravity: 600, life: 0.4, size: 2.8, lift: 80 });
      fx.ring(x, y, judgment.color, laneWidth * 0.2, laneWidth * 0.8, 0.35, 2);
    }

    if (COMBO_SHAKE.includes(this.combo)) {
      const amp = this.combo >= 50 ? 12 : this.combo >= 25 ? 8 : 5;
      fx.shake(now, amp);
      fx.flashScreen(0.14, judgment.color);
      fx.ring(width / 2, y, judgment.color, laneWidth, width * 1.2, 0.6, 4);
      haptic('heavy');
    } else {
      haptic(judgment.haptic);
    }

    hud.showJudgment(judgment.label, key.toLowerCase().replace('_', '-'));
  }

  _completeHold(note, now) {
    const { fx, width, height } = this.game;
    note.state = 'done';
    note.judged = true;
    note.hit = true;
    note.fade = 0;

    this._bumpCombo();
    this.score += Math.round(SCORE_BASE * 0.5 * comboMultiplier(this.combo));

    const laneWidth = width / LANES;
    const x = note.lane * laneWidth + laneWidth / 2;
    const y = ZONE.hitLine * height;
    fx.burst(x, y, 18, COLORS.hold, { speed: 300, gravity: 620, life: 0.55, size: 3.4, lift: 140 });
    fx.ring(x, y, COLORS.hold, laneWidth * 0.2, laneWidth * 1.2, 0.45, 3);
    this.game.audio.punch(1);
    this.game.hud.showJudgment('HOLD OK', 'great');
    haptic('medium');
  }

  _breakHold(note, now) {
    note.state = 'done';
    note.judged = true;
    note.hit = false;
    note.fade = 0;
    note.holdPointer = -1;
    this._applyJudgment('MISS', note, now);
  }

  _hitAvoid(note, now) {
    const { fx, audio, hud, width, height } = this.game;
    note.judged = true;
    note.hit = true;
    note.fade = 0;

    this.combo = 0;
    let delta = AVOID_PENALTY * this.diff.hpDrain;
    if (this.shieldActive) delta = 0;
    this.hp = Math.min(MAX_HP, Math.max(0, this.hp + delta));

    const laneWidth = width / LANES;
    const x = note.lane * laneWidth + laneWidth / 2;
    const y = ZONE.hitLine * height;
    fx.burst(x, y, 22, COLORS.avoid, { speed: 340, gravity: 700, life: 0.5, size: 4, lift: 60 });
    fx.flashScreen(0.28, COLORS.avoid);
    fx.shake(now, 10);
    audio.alarm();
    hud.showJudgment('DANGER', 'miss');
    haptic('error');
  }

  // ── Отрисовка ────────────────────────────────────────────────────────────

  render(ctx, now, songTime) {
    const { width: w, height: h, fx, audio } = this.game;
    const bands = audio.bands;
    const hitY = ZONE.hitLine * h;
    const laneWidth = w / LANES;

    this._drawBackground(ctx, w, h, bands);
    this._drawBeatGrid(ctx, w, h, songTime, hitY);
    this._drawLanes(ctx, w, h, laneWidth, now, bands);
    this._drawPads(ctx, w, h, laneWidth, hitY, now);
    this._drawHitLine(ctx, w, hitY, bands);
    this._drawNotes(ctx, now, w, h, laneWidth, hitY);

    ctx.globalCompositeOperation = 'lighter';
    fx.drawParticles(ctx);
    ctx.globalCompositeOperation = 'source-over';

    fx.drawRings(ctx);
    fx.drawFlash(ctx, w, h);
  }

  _drawBackground(ctx, w, h, bands) {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#16111f');
    gradient.addColorStop(ZONE.spawnEnd, '#0d0b16');
    gradient.addColorStop(ZONE.approachEnd, '#0b0a13');
    gradient.addColorStop(1, '#08070d');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // Басовое дыхание у линии судейства
    this.game.fx.drawGlow(ctx, w / 2, ZONE.hitLine * h, w * (0.5 + bands.bass * 0.5), COLORS.hold, 0.1 + bands.bass * 0.2);
  }

  /** Сетка, синхронная долям трека: даёт ощущение ритма. */
  _drawBeatGrid(ctx, w, h, songTime, hitY) {
    const beat = this.beatInterval;
    if (beat <= 0) return;
    const first = Math.floor(songTime / beat) * beat;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= Math.ceil(this.approach / beat) + 1; i++) {
      const t = first + i * beat;
      const progress = 1 - (t - songTime) / this.approach;
      if (progress < 0 || progress > 1.2) continue;
      const y = progress * hitY;
      const isBar = Math.round(t / beat) % 4 === 0;
      ctx.globalAlpha = isBar ? 0.5 : 0.25;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  _drawLanes(ctx, w, h, laneWidth, now, bands) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1;
    for (let i = 1; i < LANES; i++) {
      const x = i * laneWidth;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Полосы скорости на высоком комбо
    if (this.combo >= 20) {
      const strength = Math.min(0.3, (this.combo - 20) / 120 + 0.08);
      ctx.globalAlpha = strength * (0.6 + bands.mid * 0.6);
      ctx.fillStyle = COLORS.hold;
      for (let i = 0; i < LANES; i++) {
        const x = i * laneWidth + laneWidth * 0.5;
        const offset = ((now * 700 + i * 130) % (h + 200)) - 100;
        ctx.fillRect(x - 1, h - offset, 2, 90);
      }
      ctx.globalAlpha = 1;
    }

    for (let i = 0; i < LANES; i++) {
      if (now >= this.laneFlash[i]) continue;
      const alpha = (this.laneFlash[i] - now) / 0.12;
      ctx.globalAlpha = alpha * 0.12;
      ctx.fillStyle = COLORS.tap;
      ctx.fillRect(i * laneWidth, 0, laneWidth, h);
      ctx.globalAlpha = 1;
    }
  }

  _drawPads(ctx, w, h, laneWidth, hitY, now) {
    const padH = h * 0.062;
    const padW = laneWidth * 0.78;

    for (let i = 0; i < LANES; i++) {
      const cx = i * laneWidth + laneWidth / 2;
      const hitGlow = Math.max(0, (this.laneHit[i] - now) / 0.22);
      const pressed = now < this.laneFlash[i];

      if (hitGlow > 0) {
        ctx.globalCompositeOperation = 'lighter';
        this.game.fx.drawGlow(ctx, cx, hitY, laneWidth * 0.8, COLORS.tap, hitGlow * 0.7);
        ctx.globalCompositeOperation = 'source-over';
      }

      ctx.fillStyle = pressed ? 'rgba(0, 240, 255, 0.3)' : 'rgba(0, 240, 255, 0.07)';
      ctx.strokeStyle = pressed ? 'rgba(0, 240, 255, 0.85)' : 'rgba(0, 240, 255, 0.25)';
      ctx.lineWidth = pressed ? 3 : 1.5;
      this._roundRect(ctx, cx - padW / 2, hitY - padH / 2, padW, padH, 8);
      ctx.fill();
      ctx.stroke();
    }
  }

  _drawHitLine(ctx, w, hitY, bands) {
    ctx.strokeStyle = `rgba(0, 240, 255, ${0.5 + bands.bass * 0.4})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, hitY);
    ctx.lineTo(w, hitY);
    ctx.stroke();
  }

  _drawNotes(ctx, now, w, h, laneWidth, hitY) {
    const { audio, notePool, fx } = this.game;
    const noteH = h * 0.038;
    const noteW = laneWidth * 0.74;
    const missWindow = TIMING.GOOD * this.windowScale;

    for (let i = 0; i < notePool.size; i++) {
      const note = notePool.items[i];
      if (!note.active) continue;

      const abs = audio.toAudioTime(note.time);
      const timeLeft = abs - now;
      if (timeLeft > this.approach) continue;

      const progress = 1 - timeLeft / this.approach;
      const y = progress * hitY;
      const cx = note.lane * laneWidth + laneWidth / 2;

      let alpha = 1;
      const yNorm = y / h;
      if (yNorm < ZONE.spawnEnd) alpha = Math.max(0, yNorm / ZONE.spawnEnd);
      if (note.judged && note.state !== 'holding') alpha *= Math.max(0, 1 - note.fade);
      if (alpha <= 0.02) continue;
      // «Долбилка» остаётся на экране всё своё окно
      const extraTail = note.type === 'mash' ? note.duration : 0;
      if (!note.judged && timeLeft < -missWindow - 0.2 - extraTail) continue;

      ctx.globalAlpha = alpha;

      if (note.type === 'hold') {
        this._drawHold(ctx, note, now, cx, y, hitY, noteW, noteH, alpha);
      } else if (note.type === 'mash') {
        this._drawMash(ctx, note, now, cx, y, hitY, noteW, noteH, alpha);
      } else if (note.type === 'swipe') {
        this._drawSwipe(ctx, note, cx, y, noteW, noteH, alpha, fx);
      } else if (note.type === 'avoid') {
        this._drawAvoid(ctx, cx, y, noteW, noteH, alpha, fx);
      } else {
        this._drawTap(ctx, cx, y, noteW, noteH, alpha, fx);
      }

      ctx.globalAlpha = 1;
    }
  }

  _drawTap(ctx, cx, y, noteW, noteH, alpha, fx) {
    ctx.globalCompositeOperation = 'lighter';
    fx.drawGlow(ctx, cx, y, noteW * 0.75, COLORS.tap, alpha * 0.45);
    ctx.globalCompositeOperation = 'source-over';

    // Короткий след движения
    const trail = ctx.createLinearGradient(0, y - noteH * 2.2, 0, y);
    trail.addColorStop(0, 'rgba(0, 240, 255, 0)');
    trail.addColorStop(1, 'rgba(0, 240, 255, 0.35)');
    ctx.fillStyle = trail;
    ctx.fillRect(cx - noteW * 0.3, y - noteH * 2.2, noteW * 0.6, noteH * 2.2);

    ctx.fillStyle = COLORS.tap;
    this._roundRect(ctx, cx - noteW / 2, y - noteH / 2, noteW, noteH, 7);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    this._roundRect(ctx, cx - noteW / 2 + 4, y - noteH / 2 + 3, noteW - 8, noteH * 0.28, 4);
    ctx.fill();
  }

  _drawHold(ctx, note, now, cx, y, hitY, noteW, noteH, alpha) {
    const tailAbs = this.game.audio.toAudioTime(note.time + note.duration);
    const tailProgress = 1 - (tailAbs - now) / this.approach;
    const tailY = tailProgress * hitY;
    const bodyW = noteW * 0.62;
    const holding = note.state === 'holding';

    const top = Math.min(y, tailY);
    const bottom = Math.max(y, tailY);

    ctx.fillStyle = holding ? 'rgba(255, 0, 122, 0.55)' : 'rgba(255, 0, 122, 0.3)';
    this._roundRect(ctx, cx - bodyW / 2, top, bodyW, Math.max(2, bottom - top), bodyW / 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 0, 122, 0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (holding) {
      ctx.globalCompositeOperation = 'lighter';
      this.game.fx.drawGlow(ctx, cx, hitY, noteW * 0.9, COLORS.hold, 0.6);
      ctx.globalCompositeOperation = 'source-over';
    }

    // Голова ноты
    const headY = holding ? hitY : y;
    ctx.globalCompositeOperation = 'lighter';
    this.game.fx.drawGlow(ctx, cx, headY, noteW * 0.75, COLORS.hold, alpha * 0.5);
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = COLORS.hold;
    this._roundRect(ctx, cx - noteW / 2, headY - noteH / 2, noteW, noteH, 7);
    ctx.fill();
  }

  _drawMash(ctx, note, now, cx, y, hitY, noteW, noteH, alpha) {
    // Пока серия активна, нота «прилипает» к линии судейства и дрожит
    const active = y >= hitY - noteH;
    const drawY = active ? hitY : y;
    const pulse = active ? 1 + Math.sin(now * 30) * 0.07 : 1;
    const w = noteW * 1.04 * pulse;
    const h = noteH * 1.3 * pulse;
    const left = Math.max(0, note.taps - note.tapsDone);

    ctx.globalCompositeOperation = 'lighter';
    this.game.fx.drawGlow(ctx, cx, drawY, noteW * 0.95, COLORS.mash, alpha * (active ? 0.7 : 0.45));
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = COLORS.mash;
    this._roundRect(ctx, cx - w / 2, drawY - h / 2, w, h, 8);
    ctx.fill();

    ctx.fillStyle = '#2A1500';
    ctx.font = `700 ${Math.round(h * 0.6)}px -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`×${left}`, cx, drawY);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  _drawSwipe(ctx, note, cx, y, noteW, noteH, alpha, fx) {
    ctx.globalCompositeOperation = 'lighter';
    fx.drawGlow(ctx, cx, y, noteW * 0.8, COLORS.swipe, alpha * 0.45);
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = COLORS.swipe;
    this._roundRect(ctx, cx - noteW / 2, y - noteH / 2, noteW, noteH, 7);
    ctx.fill();

    // Шеврон направления
    const size = noteH * 0.42;
    ctx.strokeStyle = '#04150a';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (note.dir === 'left') {
      ctx.moveTo(cx + size * 0.6, y - size);
      ctx.lineTo(cx - size * 0.5, y);
      ctx.lineTo(cx + size * 0.6, y + size);
    } else if (note.dir === 'right') {
      ctx.moveTo(cx - size * 0.6, y - size);
      ctx.lineTo(cx + size * 0.5, y);
      ctx.lineTo(cx - size * 0.6, y + size);
    } else {
      ctx.moveTo(cx - size, y + size * 0.5);
      ctx.lineTo(cx, y - size * 0.6);
      ctx.lineTo(cx + size, y + size * 0.5);
    }
    ctx.stroke();
  }

  _drawAvoid(ctx, cx, y, noteW, noteH, alpha, fx) {
    ctx.globalCompositeOperation = 'lighter';
    fx.drawGlow(ctx, cx, y, noteW * 0.85, COLORS.avoid, alpha * 0.5);
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = COLORS.avoid;
    this._roundRect(ctx, cx - noteW / 2, y - noteH * 0.42, noteW, noteH * 0.84, 4);
    ctx.fill();

    // Предупреждающие полосы
    ctx.save();
    ctx.beginPath();
    this._roundRect(ctx, cx - noteW / 2, y - noteH * 0.42, noteW, noteH * 0.84, 4);
    ctx.clip();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 5;
    for (let x = -noteW; x < noteW; x += 14) {
      ctx.beginPath();
      ctx.moveTo(cx + x, y - noteH);
      ctx.lineTo(cx + x + noteH, y + noteH);
      ctx.stroke();
    }
    ctx.restore();
  }

  _roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  stats() {
    // Точность считаем только по нотам, которые успели прозвучать
    let judged = 0;
    let weighted = 0;
    for (const key of JUDGE_KEYS) {
      judged += this.counts[key];
      weighted += this.counts[key] * JUDGE[key].mult;
    }
    const accuracy = judged > 0 ? Math.min(1, weighted / (judged * 1.2)) : 0;

    return {
      mode: 'drive',
      failed: this.failed,
      score: this.score,
      maxCombo: this.maxCombo,
      accuracy,
      total: judged,
      collected: judged - this.counts.MISS,
      missed: this.counts.MISS,
      metrics: {
        notes: judged - this.counts.MISS,
        score: this.score,
        combo: this.maxCombo,
        flow: this.rushes,
        perfect: this.counts.PERFECT_PLUS + this.counts.PERFECT,
      },
      rows: [
        ['Perfect+', String(this.counts.PERFECT_PLUS)],
        ['Perfect', String(this.counts.PERFECT)],
        ['Great', String(this.counts.GREAT)],
        ['Good', String(this.counts.GOOD)],
        ['Miss', String(this.counts.MISS)],
        [t('row.smash'), String(this.mashDone)],
        [t('row.rush'), String(this.rushes)],
        [t('row.bestCombo'), String(this.maxCombo)],
        [t('row.accuracy'), `${Math.round(accuracy * 100)}%`],
      ],
    };
  }
}
