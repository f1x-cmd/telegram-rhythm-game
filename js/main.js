/**
 * Точка входа: связывает аудио, анализ, режимы и интерфейс.
 * Игровой цикл целиком опирается на AudioContext.currentTime.
 */

import { MODES, TRACKS, RELAX, DRIVE_DIFFICULTY, CUSTOM_AUDIO_MAX_BYTES } from './config.js';
import { initTelegram, storage, onBackButton, onAppHidden, haptic } from './telegram.js';
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
  leaveClan, takeToast, refreshStartParam, syncSelfScore, me,
} from './social.js';
import {
  loadLiveOps, liveops, activeTracks, tracksForMode, scoreMultiplier, shieldConfig, isBanned,
} from './liveops.js';
import { loadTelemetry, logEvent } from './telemetry.js';

const OFFSET_KEY = 'audio_offset';
const LAST_TRACK_KEY = 'last_track_v1';

class Game {
  constructor() {
    this.audio = new AudioEngine();
    this.fx = new Fx();
    this.notePool = createPool(800, createNote);
    this.pointers = new PointerTracker();

    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.field = document.getElementById('game-screen');

    this.width = 0;
    this.height = 0;
    this.dpr = 1;

    this.state = 'menu';
    this.mode = null;
    this.modeId = 'relax';
    this.difficulty = 'easy';
    this.trackId = TRACKS[0].id;
    this.customFile = null;
    this._lastByMode = { relax: 'slow60', drive: 'velocity' };
    this.offsetMs = 0;
    this.board = 'global';

    this.relax = new RelaxMode(this);
    this.drive = new DriveMode(this);

    this.ui = new Ui({
      onModeChange: (id) => this._selectMode(id),
      onDifficultyChange: (key) => { this.difficulty = key; this._syncMenu(); },
      onTrackChange: (id) => this._selectTrack(id),
      onCustomFile: (file) => this._setCustomFile(file),
      onOffsetChange: (ms) => this._setOffset(ms),
      onLanguageChange: (code) => this._setLanguage(code),
      onPlay: () => { this.audio.init(); this.start(); },
      onPause: () => this.pauseGame(),
      onResume: () => this.resumeGame(),
      onSaveScore: () => this.saveScore(),
      onBack: () => this._toMenu(),
      onRetry: () => { this.audio.init(); this.start(); },
      onMenu: () => this._toMenu(),
      onOpenProfile: () => this._openProfile(),
      onBoardChange: (board) => this._openProfile(board),
      onInvite: (kind) => this._invite(kind),
      onCreateClan: (name) => this._createClan(name),
      onJoinClan: (code) => this._joinClan(code),
      onLeaveClan: () => this._leaveClan(),
      onDonate: (stars) => logEvent('donate', { stars }),
      onChallengeResult: (score) => this._challengeResult(score),
    });
    this.hud = this.ui.hud;

    this._rafId = 0;
    this._lastTime = 0;
    this._playStartedAt = 0;
    this._analysisCache = new Map();
    this._ios = /iP(hone|ad|od)/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    document.addEventListener('pointerdown', () => { this.audio.init(); }, { once: true });
    this._bindEvents();
    this._resize();
    applyStaticText();
    this._ready = this._loadSettings();
    this._syncMenu();
    this._warmTrack();
    this.ui.showScreen('menu');

    onBackButton(() => {
      if (this.ui.isLibraryOpen()) {
        this.ui.closeLibrary();
        return;
      }
      if (this.state === 'playing') this.pauseGame();
      else if (this.state === 'paused') this._toMenu();
      else if (this.state === 'loading') this._toMenu();
      else if (this.state === 'result' || this.state === 'profile') this._toMenu();
    });
    onAppHidden(() => this.pauseGame());
  }

  _setCustomFile(file) {
    if (file.size > CUSTOM_AUDIO_MAX_BYTES) {
      this.ui.showError(t('error.fileTooBig'));
      this.ui.resetFileInput();
      return;
    }
    this.customFile = file;
    this.ui.showError('');
    this._syncMenu();
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
    const savedTracks = await storage.get(LAST_TRACK_KEY);
    if (savedTracks) {
      try {
        const parsed = JSON.parse(savedTracks);
        if (parsed && typeof parsed === 'object') {
          this._lastByMode = { ...this._lastByMode, ...parsed };
        }
      } catch (_) { /* битая запись */ }
    }
    const toast = takeToast();
    const featured = liveops().featuredMode;
    if (featured && MODES[featured]) this.modeId = featured;
    const picked = this._trackForMode(this.modeId);
    if (picked) this.trackId = picked;
    this._syncMenu();
    this._warmTrack();
    if (toast) this.ui.showToast(t(toast));
  }

  _trackForMode(modeId) {
    const list = tracksForMode(modeId);
    const fallback = activeTracks();
    const pool = list.length ? list : fallback;
    if (!pool.length) return null;
    if (pool.some((item) => item.id === this.trackId)) return this.trackId;
    const last = this._lastByMode[modeId];
    if (pool.some((item) => item.id === last)) return last;
    return pool[0].id;
  }

  _rememberTrack() {
    if (this.customFile) return;
    this._lastByMode[this.modeId] = this.trackId;
    storage.set(LAST_TRACK_KEY, JSON.stringify(this._lastByMode));
  }

  _selectTrack(id) {
    this.trackId = id;
    this.customFile = null;
    this._rememberTrack();
    this._warmTrack();
    this._syncMenu();
  }

  _warmTrack() {
    if (this.customFile) return;
    for (const track of activeTracks()) {
      if (track?.url) this.audio.prefetch(track.url);
    }
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
    if (!this.customFile) {
      const picked = this._trackForMode(id);
      if (picked) this.trackId = picked;
    }
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

  _challengeResult(score) {
    const result = shareInvite('challenge', { score });
    logEvent('invite', { kind: 'challenge', score });
    if (!result.shared) this.ui.showToast(t('profile.copied'));
  }

  _toMenu() {
    this.abort();
    this.ui.showScreen('menu');
    loadLiveOps({ force: true }).then(() => this._syncMenu());
  }

  // ── События ──────────────────────────────────────────────────────────────

  _bindEvents() {
    window.addEventListener('resize', () => this._resize());
    window.addEventListener('orientationchange', () => this._resize());

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pauseGame();
      } else {
        loadLiveOps({ force: true }).then(() => {
          const toast = refreshStartParam();
          if (toast) this.ui.showToast(t(toast));
          this._syncMenu();
        });
      }
    });
    window.addEventListener('pagehide', () => this.pauseGame());

    const field = this.field;
    field.addEventListener('pointerdown', (event) => {
      if (this.state !== 'playing') return;
      if (event.target.closest('button')) return;
      event.preventDefault();
      this.audio.init();
      this.ui.dismissCoach(this.modeId, this.difficulty);
      if (!this._ios) {
        try { field.setPointerCapture(event.pointerId); } catch (_) { /* не критично */ }
      }
      const { x, y } = this._localPoint(event);
      const slot = this.pointers.down(event.pointerId, x, y, this.audio.time);
      if (slot) this.mode?.onDown(slot);
    });

    field.addEventListener('pointermove', (event) => {
      if (this.state !== 'playing') return;
      const samples = typeof event.getCoalescedEvents === 'function'
        ? event.getCoalescedEvents()
        : null;
      const points = samples && samples.length ? samples : [event];
      for (const sample of points) {
        const { x, y } = this._localPoint(sample);
        const slot = this.pointers.move(event.pointerId, x, y);
        if (slot) this.mode?.onMove(slot);
      }
    });

    const release = (event) => {
      if (this.state !== 'playing') return;
      const slot = this.pointers.up(event.pointerId);
      if (slot) this.mode?.onUp(slot);
    };
    field.addEventListener('pointerup', release);
    field.addEventListener('pointercancel', release);
  }

  _localPoint(event) {
    const rect = this.field.getBoundingClientRect();
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
    const unlock = this.audio.init();
    if (this._ready) {
      await Promise.race([
        this._ready,
        new Promise((resolve) => setTimeout(resolve, 280)),
      ]);
    }

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

    const track = this.customFile
      ? null
      : (catalog.find((item) => item.id === this.trackId) ?? catalog[0]);

    try {
      this.ui.showScreen('game');
      this.ui.prepareHud(this.modeId, this.difficulty);
      this.ui.setLoading(t('load.track'));
      await this._nextFrame();

      await unlock;
      if (this.customFile) await this.audio.loadFile(this.customFile);
      else if (track) await this.audio.loadUrl(track.url);
      else throw new Error(t('ops.noTracks'));
      if (!this.audio.buffer) throw new Error(t('error.start'));

      this.ui.setLoading(t('load.analyze'));
      await this._nextFrame();

      const buffer = this.audio.buffer;
      const cacheKey = `${this.modeId}:${this.difficulty}:${buffer.length}:${buffer.sampleRate}:${Math.round(buffer.duration * 1000)}`;
      let chart = this._analysisCache.get(cacheKey);
      if (!chart) {
        const analysis = analyzeAudio(buffer);
        chart = this.modeId === 'relax'
          ? buildRelaxChart(analysis)
          : buildDriveChart(analysis, this.difficulty);
        this._analysisCache.set(cacheKey, chart);
      }

      if (chart.notes.length === 0) {
        throw new Error(t('error.rhythm'));
      }

      this._resize();
      this.fx.reset();
      this.pointers.reset();

      this.mode = this.modeId === 'relax' ? this.relax : this.drive;
      this.mode.start(chart, this.difficulty);

      const approach = this.modeId === 'relax' ? RELAX.approach : DRIVE_DIFFICULTY[this.difficulty].approach;
      const leadIn = this.mode?.fruitMode ? 0.5 : Math.min(1.4, approach * 0.45);
      this.audio.startMusic(leadIn);

      this.ui.setLoading('');
      this.state = 'playing';
      this._rememberTrack();
      this._playStartedAt = Date.now();
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
    this.ui.hidePause();
    this.audio.stopMusic();
    this.audio.clearPause();
    this.mode?.stop();
    this.pointers.reset();
    this.state = 'menu';
  }

  pauseGame() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    cancelAnimationFrame(this._rafId);
    this._rafId = 0;
    this.audio.pausePlayback();
    this.pointers.reset();
    haptic('medium');
    this.ui.showPause(this.mode?.score ?? 0);
  }

  async resumeGame() {
    if (this.state !== 'paused') return;
    haptic('light');
    this.ui.hidePause();
    await this.audio.init();
    this.audio.resumePlayback();
    this.state = 'playing';
    this._lastTime = this.audio.time;
    this._loop();
  }

  saveScore() {
    if (this.state !== 'paused' && this.state !== 'playing') return;
    this.state = 'paused';
    cancelAnimationFrame(this._rafId);
    this._rafId = 0;
    this.ui.hidePause();
    if (this.mode) this.mode.finished = true;
    this._finish();
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
      ? (this.mode.diff?.canFail
        ? this.mode.shieldActive && (songTime < shield.time || this.mode.misses < shield.misses)
        : this.mode.feverActive)
      : this.mode.blissActive;
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
    this.ui.hidePause();
    this.audio.stopMusic();
    this.audio.clearPause();

    const stats = this.mode.stats();
    this.mode.stop();

    const mult = scoreMultiplier();
    if (mult > 1) {
      stats.score = Math.round(stats.score * mult);
      if (stats.metrics) stats.metrics.score = stats.score;
    }

    const track = this.customFile
      ? null
      : (TRACKS.find((item) => item.id === this.trackId) ?? activeTracks()[0]);
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
      durationSec: this._playStartedAt
        ? Math.max(0, Math.round((Date.now() - this._playStartedAt) / 1000))
        : 0,
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
try {
  window.game = new Game();
} catch (error) {
  console.error(error);
  const node = document.getElementById('menu-error') || document.body;
  node.textContent = error?.message || String(error);
}
