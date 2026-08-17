/**
 * Визуальные эффекты: частицы, кольца попаданий, шлейф пальца,
 * тряска экрана и вспышки. Спрайты свечения кэшируются заранее,
 * чтобы не использовать дорогой shadowBlur в цикле отрисовки.
 */

import { createPool, createParticle, createRing, createFloater } from './pools.js';

const RIBBON_POINTS = 96;

export class Fx {
  constructor() {
    this.particles = createPool(500, createParticle);
    this.rings = createPool(40, createRing);
    this.floaters = createPool(48, createFloater);

    // Кольцевой буфер точек шлейфа
    this.ribbon = new Array(RIBBON_POINTS);
    for (let i = 0; i < RIBBON_POINTS; i++) {
      this.ribbon[i] = { x: 0, y: 0, life: 0, active: false };
    }
    this.ribbonHead = 0;

    this.shakeAmp = 0;
    this.shakeStart = 0;
    this.flash = 0;
    this.flashColor = '#ffffff';

    this._sprites = new Map();
  }

  reset() {
    this.particles.reset();
    this.rings.reset();
    this.floaters.reset();
    for (const point of this.ribbon) point.active = false;
    this.ribbonHead = 0;
    this.shakeAmp = 0;
    this.flash = 0;
  }

  /** Кэшированный спрайт радиального свечения. */
  glow(color, size) {
    const quantized = Math.max(8, Math.round(size / 6) * 6);
    const key = `${color}|${quantized}`;
    let sprite = this._sprites.get(key);
    if (sprite) return sprite;

    sprite = document.createElement('canvas');
    sprite.width = quantized * 2;
    sprite.height = quantized * 2;
    const ctx = sprite.getContext('2d');
    const gradient = ctx.createRadialGradient(quantized, quantized, 0, quantized, quantized, quantized);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.35, this._alpha(color, 0.55));
    gradient.addColorStop(1, this._alpha(color, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, quantized * 2, quantized * 2);

    this._sprites.set(key, sprite);
    return sprite;
  }

  drawGlow(ctx, x, y, radius, color, alpha = 1) {
    const sprite = this.glow(color, radius);
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * alpha;
    ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
    ctx.globalAlpha = prev;
  }

  // ── Частицы ──────────────────────────────────────────────────────────────

  burst(x, y, count, color, options = {}) {
    const speed = options.speed ?? 220;
    const spread = options.spread ?? Math.PI * 2;
    const angle0 = options.angle ?? 0;
    const gravity = options.gravity ?? 420;
    const size = options.size ?? 3.5;
    const life = options.life ?? 0.55;

    for (let i = 0; i < count; i++) {
      const p = this.particles.acquire();
      const angle = angle0 + (Math.random() - 0.5) * spread;
      const velocity = speed * (0.35 + Math.random() * 0.85);
      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * velocity;
      p.vy = Math.sin(angle) * velocity - (options.lift ?? 60);
      p.maxLife = life * (0.6 + Math.random() * 0.8);
      p.life = p.maxLife;
      p.size = size * (0.5 + Math.random());
      p.gravity = gravity;
      p.drag = options.drag ?? 0.9;
      p.color = color;
    }
  }

  /** Медленно всплывающие огоньки фона (RELAX). */
  seedFloaters(width, height) {
    for (let i = 0; i < this.floaters.size; i++) {
      const f = this.floaters.items[i];
      f.active = true;
      f.x = Math.random() * width;
      f.y = Math.random() * height;
      f.vy = -(6 + Math.random() * 18);
      f.size = 0.8 + Math.random() * 1.6;
      f.phase = Math.random() * Math.PI * 2;
      f.alpha = 0.05 + Math.random() * 0.13;
    }
  }

  ring(x, y, color, from, to, life = 0.45, width = 3) {
    const r = this.rings.acquire();
    r.active = true;
    r.x = x;
    r.y = y;
    r.color = color;
    r.from = from;
    r.to = to;
    r.maxLife = life;
    r.life = life;
    r.width = width;
  }

  pushRibbon(x, y, life = 0.35) {
    const point = this.ribbon[this.ribbonHead];
    point.x = x;
    point.y = y;
    point.life = life;
    point.active = true;
    this.ribbonHead = (this.ribbonHead + 1) % RIBBON_POINTS;
  }

  shake(now, amplitude) {
    if (amplitude <= this.shakeAmp && now - this.shakeStart < 0.1) return;
    this.shakeAmp = amplitude;
    this.shakeStart = now;
  }

  flashScreen(strength, color = '#ffffff') {
    this.flash = Math.max(this.flash, strength);
    this.flashColor = color;
  }

  /** Смещение экрана: A * e^(-γt) * sin(ωt). */
  shakeOffset(now) {
    if (this.shakeAmp <= 0) return 0;
    const elapsed = now - this.shakeStart;
    if (elapsed > 0.5) {
      this.shakeAmp = 0;
      return 0;
    }
    return this.shakeAmp * Math.exp(-7 * elapsed) * Math.sin(38 * elapsed);
  }

  update(dt, width, height) {
    for (let i = 0; i < this.particles.size; i++) {
      const p = this.particles.items[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      p.vy += p.gravity * dt;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    for (let i = 0; i < this.rings.size; i++) {
      const r = this.rings.items[i];
      if (!r.active) continue;
      r.life -= dt;
      if (r.life <= 0) r.active = false;
    }

    for (let i = 0; i < this.floaters.size; i++) {
      const f = this.floaters.items[i];
      if (!f.active) continue;
      f.phase += dt * 0.7;
      f.y += f.vy * dt;
      f.x += Math.sin(f.phase) * 12 * dt;
      if (f.y < -10) {
        f.y = height + 10;
        f.x = Math.random() * width;
      }
    }

    for (let i = 0; i < RIBBON_POINTS; i++) {
      const point = this.ribbon[i];
      if (!point.active) continue;
      point.life -= dt;
      if (point.life <= 0) point.active = false;
    }

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 3.2);
    }
  }

  drawFloaters(ctx, color) {
    for (let i = 0; i < this.floaters.size; i++) {
      const f = this.floaters.items[i];
      if (!f.active) continue;
      this.drawGlow(ctx, f.x, f.y, f.size * 6, color, f.alpha);
    }
  }

  drawParticles(ctx) {
    for (let i = 0; i < this.particles.size; i++) {
      const p = this.particles.items[i];
      if (!p.active) continue;
      const t = p.life / p.maxLife;
      this.drawGlow(ctx, p.x, p.y, p.size * 3.2, p.color, Math.min(1, t * 1.2));
    }
  }

  drawRings(ctx) {
    for (let i = 0; i < this.rings.size; i++) {
      const r = this.rings.items[i];
      if (!r.active) continue;
      const t = 1 - r.life / r.maxLife;
      const radius = r.from + (r.to - r.from) * t;
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * (1 - t * 0.6);
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  /** Шлейф пальца: соединяем точки от самой старой к самой новой. */
  drawRibbon(ctx, color) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;

    let prev = null;
    for (let i = 0; i < RIBBON_POINTS; i++) {
      const index = (this.ribbonHead + i) % RIBBON_POINTS;
      const point = this.ribbon[index];
      if (!point.active) { prev = null; continue; }
      if (prev) {
        const alpha = Math.min(1, point.life * 2.4);
        ctx.globalAlpha = alpha * 0.55;
        ctx.lineWidth = 2 + 16 * (i / RIBBON_POINTS) * alpha;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      }
      prev = point;
    }
    ctx.globalAlpha = 1;
  }

  drawFlash(ctx, width, height) {
    if (this.flash <= 0) return;
    ctx.globalAlpha = Math.min(0.6, this.flash);
    ctx.fillStyle = this.flashColor;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  }

  _alpha(hex, alpha) {
    const value = hex.replace('#', '');
    const full = value.length === 3
      ? value.split('').map((c) => c + c).join('')
      : value;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
}
