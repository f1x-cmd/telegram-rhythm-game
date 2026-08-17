/**
 * Точка входа: связывает аудио, анализ, режимы и интерфейс.
 * Игровой цикл целиком опирается на AudioContext.currentTime.
 */

import { MODES, TRACKS, RELAX, DRIVE_DIFFICULTY } from './config.js';
import { initTelegram, storage } from './telegram.js';
import { AudioEngine } from './audio-engine.js';
import { analyzeAudio, buildDriveChart, buildRelaxChart } from './analysis.js';
import { createPool, createNote } from './pools.js';
import { Fx } from './fx.js';
import { PointerTracker } from './input.js';
import { RelaxMode } from './relax.js';
import { DriveMode } from './drive.js';
import { Ui } from './ui.js';
import { loadRecords, bestFor, submit } from './records.js';
import { loadDaily, status as dailyStatus, addResult as addDailyResult } from './daily.js';
import { t, loadLanguage, setLanguage, applyStaticText } from './i18n.js';
import { loadCareer, addCareer } from './career.js';
import {
  loadSocial, snapshot as socialSnapshot, shareInvite, createClan, joinClan,
  leaveClan, takeToast, syncSelfScore, me,
} from './social.js';
import {
  loadLiveOps, liveops, activeTracks, scoreMultiplier, shieldConfig, isBanned,
} from './liveops.js';
import { loadTelemetry, logEvent } from './telemetry.js';

const OFFSET_KEY = 'audio_offset';

class Game {
  constructor() {
    this.audio = new AudioEngine();
    this.fx = new Fx();
    this.notePool = createPool(4000, createNote);
    this.pointers = new PointerTracker();

    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.field = document.getElementById('game-screen');

    this.width = 0;
    this.height = 0;
    this.dpr = 1;

    this.state = 'menu';
    this.mode = null;
    this.modeId = 'relax';
    this.difficulty = 'medium';
    this.trackId = TRACKS[0].id;
    this.customFile = null;
    this.offsetMs = 0;
    this.board = 'global';

    this.relax = new RelaxMode(this);
    this.drive = new DriveMode(this);

    this.ui = new Ui({
      onModeChange: (id) => this._selectMode(id),
      onDifficultyChange: (key) => { this.difficulty = key; this._syncMenu(); },
      onTrackChange: (id) => { this.trackId = id; this.customFile = null; this._warmTrack(); this._syncMenu(); },
      onCustomFile: (file) => { this.customFile = file; this._syncMenu(); },
      onOffsetChange: (ms) => this._setOffset(ms),
      onLanguageChange: (code) => this._setLanguage(code),
      onPlay: () => this.start(),
      onBack: () => this._toMenu(),
      onRetry: () => this.start(),
      onMenu: () => this._toMenu(),
      onOpenProfile: () => this._openProfile(),
      onBoardChange: (board) => this._openProfile(board),
      onInvite: (kind) => this._invite(kind),
      onCreateClan: (name) => this._createClan(name),
      onJoinClan: (code) => this._joinClan(code),
      onLeaveClan: () => this._leaveClan(),
      onDonate: (stars) => logEvent('donate', { stars }),
    });
    this.hud = this.ui.hud;

    this._rafId = 0;
    this._lastTime = 0;

    this._bindEvents();
    this._resize();
    applyStaticText();
    this._ready = this._loadSettings();
    this._syncMenu();
    this._warmTrack();
    this.ui.showScreen('menu');
  }

  // ── Настройки и меню ─────────────────────────────────────────────────────

  async _loadSettings() {
    // Ручной выбор языка мог быть сохранён ранее — он важнее автоопределения
    await loadLanguage();
    this.ui.retranslate();

    const saved = await storage.get(OFFSET_KEY);
    const value = Number(saved);
    if (Number.isFinite(value) && value >= -200 && value <= 200) {
      this.offsetMs = value;
      this.audio.offset = value / 1000;
    }
    await loadRecords();
    await loadLiveOps();
    await loadTelemetry();
    await loadDaily();
    await loadCareer();
    await loadSocial();
    const toast = takeToast();
    const featured = liveops().featuredMode;
    if (featured && MODES[featured]) this.modeId = featured;
    const tracks = activeTracks();
    if (tracks.length && !tracks.some((item) => item.id === this.trackId)) {
      this.trackId = tracks[0].id;
    }
    this._syncMenu();
    this._warmTrack();
    if (toast) this.ui.showToast(t(toast));
  }

  _warmTrack() {
    if (this.customFile) return;
    const track = TRACKS.find((item) => item.id === this.trackId);
    if (track?.url) this.audio.prefetch(track.url);
  }

  _setOffset(ms) {
    this.offsetMs = Math.max(-200, Math.min(200, Math.round(ms)));
    this.audio.offset = this.offsetMs / 1000;
    storage.set(OFFSET_KEY, this.offsetMs);
  }

  _setLanguage(code) {
    setLanguage(code);
    this.ui.retranslate();
    this._syncMenu();
    if (this.state === 'profile') this._openProfile(this.board);
  }

  _selectMode(id) {
    if (!MODES[id]) return;
    this.modeId = id;
    // Подсказываем подходящий трек при переключении режима
    const tracks = activeTracks();
    const suitable = tracks.find((track) => track.mood === id) ?? tracks[0];
    if (suitable && !this.customFile) this.trackId = suitable.id;
    this._warmTrack();
    this._syncMenu();
  }

  _syncMenu() {
    const tracks = activeTracks();
    const records = {};
    for (const track of tracks) {
      records[track.id] = bestFor(this.modeId, track.id, this.difficulty);
    }

    this.ui.syncMenu({
      mode: this.modeId,
      difficulty: this.difficulty,
      trackId: this.trackId,
      customFile: this.customFile,
      offsetMs: this.offsetMs,
      records,
      daily: dailyStatus(),
      profile: socialSnapshot(),
    });
  }

  _openProfile(board) {
    if (board) this.board = board;
    if (this.state === 'playing' || this.state === 'loading') this.abort();
    this.state = 'profile';
    this.ui.syncProfile(socialSnapshot(), this.board);
    this.ui.showScreen('profile');
  }

  _invite(kind) {
    const result = shareInvite(kind);
    logEvent('invite', { kind });
    if (!result.shared) this.ui.showToast(t('profile.copied'));
  }

  _createClan(name) {
    const clan = createClan(name);
    if (!clan) {
      this.ui.showToast(t('profile.needName'));
      return;
    }
    this.board = 'clan';
    this.ui.syncProfile(socialSnapshot(), 'clan');
  }

  _joinClan(code) {
    const clan = joinClan(code);
    if (!clan) {
      this.ui.showToast(t('profile.needCode'));
      return;
    }
    this.board = 'clan';
    this.ui.syncProfile(socialSnapshot(), 'clan');
  }

  _leaveClan() {
    leaveClan();
    this.board = 'clan';
    this.ui.syncProfile(socialSnapshot(), 'clan');
  }

  _toMenu() {
    this.abort();
    this.ui.showScreen('menu');
    this._syncMenu();
  }

  // ── События ──────────────────────────────────────────────────────────────

  _bindEvents() {
    window.addEventListener('resize', () => this._resize());
    window.addEventListener('orientationchange', () => this._resize());

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.audio.pause();
        cancelAnimationFrame(this._rafId);
        this._rafId = 0;
      } else if (this.state === 'playing') {
        this.audio.resume();
        this._lastTime = this.audio.time;
        this._loop();
      }
    });

    const field = this.field;
    field.addEventListener('pointerdown', (event) => {
      if (this.state !== 'playing') return;
      if (event.target.closest('button')) return;
      event.preventDefault();
      this.ui.dismissCoach(this.modeId);
      try { field.setPointerCapture(event.pointerId); } catch (_) { /* не критично */ }
      const { x, y } = this._localPoint(event);
      const slot = this.pointers.down(event.pointerId, x, y, this.audio.time);
      if (slot) this.mode?.onDown(slot);
    });

    field.addEventListener('pointermove', (event) => {
      if (this.state !== 'playing') return;
      const { x, y } = this._localPoint(event);
      const slot = this.pointers.move(event.pointerId, x, y);
      if (slot) this.mode?.onMove(slot);
    });

    const release = (event) => {
      if (this.state !== 'playing') return;
      const slot = this.pointers.up(event.pointerId);
      if (slot) this.mode?.onUp(slot);
    };
    field.addEventListener('pointerup', release);
    field.addEventListener('pointercancel', release);
    field.addEventListener('lostpointercapture', release);
  }

  _localPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  _resize() {
    const rect = this.field.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  _nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  // ── Запуск партии ────────────────────────────────────────────────────────

  async start() {
    if (this.state === 'loading') return;
    await this._ready;
    await loadLiveOps();

    if (isBanned(me().id)) {
      this.ui.showError(t('ops.banned'));
      this._syncMenu();
      return;
    }
    if (liveops().maintenance) {
      this.ui.showError(liveops().maintenanceText || t('ops.maintenance'));
      this._syncMenu();
      return;
    }
    const catalog = activeTracks();
    if (!this.customFile) {
      if (!catalog.length) {
        this.ui.showError(t('ops.noTracks'));
        this._syncMenu();
        return;
      }
      if (!catalog.some((item) => item.id === this.trackId)) {
        this.trackId = catalog[0].id;
      }
    }

    this.state = 'loading';
    this.ui.showError('');

    const track = TRACKS.find((item) => item.id === this.trackId) ?? catalog[0] ?? TRACKS[0];

    try {
      this.ui.showScreen('game');
      this.ui.prepareHud(this.modeId);
      this.ui.setLoading(t('load.track'));
      await this._nextFrame();

      await this.audio.init();
      if (this.customFile) await this.audio.loadFile(this.customFile);
      else await this.audio.loadUrl(track.url);

      this.ui.setLoading(t('load.analyze'));
      await this._nextFrame();
      await this._nextFrame();

      const analysis = analyzeAudio(this.audio.buffer);
      const chart = this.modeId === 'relax'
        ? buildRelaxChart(analysis)
        : buildDriveChart(analysis, this.difficulty);

      if (chart.notes.length === 0) {
        throw new Error(t('error.rhythm'));
      }

      this._resize();
      this.fx.reset();
      this.pointers.reset();

      this.mode = this.modeId === 'relax' ? this.relax : this.drive;
      this.mode.start(chart, this.difficulty);

      const approach = this.modeId === 'relax' ? RELAX.approach : DRIVE_DIFFICULTY[this.difficulty].approach;
      this.audio.startMusic(approach + 0.7);

      this.ui.setLoading('');
      this.state = 'playing';
      this._lastTime = this.audio.time;
      this._loop();
    } catch (error) {
      console.error(error);
      this.state = 'menu';
      this.ui.setLoading('');
      this.ui.showScreen('menu');
      this.ui.showError(error.message || t('error.start'));
    }
  }

  abort() {
    cancelAnimationFrame(this._rafId);
    this._rafId = 0;
    this.audio.stopMusic();
    this.mode?.stop();
    this.pointers.reset();
    this.state = 'menu';
  }

  _loop() {
    if (this.state !== 'playing') return;

    const now = this.audio.time;
    let dt = now - this._lastTime;
    this._lastTime = now;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 1 / 30); // ограничение шага при низком FPS

    const songTime = this.audio.songTime();
    this.audio.sampleSpectrum();

    this.ui.setNow(now);
    this.mode.update(now, songTime, dt);
    this.fx.update(dt, this.width, this.height);

    const ctx = this.ctx;
    const shake = this.fx.shakeOffset(now);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.save();
    ctx.translate(shake, shake * 0.35);
    this.mode.render(ctx, now, songTime);
    ctx.restore();

    const shield = shieldConfig();
    const shieldOn = this.modeId === 'drive'
      ? this.mode.shieldActive && (songTime < shield.time || this.mode.misses < shield.misses)
      : this.mode.flowActive;
    this.ui.tick(now, this.mode, shieldOn);

    if (this.mode.finished) {
      this._finish();
      return;
    }

    this._rafId = requestAnimationFrame(() => this._loop());
  }

  _finish() {
    cancelAnimationFrame(this._rafId);
    this._rafId = 0;
    this.state = 'result';
    this.audio.stopMusic();

    const stats = this.mode.stats();
    this.mode.stop();

    const mult = scoreMultiplier();
    if (mult > 1) {
      stats.score = Math.round(stats.score * mult);
      if (stats.metrics) stats.metrics.score = stats.score;
    }

    const track = TRACKS.find((item) => item.id === this.trackId) ?? TRACKS[0];
    const mode = MODES[this.modeId];
    // Рекорды ведутся только по встроенным трекам: свой файл каждый раз новый
    const record = this.customFile
      ? null
      : submit(this.modeId, this.trackId, this.difficulty, stats.score);
    const daily = addDailyResult(stats);
    addCareer({ ...stats, mode: this.modeId });
    syncSelfScore();
    logEvent('play', {
      mode: this.modeId,
      track: this.customFile ? 'custom' : this.trackId,
      difficulty: this.difficulty,
      score: stats.score,
      accuracy: stats.accuracy,
      failed: Boolean(stats.failed),
      mult,
    });

    this.ui.showResult(stats, {
      modeTitle: mode.title,
      accent: mode.accent,
      trackTitle: this.customFile ? this.customFile.name.replace(/\.[^.]+$/, '') : track.title,
      record,
      daily,
    });
  }
}

initTelegram();
window.game = new Game();
