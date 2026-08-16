/**
 * Telegram Rhythm Game — базовый каркас
 * Единственный источник времени: AudioContext.currentTime
 */

// ─── Константы ───────────────────────────────────────────────────────────────

const LANES = 4;
const NOTE_POOL_SIZE = 512;
const PARTICLE_POOL_SIZE = 400;

const HIT_LINE_Y = 0.75;
const APPROACH_TIME = 2.0;

const TIMING = {
  PERFECT_PLUS: 0.022,
  PERFECT: 0.045,
  GREAT: 0.080,
  GOOD: 0.120,
};

const ACCURACY = {
  PERFECT_PLUS: { label: 'PERFECT+', mult: 1.2, hp: 2.0, haptic: ['impactOccurred', 'light'] },
  PERFECT:      { label: 'PERFECT',  mult: 1.0, hp: 1.0, haptic: ['impactOccurred', 'light'] },
  GREAT:        { label: 'GREAT',    mult: 0.7, hp: 0.5, haptic: ['impactOccurred', 'soft'] },
  GOOD:         { label: 'GOOD',     mult: 0.4, hp: 0.0, haptic: null },
  MISS:         { label: 'MISS',     mult: 0.0, hp: -8.0, haptic: ['notificationOccurred', 'error'] },
};

const NOTE_COLOR = '#00F0FF';
const BASE_SCORE = 1000;
const MAX_HP = 100;
const NOVICE_SHIELD_TIME = 15;
const NOVICE_SHIELD_MISSES = 3;

// ─── DOM ─────────────────────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);

const dom = {
  menu:            $('#menu'),
  gameScreen:      $('#game-screen'),
  resultScreen:    $('#result-screen'),
  canvas:          $('#game-canvas'),
  trackList:       $('#track-list'),
  customInput:     $('#custom-track-input'),
  customName:      $('#custom-track-name'),
  startBtn:        $('#start-btn'),
  backBtn:         $('#back-btn'),
  retryBtn:        $('#retry-btn'),
  menuBtn:         $('#menu-btn'),
  scoreDisplay:    $('#score-display'),
  comboDisplay:    $('#combo-display'),
  judgmentDisplay: $('#judgment-display'),
  hpBarFill:       $('#hp-bar-fill'),
  shieldIndicator: $('#shield-indicator'),
  finalScore:      $('#final-score'),
  finalCombo:      $('#final-combo'),
};

const ctx2d = dom.canvas.getContext('2d');

// ─── Telegram SDK ────────────────────────────────────────────────────────────

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

function triggerHaptic(accKey) {
  const cfg = ACCURACY[accKey];
  if (!cfg?.haptic || !tg?.HapticFeedback) return;
  const [method, style] = cfg.haptic;
  try { tg.HapticFeedback[method](style); } catch (_) { /* offline */ }
}

// ─── Аудио-движок ────────────────────────────────────────────────────────────

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.musicSource = null;
    this.buffer = null;
    this.musicStartTime = 0;
    this.audioOffset = 0;
  }

  async init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1.0;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    return this.ctx;
  }

  get currentTime() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Синтетический клик: 800 Гц, огибающая 15 мс, 0 мс задержки */
  playTapSound() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 800;
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.015);
    osc.connect(gain);
    gain.connect(this.masterGain || this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.02);
  }

  async loadFromUrl(url) {
    await this.init();
    if (window.location.protocol === 'file:') {
      throw new Error('Откройте игру через локальный сервер (npx serve), а не двойным кликом по index.html');
    }
    const response = await fetch(encodeURI(url));
    if (!response.ok) {
      throw new Error(`Файл не найден: ${url} (HTTP ${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(arrayBuffer);
    return this.buffer;
  }

  async loadFromFile(file) {
    await this.init();
    const arrayBuffer = await file.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(arrayBuffer);
    return this.buffer;
  }

  noteAbsoluteTime(songTime) {
    return this.musicStartTime + songTime + this.audioOffset;
  }

  songPosition() {
    if (!this.musicStartTime) return -1;
    return this.currentTime - this.musicStartTime - this.audioOffset;
  }

  startMusic() {
    if (!this.ctx || !this.buffer) return;
    this.stopMusic();
    this.musicSource = this.ctx.createBufferSource();
    this.musicSource.buffer = this.buffer;
    this.musicSource.connect(this.masterGain || this.ctx.destination);
    this.musicStartTime = this.currentTime + 0.05;
    this.musicSource.start(this.musicStartTime);
  }

  stopMusic() {
    if (this.musicSource) {
      try { this.musicSource.stop(); } catch (_) { /* already stopped */ }
      this.musicSource.disconnect();
      this.musicSource = null;
    }
  }

  pause() {
    if (this.ctx?.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }
}

// ─── Onset Detection & генерация карты ───────────────────────────────────────

function generateChartFromBuffer(buffer) {
  const sampleRate = buffer.sampleRate;
  const channel = buffer.numberOfChannels > 1
    ? mixToMono(buffer)
    : buffer.getChannelData(0);

  const frameSize = 2048;
  const hopSize = 512;
  const fluxFrames = [];
  let prevEnergy = 0;

  for (let i = 0; i + frameSize < channel.length; i += hopSize) {
    let energy = 0;
    for (let j = 0; j < frameSize; j++) {
      const s = channel[i + j];
      energy += s * s;
    }
    const flux = Math.max(0, energy - prevEnergy);
    fluxFrames.push({ time: i / sampleRate, flux });
    prevEnergy = energy;
  }

  if (fluxFrames.length < 4) {
    return buildFallbackChart(buffer.duration);
  }

  let sumFlux = 0;
  for (let i = 0; i < fluxFrames.length; i++) sumFlux += fluxFrames[i].flux;
  const meanFlux = sumFlux / fluxFrames.length;
  const threshold = meanFlux * 1.4;

  const rawOnsets = [];
  for (let i = 1; i < fluxFrames.length - 1; i++) {
    const f = fluxFrames[i];
    if (f.flux > threshold &&
        f.flux >= fluxFrames[i - 1].flux &&
        f.flux >= fluxFrames[i + 1].flux &&
        f.time > 0.3) {
      rawOnsets.push(f.time);
    }
  }

  if (rawOnsets.length < 3) {
    return buildFallbackChart(buffer.duration);
  }

  const intervals = [];
  const limit = Math.min(rawOnsets.length, 60);
  for (let i = 1; i < limit; i++) {
    const dt = rawOnsets[i] - rawOnsets[i - 1];
    if (dt > 0.2 && dt < 1.5) intervals.push(dt);
  }

  let beatInterval = 0.5;
  if (intervals.length > 0) {
    intervals.sort((a, b) => a - b);
    beatInterval = intervals[Math.floor(intervals.length / 2)];
    const bpm = Math.max(80, Math.min(160, Math.round(60 / beatInterval)));
    beatInterval = 60 / bpm;
  }

  const seen = new Set();
  const chart = [];
  for (let i = 0; i < rawOnsets.length; i++) {
    const q = Math.round(rawOnsets[i] / beatInterval) * beatInterval;
    const key = Math.round(q * 200);
    if (!seen.has(key) && q >= 0.5 && q <= buffer.duration - 0.5) {
      seen.add(key);
      chart.push({ time: q, lane: chart.length % LANES });
    }
  }

  const maxNotes = Math.floor(buffer.duration * 4);
  return chart.length > maxNotes ? chart.slice(0, maxNotes) : chart;
}

function mixToMono(buffer) {
  const len = buffer.length;
  const mono = new Float32Array(len);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += ch[i];
  }
  const scale = 1 / buffer.numberOfChannels;
  for (let i = 0; i < len; i++) mono[i] *= scale;
  return mono;
}

function buildFallbackChart(duration, bpm = 120) {
  const beatInterval = 60 / bpm;
  const chart = [];
  for (let t = 0.8; t < duration - 0.5; t += beatInterval) {
    chart.push({ time: t, lane: chart.length % LANES });
  }
  return chart;
}

// ─── Object Pools ─────────────────────────────────────────────────────────────

function createNotePool(size) {
  const pool = new Array(size);
  for (let i = 0; i < size; i++) {
    pool[i] = {
      active: false,
      lane: 0,
      songTime: 0,
      hit: false,
      missed: false,
      judged: false,
    };
  }
  return pool;
}

function createParticlePool(size) {
  const pool = new Array(size);
  for (let i = 0; i < size; i++) {
    pool[i] = {
      active: false,
      x: 0, y: 0,
      vx: 0, vy: 0,
      maxLife: 0,
      spawnTime: 0,
      color: NOTE_COLOR,
    };
  }
  return pool;
}

// ─── Игровая логика ──────────────────────────────────────────────────────────

class RhythmGame {
  constructor() {
    this.audio = new AudioEngine();
    this.notePool = createNotePool(NOTE_POOL_SIZE);
    this.particlePool = createParticlePool(PARTICLE_POOL_SIZE);
    this.chart = [];
    this.activeNoteCount = 0;

    this.state = 'menu';
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.hp = MAX_HP;
    this.missCount = 0;
    this.shieldActive = true;

    this.judgmentHideAt = 0;
    this.shakeAmplitude = 0;
    this.shakeStartTime = 0;

    this.canvasW = 0;
    this.canvasH = 0;
    this.laneWidth = 0;
    this.laneFlashUntil = [0, 0, 0, 0];

    this.rafId = 0;
    this.selectedTrack = 'audio/slow60.mp3';
    this.customFile = null;

    this._bindEvents();
    this._showServerHint();
    this._resize();
    window.addEventListener('resize', () => this._resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.audio.pause();
        cancelAnimationFrame(this.rafId);
      } else if (this.state === 'playing') {
        this.audio.resume();
        this._loop();
      }
    });
  }

  _showServerHint() {
    const hint = document.getElementById('server-hint');
    if (!hint) return;
    if (window.location.protocol === 'file:') {
      hint.textContent = '⚠ Для музыки запустите локальный сервер: npx serve';
    } else {
      hint.textContent = '';
    }
  }

  _bindEvents() {
    dom.trackList.addEventListener('click', (e) => {
      const btn = e.target.closest('.track-btn');
      if (!btn) return;
      dom.trackList.querySelectorAll('.track-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      this.selectedTrack = btn.dataset.track;
      this.customFile = null;
      dom.customName.textContent = '';
    });

    dom.customInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      this.customFile = file;
      dom.customName.textContent = file.name;
      dom.trackList.querySelectorAll('.track-btn').forEach(b => b.classList.remove('selected'));
    });

    dom.startBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.startGame();
    });

    dom.backBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.stopGame();
      this._showScreen('menu');
    });

    dom.retryBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.startGame();
    });

    dom.menuBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._showScreen('menu');
    });

    dom.gameScreen.addEventListener('pointerdown', (e) => {
      if (e.target === dom.backBtn) return;
      this._onPointerDown(e);
    });
  }

  _resize() {
    const rect = dom.gameScreen.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    this.canvasW = w;
    this.canvasH = h;
    dom.canvas.width = Math.round(w * dpr);
    dom.canvas.height = Math.round(h * dpr);
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.laneWidth = w / LANES;
  }

  _waitForLayout() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  _showScreen(name) {
    dom.menu.classList.toggle('active', name === 'menu');
    dom.gameScreen.classList.toggle('active', name === 'game');
    dom.resultScreen.classList.toggle('active', name === 'result');
    this.state = name === 'game' ? 'playing' : name === 'result' ? 'result' : 'menu';
  }

  async startGame() {
    try {
      await this.audio.init();
      this.audio.playTapSound();

      if (this.customFile) {
        await this.audio.loadFromFile(this.customFile);
      } else {
        await this.audio.loadFromUrl(this.selectedTrack);
      }

      this.chart = generateChartFromBuffer(this.audio.buffer);
      if (this.chart.length === 0) {
        throw new Error('Не удалось построить карту нот для этого трека');
      }
      this._initNotesFromChart();

      this.score = 0;
      this.combo = 0;
      this.maxCombo = 0;
      this.hp = MAX_HP;
      this.missCount = 0;
      this.shieldActive = true;
      this.judgmentHideAt = 0;
      this.shakeAmplitude = 0;

      this._updateHUD();
      dom.judgmentDisplay.textContent = '';
      dom.judgmentDisplay.className = 'judgment-display';
      dom.shieldIndicator.classList.remove('hidden');

      this._showScreen('game');
      await this._waitForLayout();
      this._resize();

      this.audio.startMusic();
      this._skipPastNotes();
      this._loop();
    } catch (err) {
      console.error(err);
      alert('Ошибка загрузки трека: ' + err.message);
    }
  }

  _initNotesFromChart() {
    for (let i = 0; i < NOTE_POOL_SIZE; i++) {
      this.notePool[i].active = false;
      this.notePool[i].hit = false;
      this.notePool[i].missed = false;
      this.notePool[i].judged = false;
    }

    this.activeNoteCount = Math.min(this.chart.length, NOTE_POOL_SIZE);
    for (let i = 0; i < this.activeNoteCount; i++) {
      const note = this.notePool[i];
      note.active = true;
      note.lane = this.chart[i].lane;
      note.songTime = this.chart[i].time;
      note.hit = false;
      note.missed = false;
      note.judged = false;
    }
  }

  _skipPastNotes() {
    // Пропускаем ноты, уже ушедшие мимо линии удара до старта (без штрафа HP)
    const songPos = this.audio.songPosition();
    for (let i = 0; i < this.activeNoteCount; i++) {
      const note = this.notePool[i];
      if (!note.active || note.hit || note.missed) continue;
      if (note.songTime < songPos - TIMING.GOOD) {
        note.missed = true;
        note.judged = true;
      }
    }
  }

  stopGame() {
    cancelAnimationFrame(this.rafId);
    this.audio.stopMusic();
    this.state = 'menu';
  }

  _loop() {
    if (this.state !== 'playing') return;
    this._update();
    this._render();
    this.rafId = requestAnimationFrame(() => this._loop());
  }

  _update() {
    const now = this.audio.currentTime;
    const songPos = this.audio.songPosition();

    this.shieldActive = songPos < NOVICE_SHIELD_TIME || this.missCount <= NOVICE_SHIELD_MISSES;
    dom.shieldIndicator.classList.toggle('hidden', !this.shieldActive);

    for (let i = 0; i < this.activeNoteCount; i++) {
      const note = this.notePool[i];
      if (!note.active || note.hit || note.missed) continue;

      const absHit = this.audio.noteAbsoluteTime(note.songTime);
      if (now > absHit + TIMING.GOOD) {
        note.missed = true;
        note.judged = true;
        this._applyJudgment('MISS');
      }
    }

    if (this.hp <= 0) {
      this.hp = 0;
      this._updateHUD();
      this._endGame();
      return;
    }

    if (this.audio.buffer && songPos > this.audio.buffer.duration + 1) {
      this._endGame();
      return;
    }

    if (this.judgmentHideAt > 0 && now > this.judgmentHideAt) {
      dom.judgmentDisplay.textContent = '';
      dom.judgmentDisplay.className = 'judgment-display';
      this.judgmentHideAt = 0;
    }

    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const p = this.particlePool[i];
      if (!p.active) continue;
      const elapsed = now - p.spawnTime;
      if (elapsed > p.maxLife) {
        p.active = false;
        continue;
      }
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.4;
    }

    this._updateHUD();
  }

  _noteScreenY(note, now, h) {
    const timeUntilHit = this.audio.noteAbsoluteTime(note.songTime) - now;
    const progress = 1 - (timeUntilHit / APPROACH_TIME);
    return progress * HIT_LINE_Y * h;
  }

  _onPointerDown(e) {
    if (this.state !== 'playing') return;
    e.preventDefault();

    this.audio.playTapSound();

    const rect = dom.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const laneWidth = rect.width / LANES;
    const lane = Math.min(LANES - 1, Math.max(0, Math.floor(x / laneWidth)));
    const tInput = this.audio.currentTime;
    const now = tInput;
    const h = rect.height;
    const noteH = h * 0.04;

    this.laneFlashUntil[lane] = now + 0.12;

    let spatialNote = null;
    let spatialDist = Infinity;
    let windowNote = null;
    let windowDelta = Infinity;
    let visibleNote = null;
    let visibleDelta = Infinity;

    for (let i = 0; i < this.activeNoteCount; i++) {
      const note = this.notePool[i];
      if (!note.active || note.hit || note.missed || note.lane !== lane) continue;

      const absHit = this.audio.noteAbsoluteTime(note.songTime);
      const timeUntilHit = absHit - now;
      if (timeUntilHit > APPROACH_TIME || timeUntilHit < -TIMING.GOOD) continue;

      const delta = Math.abs(tInput - absHit);
      const noteY = this._noteScreenY(note, now, h);
      const distY = Math.abs(y - noteY);

      if (distY < noteH * 2.5 && distY < spatialDist) {
        spatialDist = distY;
        spatialNote = note;
      }
      if (delta <= TIMING.GOOD && delta < windowDelta) {
        windowDelta = delta;
        windowNote = note;
      }
      if (delta < visibleDelta) {
        visibleDelta = delta;
        visibleNote = note;
      }
    }

    const bestNote = spatialNote || windowNote || visibleNote;
    if (!bestNote) return;

    const absHit = this.audio.noteAbsoluteTime(bestNote.songTime);
    const delta = Math.abs(tInput - absHit);
    bestNote.hit = true;
    bestNote.judged = true;

    // Клик по видимой плитке всегда засчитывается; точность — по близости к линии удара
    const accKey = delta <= TIMING.GOOD ? this._getAccuracyKey(delta) : 'GOOD';
    this._applyJudgment(accKey);
    this._spawnParticles(lane, accKey, this._noteScreenY(bestNote, now, this.canvasH));
  }

  _getAccuracyKey(delta) {
    if (delta <= TIMING.PERFECT_PLUS) return 'PERFECT_PLUS';
    if (delta <= TIMING.PERFECT) return 'PERFECT';
    if (delta <= TIMING.GREAT) return 'GREAT';
    if (delta <= TIMING.GOOD) return 'GOOD';
    return 'MISS';
  }

  _applyJudgment(accKey) {
    const acc = ACCURACY[accKey];
    triggerHaptic(accKey);

    if (accKey === 'MISS') {
      this.combo = 0;
      this.missCount++;
    } else {
      this.combo++;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    }

    if (this.combo === 10 || this.combo === 25 || this.combo === 50) {
      this.shakeAmplitude = this.combo >= 50 ? 8 : this.combo >= 25 ? 5 : 3;
      this.shakeStartTime = this.audio.currentTime;
    }

    const songPos = this.audio.songPosition();
    this.shieldActive = songPos < NOVICE_SHIELD_TIME || this.missCount <= NOVICE_SHIELD_MISSES;
    let hpDelta = acc.hp;
    if (hpDelta < 0 && this.shieldActive) hpDelta = 0;
    this.hp = Math.min(MAX_HP, Math.max(0, this.hp + hpDelta));
    dom.shieldIndicator.classList.toggle('hidden', !this.shieldActive);

    if (acc.mult > 0) {
      const comboMult = Math.min(1.0 + Math.floor(this.combo / 10) * 0.1, 4.0);
      this.score += Math.round(BASE_SCORE * acc.mult * comboMult);
    }

    dom.judgmentDisplay.textContent = acc.label;
    dom.judgmentDisplay.className = 'judgment-display ' + accKey.toLowerCase().replace('_', '-');
    this.judgmentHideAt = this.audio.currentTime + 0.6;
  }

  _spawnParticles(lane, accKey, atY) {
    const count = 15 + Math.floor(Math.random() * 11);
    const cx = lane * this.laneWidth + this.laneWidth / 2;
    const cy = Number.isFinite(atY) ? atY : HIT_LINE_Y * this.canvasH;
    const now = this.audio.currentTime;

    let spawned = 0;
    for (let i = 0; i < PARTICLE_POOL_SIZE && spawned < count; i++) {
      const p = this.particlePool[i];
      if (p.active) continue;
      p.active = true;
      p.x = cx;
      p.y = cy;
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 4;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed - 2;
      p.maxLife = 0.4 + Math.random() * 0.3;
      p.spawnTime = now;
      p.color = accKey === 'PERFECT_PLUS' ? '#ffffff' : NOTE_COLOR;
      spawned++;
    }
  }

  _updateHUD() {
    dom.scoreDisplay.textContent = this.score.toLocaleString();
    dom.comboDisplay.textContent = 'x' + this.combo;
    dom.hpBarFill.style.width = this.hp + '%';
  }

  _endGame() {
    cancelAnimationFrame(this.rafId);
    this.audio.stopMusic();
    dom.finalScore.textContent = this.score.toLocaleString();
    dom.finalCombo.textContent = this.maxCombo;
    this._showScreen('result');
  }

  _render() {
    const w = this.canvasW;
    const h = this.canvasH;
    const now = this.audio.currentTime;

    let shakeX = 0;
    if (this.shakeAmplitude > 0) {
      const elapsed = now - this.shakeStartTime;
      if (elapsed < 0.4) {
        shakeX = this.shakeAmplitude * Math.exp(-8 * elapsed) * Math.sin(40 * elapsed);
      } else {
        this.shakeAmplitude = 0;
      }
    }

    ctx2d.save();
    ctx2d.clearRect(0, 0, w, h);
    ctx2d.translate(shakeX, 0);

    this._drawBackground(w, h);
    this._drawLanes(w, h);
    this._drawHitPads(w, h, now);
    this._drawHitLine(w, h);
    this._drawNotes(w, h, now);
    this._drawParticles(now);

    ctx2d.restore();
  }

  _drawBackground(w, h) {
    const grad = ctx2d.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#12121f');
    grad.addColorStop(0.15, '#0d0d18');
    grad.addColorStop(0.70, '#0d0d18');
    grad.addColorStop(1, '#0a0a12');
    ctx2d.fillStyle = grad;
    ctx2d.fillRect(0, 0, w, h);
  }

  _drawLanes(w, h) {
    ctx2d.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx2d.lineWidth = 1;
    for (let i = 1; i < LANES; i++) {
      const x = i * this.laneWidth;
      ctx2d.beginPath();
      ctx2d.moveTo(x, 0);
      ctx2d.lineTo(x, h);
      ctx2d.stroke();
    }
  }

  _drawHitPads(w, h, now) {
    const padY = HIT_LINE_Y * h;
    const padH = h * 0.07;
    const padW = this.laneWidth * 0.72;

    for (let i = 0; i < LANES; i++) {
      const flashing = now < this.laneFlashUntil[i];
      const cx = i * this.laneWidth + this.laneWidth / 2;
      ctx2d.fillStyle = flashing ? 'rgba(0, 240, 255, 0.35)' : 'rgba(0, 240, 255, 0.08)';
      ctx2d.strokeStyle = flashing ? 'rgba(0, 240, 255, 0.9)' : 'rgba(0, 240, 255, 0.25)';
      ctx2d.lineWidth = flashing ? 3 : 1;
      ctx2d.beginPath();
      ctx2d.rect(cx - padW / 2, padY - padH / 2, padW, padH);
      ctx2d.fill();
      ctx2d.stroke();
    }
  }

  _drawHitLine(w, h) {
    const y = HIT_LINE_Y * h;
    ctx2d.strokeStyle = 'rgba(0, 240, 255, 0.7)';
    ctx2d.lineWidth = 2;
    ctx2d.shadowColor = '#00f0ff';
    ctx2d.shadowBlur = 8;
    ctx2d.beginPath();
    ctx2d.moveTo(0, y);
    ctx2d.lineTo(w, y);
    ctx2d.stroke();
    ctx2d.shadowBlur = 0;
  }

  _drawNotes(w, h, now) {
    const noteH = h * 0.04;
    const noteW = this.laneWidth * 0.7;

    for (let i = 0; i < this.activeNoteCount; i++) {
      const note = this.notePool[i];
      if (!note.active || note.hit || note.missed) continue;

      const absHit = this.audio.noteAbsoluteTime(note.songTime);
      const timeUntilHit = absHit - now;

      if (timeUntilHit > APPROACH_TIME || timeUntilHit < -TIMING.GOOD) continue;

      const progress = 1 - (timeUntilHit / APPROACH_TIME);
      const yCenter = progress * HIT_LINE_Y * h;
      const xCenter = note.lane * this.laneWidth + this.laneWidth / 2;

      let alpha = 1;
      const yNorm = yCenter / h;
      if (yNorm < 0.15) alpha = yNorm / 0.15;

      ctx2d.globalAlpha = alpha;
      ctx2d.fillStyle = NOTE_COLOR;
      ctx2d.shadowColor = NOTE_COLOR;
      ctx2d.shadowBlur = 10;

      const rx = xCenter - noteW / 2;
      const ry = yCenter - noteH / 2;
      const r = 6;
      ctx2d.beginPath();
      ctx2d.moveTo(rx + r, ry);
      ctx2d.lineTo(rx + noteW - r, ry);
      ctx2d.quadraticCurveTo(rx + noteW, ry, rx + noteW, ry + r);
      ctx2d.lineTo(rx + noteW, ry + noteH - r);
      ctx2d.quadraticCurveTo(rx + noteW, ry + noteH, rx + noteW - r, ry + noteH);
      ctx2d.lineTo(rx + r, ry + noteH);
      ctx2d.quadraticCurveTo(rx, ry + noteH, rx, ry + noteH - r);
      ctx2d.lineTo(rx, ry + r);
      ctx2d.quadraticCurveTo(rx, ry, rx + r, ry);
      ctx2d.closePath();
      ctx2d.fill();

      ctx2d.shadowBlur = 0;
      ctx2d.globalAlpha = 1;
    }
  }

  _drawParticles(now) {
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const p = this.particlePool[i];
      if (!p.active) continue;
      const elapsed = now - p.spawnTime;
      const life = 1 - elapsed / p.maxLife;
      if (life <= 0) continue;
      ctx2d.globalAlpha = life;
      ctx2d.fillStyle = p.color;
      ctx2d.beginPath();
      ctx2d.arc(p.x, p.y, 3 * life, 0, Math.PI * 2);
      ctx2d.fill();
    }
    ctx2d.globalAlpha = 1;
  }
}

const game = new RhythmGame();
