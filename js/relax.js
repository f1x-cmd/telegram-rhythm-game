/**
 * Режим RELAX.
 * Игрок ведёт палец по экрану и собирает светящиеся ноты.
 * Проигрыша нет: цель — расслабиться и послушать музыку.
 */

import { ZONE, COLORS, RELAX, comboMultiplier } from './config.js';
import { haptic } from './telegram.js';
import { t } from './i18n.js';

export class RelaxMode {
  constructor(game) {
    this.game = game;
    this.accent = COLORS.orb;

    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.collected = 0;
    this.missed = 0;
    this.total = 0;
    this.flow = 0;
    this.flowActive = false;
    this.flowEndsAt = 0;
    this.flowActivations = 0;
    this.chainsDone = 0;
    this.stillsDone = 0;

    // Прогресс цепочек: индекс — chainId, значения выставляются при старте трека
    this.chainCollected = new Int16Array(512);
    this.chainTotal = new Int16Array(512);

    this.collectorX = 0;
    this.collectorY = 0;
    this.collectorAlpha = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.pointerDown = false;
    this.awaitingTouch = true;
    this.finished = false;
    this.hue = 0;
    this._lastRibbonAt = 0;
    this._dash = [7, 9];
    this._solid = [];
  }

  get barValue() {
    return this.flow;
  }

  start(chart) {
    const { notePool } = this.game;
    notePool.reset();

    this.chainCollected.fill(0);
    this.chainTotal.fill(0);

    this.total = 0;
    const limit = Math.min(chart.notes.length, notePool.size);
    for (let i = 0; i < limit; i++) {
      const source = chart.notes[i];
      const note = notePool.acquire();
      note.active = true;
      note.type = source.type;
      note.x = source.x;
      note.lane = 0;
      note.time = source.time;
      note.duration = source.duration || 0;
      note.dir = null;
      note.strength = source.strength;
      note.judged = false;
      note.hit = false;
      note.state = 'idle';
      note.holdFilled = 0;
      note.chainId = source.chainId ?? -1;
      note.chainIndex = source.chainIndex ?? 0;
      note.linkTime = source.linkTime ?? -1;
      note.linkX = source.linkX ?? source.x;
      note.fade = 0;
      this.total++;

      if (note.chainId >= 0 && note.chainId < this.chainTotal.length) {
        this.chainTotal[note.chainId]++;
      }
    }

    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.collected = 0;
    this.missed = 0;
    this.flow = 0;
    this.flowActive = false;
    this.flowActivations = 0;
    this.chainsDone = 0;
    this.stillsDone = 0;
    this.finished = false;
    this.collectorAlpha = 0.55;
    this.pointerDown = false;
    this.awaitingTouch = true;

    const { width, height } = this.game;
    this.collectorX = width / 2;
    this.collectorY = height * 0.75;
    this.targetX = this.collectorX;
    this.targetY = this.collectorY;

    this.game.fx.seedFloaters(width, height);
    this.game.audio.setAmbience(0.32);
    this.game.audio.resetChime();
  }

  stop() {
    this.game.audio.setAmbience(0);
  }

  // ── Ввод ─────────────────────────────────────────────────────────────────

  onDown(slot) {
    this.pointerDown = true;
    this.awaitingTouch = false;
    this.targetX = slot.x;
    this.targetY = slot.y;
    this.collectorX = slot.x;
    this.collectorY = slot.y;
  }

  onMove(slot) {
    this.targetX = slot.x;
    this.targetY = slot.y;
  }

  onUp() {
    if (!this.game.pointers.primary()) this.pointerDown = false;
  }

  // ── Логика ───────────────────────────────────────────────────────────────

  update(now, songTime, dt) {
    const { audio, fx, notePool, width, height } = this.game;
    const approach = RELAX.approach;
    const hitY = ZONE.hitLine * height;
    const collectorRadius = width * RELAX.collectorRadius;
    const noteRadius = width * RELAX.noteRadius;

    // Плавное следование за пальцем
    const follow = this.pointerDown ? 0.32 : 0.08;
    this.collectorX += (this.targetX - this.collectorX) * follow;
    this.collectorY += (this.targetY - this.collectorY) * follow;
    this.collectorAlpha += ((this.pointerDown ? 1 : 0.25) - this.collectorAlpha) * 0.12;

    if (this.pointerDown && now - this._lastRibbonAt > 0.012) {
      fx.pushRibbon(this.collectorX, this.collectorY, 0.4);
      this._lastRibbonAt = now;
    }

    // Затухание потока
    if (this.flowActive) {
      if (now >= this.flowEndsAt) {
        this.flowActive = false;
        this.flow = 0;
      } else {
        const left = (this.flowEndsAt - now) / RELAX.flowDuration;
        this.flow = Math.max(0, left * 100);
      }
    } else {
      this.flow = Math.max(0, this.flow - RELAX.flowDecay * dt);
    }

    this.hue += dt * 6;

    for (let i = 0; i < notePool.size; i++) {
      const note = notePool.items[i];
      if (!note.active) continue;

      if (note.judged) {
        note.fade += dt * 3;
        if (note.fade >= 1) note.active = false;
        continue;
      }

      const abs = audio.toAudioTime(note.time);
      const progress = 1 - (abs - now) / approach;
      if (progress < 0) continue;

      const y = progress * hitY;
      const x = note.x * width;

      const dx = this.collectorX - x;
      const dy = this.collectorY - y;
      const visible = y > height * ZONE.spawnEnd * 0.5;
      const touching = this.collectorAlpha > 0.4 && visible;
      const reachMul = note.type === 'bloom' ? 1.25 : note.type === 'still' ? 1.4 : 0.95;
      const reach = collectorRadius + noteRadius * reachMul;
      const distSq = dx * dx + dy * dy;

      // Магнит: нота чуть притягивает палец, если близко
      if (this.pointerDown && visible && distSq <= (reach * RELAX.magnetReach) ** 2 && distSq > reach * reach) {
        const pull = this.flowActive ? 0.22 : 0.16;
        this.collectorX += dx * pull;
        this.collectorY += dy * pull;
      }

      // «Замри»: палец должен ехать вместе с нотой
      if (note.type === 'still') {
        const inside = touching && distSq <= (reach * 1.15) ** 2;
        if (inside) {
          note.holdFilled += dt / note.duration;
          if (note.holdFilled >= 1) {
            this._collectStill(note, x, y, now);
            continue;
          }
        } else {
          note.holdFilled = Math.max(0, note.holdFilled - dt * 0.6);
        }
      } else if (touching) {
        // Обычный сбор: палец накрыл ноту (или почти на линии)
        const lineGrace = y >= hitY - height * 0.035 && Math.abs(dx) <= reach * 1.35;
        if (distSq <= reach * reach || lineGrace) {
          this._collect(note, x, y, hitY, now);
          continue;
        }
      }

      // Нота ушла за нижний край
      if (y > height * 1.02) {
        note.judged = true;
        note.hit = false;
        note.fade = 0.4;
        this.missed++;
        if (this.combo > 3) this.combo = Math.max(0, this.combo - 2);
        else this.combo = 0;
        this.flow = Math.max(0, this.flow - 5);
        audio.resetChime();
      }
    }

    if (audio.duration > 0 && songTime > audio.duration + 1.2) {
      this.finished = true;
    }
  }

  _collect(note, x, y, hitY, now) {
    const { audio, fx } = this.game;
    const isBloom = note.type === 'bloom';
    const isChain = note.type === 'chain';
    const sweet = Math.abs(y - hitY) < this.game.height * RELAX.sweetLine;

    note.judged = true;
    note.hit = true;
    note.fade = 0;

    this.collected++;
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;

    const base = isBloom ? RELAX.scoreBloom : isChain ? RELAX.scoreChain : RELAX.scoreOrb;
    const bonus = (sweet ? 1.5 : 1) * (this.flowActive ? 2 : 1);
    this.score += Math.round(base * comboMultiplier(this.combo) * bonus);

    this._addFlow(RELAX.flowGain * (isBloom ? 2 : isChain ? 0.6 : 1), now);

    const color = isBloom ? COLORS.bloom : isChain ? COLORS.chain : COLORS.orb;
    fx.burst(x, y, isBloom ? 24 : isChain ? 9 : 14, color, {
      speed: isBloom ? 180 : 130,
      gravity: -30,
      life: 0.8,
      size: isBloom ? 4 : 3,
      drag: 0.94,
      lift: 10,
    });
    fx.ring(x, y, color, this.game.width * 0.03, this.game.width * (isBloom ? 0.24 : 0.16), 0.6, 2);

    audio.chime();
    haptic(sweet ? 'light' : 'soft');

    if (isChain) {
      this._checkChain(note, x, y, now);
    } else if (!this.flowActive && sweet) {
      this.game.hud.showJudgment('SWEET', 'sweet');
    }
  }

  /** Бонус за полностью собранную цепочку. */
  _checkChain(note, x, y, now) {
    const id = note.chainId;
    if (id < 0 || id >= this.chainTotal.length) return;

    this.chainCollected[id]++;
    if (this.chainCollected[id] < this.chainTotal[id]) return;

    this.chainsDone++;
    this.score += Math.round(RELAX.scoreChainBonus * comboMultiplier(this.combo) * (this.flowActive ? 2 : 1));
    this._addFlow(RELAX.flowGain * 2, now);

    const { fx, audio } = this.game;
    fx.ring(x, y, COLORS.chain, this.game.width * 0.05, this.game.width * 0.5, 0.7, 3);
    fx.burst(x, y, 22, COLORS.chain, { speed: 200, gravity: -40, life: 0.9, size: 3.6, drag: 0.94, lift: 20 });
    audio.chime();
    if (!this.flowActive) this.game.hud.showJudgment('CHAIN', 'chain');
    haptic('medium');
  }

  /** Завершённая нота «замри». */
  _collectStill(note, x, y, now) {
    const { fx, audio } = this.game;
    note.judged = true;
    note.hit = true;
    note.fade = 0;

    this.collected++;
    this.stillsDone++;
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;

    this.score += Math.round(RELAX.scoreStill * comboMultiplier(this.combo) * (this.flowActive ? 2 : 1));
    this._addFlow(RELAX.flowGain * 2.5, now);

    fx.ring(x, y, COLORS.still, this.game.width * 0.04, this.game.width * 0.44, 0.8, 3);
    fx.burst(x, y, 26, COLORS.still, { speed: 150, gravity: -50, life: 1, size: 3.6, drag: 0.95, lift: 20 });
    audio.chime();
    audio.chime();
    if (!this.flowActive) this.game.hud.showJudgment('ZEN', 'zen');
    haptic('medium');
  }

  _addFlow(amount, now) {
    if (this.flowActive) return;
    this.flow = Math.min(100, this.flow + amount);
    if (this.flow < 100) return;

    this.flowActive = true;
    this.flowActivations++;
    this.flowEndsAt = now + RELAX.flowDuration;
    this.game.fx.flashScreen(0.18, COLORS.bloom);
    this.game.hud.showJudgment('FLOW', 'flow');
    haptic('medium');
  }

  // ── Отрисовка ────────────────────────────────────────────────────────────

  render(ctx, now, songTime) {
    const { width: w, height: h, fx, audio } = this.game;
    const bands = audio.bands;

    this._drawBackground(ctx, w, h, bands, now);
    fx.drawFloaters(ctx, '#8FF3E4');
    this._drawSweetLine(ctx, w, h, bands);
    this._drawNotes(ctx, now, w, h);

    ctx.globalCompositeOperation = 'lighter';
    fx.drawRibbon(ctx, this.flowActive ? COLORS.bloom : COLORS.orb);
    fx.drawParticles(ctx);
    ctx.globalCompositeOperation = 'source-over';

    fx.drawRings(ctx);
    this._drawCollector(ctx, w, now);
    fx.drawFlash(ctx, w, h);
  }

  _drawBackground(ctx, w, h, bands, now) {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    if (this.flowActive) {
      gradient.addColorStop(0, '#1b1440');
      gradient.addColorStop(0.55, '#101a34');
      gradient.addColorStop(1, '#08111f');
    } else {
      gradient.addColorStop(0, '#0d1a2b');
      gradient.addColorStop(0.55, '#0a1522');
      gradient.addColorStop(1, '#070d16');
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // Медленные световые пятна, дышащие вместе с музыкой
    const pulse = 0.6 + bands.mid * 0.8;
    const blobColor = this.flowActive ? COLORS.bloom : '#2AA7C4';
    this.game.fx.drawGlow(
      ctx,
      w * (0.3 + 0.12 * Math.sin(now * 0.21)),
      h * (0.34 + 0.06 * Math.cos(now * 0.17)),
      w * 0.55 * pulse,
      blobColor,
      0.16,
    );
    this.game.fx.drawGlow(
      ctx,
      w * (0.72 + 0.1 * Math.cos(now * 0.13)),
      h * (0.62 + 0.05 * Math.sin(now * 0.19)),
      w * 0.5 * pulse,
      '#4E7BE8',
      0.12,
    );
  }

  _drawSweetLine(ctx, w, h, bands) {
    const y = ZONE.hitLine * h;
    const glow = 0.25 + bands.bass * 0.5;
    ctx.globalAlpha = glow;
    this.game.fx.drawGlow(ctx, w / 2, y, w * 0.62, this.flowActive ? COLORS.bloom : COLORS.orb, 0.5);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = this.flowActive ? 'rgba(185, 140, 255, 0.5)' : 'rgba(111, 233, 255, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 10]);
    ctx.beginPath();
    ctx.moveTo(w * 0.06, y);
    ctx.lineTo(w * 0.94, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  _drawNotes(ctx, now, w, h) {
    const { audio, notePool, fx } = this.game;
    const hitY = ZONE.hitLine * h;
    const radius = w * RELAX.noteRadius;

    for (let i = 0; i < notePool.size; i++) {
      const note = notePool.items[i];
      if (!note.active) continue;

      const abs = audio.toAudioTime(note.time);
      const progress = 1 - (abs - now) / RELAX.approach;
      if (progress < 0) continue;

      const x = note.x * w;
      const y = progress * hitY;
      if (y > h * 1.05) continue;

      const isBloom = note.type === 'bloom';
      const isChain = note.type === 'chain';
      const isStill = note.type === 'still';
      const color = isBloom ? COLORS.bloom
        : isChain ? COLORS.chain
          : isStill ? COLORS.still
            : COLORS.orb;
      const r = radius * (isBloom ? 1.25 : isChain ? 0.72 : isStill ? 1.4 : 1);

      // Проявление из тумана в зоне спавна
      let alpha = 1;
      const yNorm = y / h;
      if (yNorm < ZONE.spawnEnd) alpha = Math.max(0, yNorm / ZONE.spawnEnd);
      if (note.judged) alpha *= Math.max(0, 1 - note.fade);
      if (alpha <= 0.01) continue;

      const scale = note.judged ? 1 + note.fade * 0.6 : 1;

      // Соединительная линия внутри цепочки
      if (isChain && note.linkTime >= 0) {
        const linkProgress = 1 - (audio.toAudioTime(note.linkTime) - now) / RELAX.approach;
        const linkY = linkProgress * hitY;
        ctx.globalAlpha = alpha * 0.3;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(note.linkX * w, linkY);
        ctx.lineTo(x, y);
        ctx.stroke();
      }

      ctx.globalCompositeOperation = 'lighter';
      fx.drawGlow(ctx, x, y, r * 2.1 * scale, color, alpha * 0.55);
      ctx.globalCompositeOperation = 'source-over';

      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.42 * scale, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = alpha * 0.7;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.78 * scale, 0, Math.PI * 2);
      ctx.stroke();

      if (isStill) {
        // Кольцо прогресса: сколько ещё держать палец
        ctx.globalAlpha = alpha * 0.25;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.05, 0, Math.PI * 2);
        ctx.stroke();

        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.05, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, note.holdFilled));
        ctx.stroke();
      }

      if (isBloom) {
        // Лепестки вокруг крупной ноты
        ctx.globalAlpha = alpha * 0.85;
        for (let p = 0; p < 6; p++) {
          const angle = now * 0.9 + (p / 6) * Math.PI * 2;
          const px = x + Math.cos(angle) * r * 1.05;
          const py = y + Math.sin(angle) * r * 1.05;
          ctx.beginPath();
          ctx.arc(px, py, r * 0.13, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.globalAlpha = 1;
    }
  }

  _drawCollector(ctx, w, now) {
    if (this.collectorAlpha <= 0.02) return;
    const radius = w * RELAX.collectorRadius;
    const color = this.flowActive ? COLORS.bloom : COLORS.orb;
    const pulse = 1 + Math.sin(now * 4) * (this.awaitingTouch ? 0.12 : 0.05);

    ctx.globalCompositeOperation = 'lighter';
    this.game.fx.drawGlow(ctx, this.collectorX, this.collectorY, radius * 1.5 * pulse, color, this.collectorAlpha * 0.5);
    ctx.globalCompositeOperation = 'source-over';

    if (this.awaitingTouch) {
      ctx.globalAlpha = 0.45 + Math.sin(now * 3) * 0.2;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash(this._dash);
      ctx.beginPath();
      ctx.arc(this.collectorX, this.collectorY, radius * (1.18 + Math.sin(now * 2.2) * 0.08), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash(this._solid);
    }

    ctx.globalAlpha = this.collectorAlpha * 0.8;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.collectorX, this.collectorY, radius * pulse, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = this.collectorAlpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(this.collectorX, this.collectorY, radius * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  stats() {
    // Учитываем только те ноты, которые успели появиться
    const seen = this.collected + this.missed;
    const accuracy = seen > 0 ? this.collected / seen : 0;
    return {
      mode: 'relax',
      failed: false,
      score: this.score,
      maxCombo: this.maxCombo,
      accuracy,
      total: seen,
      collected: this.collected,
      missed: this.missed,
      metrics: {
        notes: this.collected,
        score: this.score,
        combo: this.maxCombo,
        flow: this.flowActivations,
        perfect: 0,
      },
      rows: [
        [t('row.collected'), `${this.collected} / ${seen}`],
        [t('row.chains'), String(this.chainsDone)],
        [t('row.still'), String(this.stillsDone)],
        [t('row.flows'), String(this.flowActivations)],
        [t('row.bestCombo'), String(this.maxCombo)],
        [t('row.accuracy'), `${Math.round(accuracy * 100)}%`],
      ],
    };
  }
}
