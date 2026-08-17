/**
 * Аудио-движок. AudioContext.currentTime — единственный источник времени.
 * Здесь же программный синтез звуков попадания (нулевая задержка).
 */

import { t } from './i18n.js';

const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.reverb = null;
    this.reverbGain = null;
    this.analyser = null;
    this.spectrum = null;

    this.buffer = null;
    this.source = null;
    this.musicStartTime = 0;
    this.offset = 0;        // калибровка задержки, секунды
    this.bands = { bass: 0, mid: 0, high: 0 };

    this._cache = new Map();
    this._inflight = new Map();
    this._noiseBuffer = null;
    this._chimeStep = 0;
  }

  async init() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctor({ latencyHint: 'interactive' });

      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.75;
      this.spectrum = new Uint8Array(this.analyser.frequencyBinCount);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.85;
      this.musicGain.connect(this.analyser);
      this.analyser.connect(this.master);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.7;
      this.sfxGain.connect(this.master);

      this.reverb = this.ctx.createConvolver();
      this.reverb.buffer = this._createImpulse(2.2);
      this.reverbGain = this.ctx.createGain();
      this.reverbGain.gain.value = 0.0;
      this.reverb.connect(this.reverbGain);
      this.reverbGain.connect(this.master);

      this._noiseBuffer = this._createNoise(0.4);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx;
  }

  /** Реверб для режима RELAX (0 — выкл). */
  setAmbience(amount) {
    if (this.reverbGain) this.reverbGain.gain.value = amount;
  }

  get time() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  get duration() {
    return this.buffer ? this.buffer.duration : 0;
  }

  /** Позиция воспроизведения трека с учётом калибровки. */
  songTime() {
    if (!this.musicStartTime) return 0;
    return this.time - this.musicStartTime - this.offset;
  }

  /** Абсолютное время ноты в часах AudioContext. */
  toAudioTime(songTime) {
    return this.musicStartTime + songTime + this.offset;
  }

  /** Предзагрузка MP3 в кэш, чтобы первая партия уложилась в TTFT < 3.5 с. */
  prefetch(url) {
    if (!url || this._cache.has(url) || this._inflight.has(url)) return;
    if (typeof window !== 'undefined' && window.location.protocol === 'file:') return;
    const job = fetch(encodeURI(url))
      .then((response) => {
        if (!response.ok) throw new Error('prefetch');
        return response.arrayBuffer();
      })
      .then((raw) => {
        this._cache.set(url, raw);
        this._inflight.delete(url);
      })
      .catch(() => {
        this._inflight.delete(url);
      });
    this._inflight.set(url, job);
  }

  async loadUrl(url) {
    await this.init();
    if (window.location.protocol === 'file:') {
      throw new Error(t('error.server'));
    }
    if (this._inflight.has(url)) {
      try { await this._inflight.get(url); } catch (_) { /* грузим заново ниже */ }
    }
    let raw = this._cache.get(url);
    if (!raw) {
      const response = await fetch(encodeURI(url));
      if (!response.ok) throw new Error(t('error.file', { url, status: response.status }));
      raw = await response.arrayBuffer();
      this._cache.set(url, raw);
    }
    this.buffer = await this.ctx.decodeAudioData(raw.slice(0));
    return this.buffer;
  }

  async loadFile(file) {
    await this.init();
    const raw = await file.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(raw);
    return this.buffer;
  }

  /** Запуск трека с задержкой leadIn, чтобы первые ноты успели пролететь. */
  startMusic(leadIn = 2.5) {
    if (!this.ctx || !this.buffer) return;
    this.stopMusic();
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.musicGain);
    this.musicStartTime = this.time + leadIn;
    this.source.start(this.musicStartTime);
  }

  stopMusic() {
    if (this.source) {
      try { this.source.stop(); } catch (_) { /* уже остановлен */ }
      this.source.disconnect();
      this.source = null;
    }
  }

  pause() {
    if (this.ctx?.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  /** Обновление полос спектра для визуала. */
  sampleSpectrum() {
    if (!this.analyser || !this.spectrum) return this.bands;
    this.analyser.getByteFrequencyData(this.spectrum);
    const n = this.spectrum.length;
    const bassEnd = Math.max(2, Math.floor(n * 0.08));
    const midEnd = Math.floor(n * 0.35);

    let bass = 0;
    for (let i = 1; i < bassEnd; i++) bass += this.spectrum[i];
    let mid = 0;
    for (let i = bassEnd; i < midEnd; i++) mid += this.spectrum[i];
    let high = 0;
    for (let i = midEnd; i < n; i++) high += this.spectrum[i];

    this.bands.bass = bass / ((bassEnd - 1) * 255);
    this.bands.mid = mid / ((midEnd - bassEnd) * 255);
    this.bands.high = high / ((n - midEnd) * 255);
    return this.bands;
  }

  // ── Синтез звуков ────────────────────────────────────────────────────────

  /** Сухой щелчок: синус 800 Гц, затухание 15 мс (спецификация 2.2). */
  click(volume = 0.3) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, t);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.015);
    osc.connect(gain).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.03);
  }

  /** Панч для DRIVE: кик + шумовой транзиент. */
  punch(intensity = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    const kick = this.ctx.createOscillator();
    const kickGain = this.ctx.createGain();
    kick.type = 'sine';
    kick.frequency.setValueAtTime(180, t);
    kick.frequency.exponentialRampToValueAtTime(52, t + 0.12);
    kickGain.gain.setValueAtTime(0.5 * intensity, t);
    kickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    kick.connect(kickGain).connect(this.sfxGain);
    kick.start(t);
    kick.stop(t + 0.18);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2400;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.22 * intensity, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    noise.connect(hp).connect(noiseGain).connect(this.sfxGain);
    noise.start(t);
    noise.stop(t + 0.08);
  }

  /** Мягкий колокольчик для RELAX, поднимается по пентатонике. */
  chime(step = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (step === null) {
      step = this._chimeStep;
      this._chimeStep = (this._chimeStep + 1) % PENTATONIC.length;
    }
    const semis = PENTATONIC[step % PENTATONIC.length];
    const freq = 523.25 * Math.pow(2, semis / 12);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.28, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    gain.connect(this.sfxGain);
    if (this.reverb) gain.connect(this.reverb);

    const main = this.ctx.createOscillator();
    main.type = 'sine';
    main.frequency.value = freq;
    main.connect(gain);
    main.start(t);
    main.stop(t + 1.0);

    const shimmer = this.ctx.createOscillator();
    const shimmerGain = this.ctx.createGain();
    shimmer.type = 'sine';
    shimmer.frequency.value = freq * 2;
    shimmerGain.gain.value = 0.3;
    shimmer.connect(shimmerGain).connect(gain);
    shimmer.start(t);
    shimmer.stop(t + 0.7);
  }

  /** Сброс мелодической позиции колокольчика (при обрыве комбо). */
  resetChime() {
    this._chimeStep = 0;
  }

  /** Короткий тик удержания. */
  tick() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 1200;
    gain.gain.setValueAtTime(0.06, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    osc.connect(gain).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  /** Промах: низкий приглушённый импульс. */
  miss() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.18);
    gain.gain.setValueAtTime(0.16, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(lp).connect(gain).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.22);
  }

  /** Касание красной ноты: резкий предупреждающий звук. */
  alarm() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.setValueAtTime(200, t + 0.07);
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(gain).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.24);
  }

  // ── Вспомогательные буферы ───────────────────────────────────────────────

  _createNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _createImpulse(seconds) {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const decay = Math.pow(1 - i / len, 2.6);
        data[i] = (Math.random() * 2 - 1) * decay;
      }
    }
    return buf;
  }
}
