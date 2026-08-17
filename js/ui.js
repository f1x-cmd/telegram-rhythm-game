/**
 * Управление экранами, HUD и итоговой карточкой результата.
 * Скрытие текста оценки идёт по часам AudioContext, а не по таймерам.
 */

import { MODES, DRIVE_DIFFICULTY, TRACKS, rankFor } from './config.js';
import { shareResult, getUser } from './telegram.js';
import { LANGUAGES, t, formatNumber, languagePreference, applyStaticText, isRtl } from './i18n.js';

const $ = (selector) => document.querySelector(selector);

export class Ui {
  constructor(handlers) {
    this.handlers = handlers;

    this.el = {
      screens: {
        menu: $('#menu'),
        game: $('#game-screen'),
        result: $('#result-screen'),
      },
      modeList: $('#mode-list'),
      difficultyRow: $('#difficulty-row'),
      difficultyList: $('#difficulty-list'),
      trackList: $('#track-list'),
      fileInput: $('#custom-track'),
      customName: $('#custom-track-name'),
      dailyTitle: $('#daily-title'),
      dailyStatus: $('#daily-status'),
      dailyFill: $('#daily-fill'),
      offsetInput: $('#offset-input'),
      offsetValue: $('#offset-value'),
      langSelect: $('#lang-select'),
      playBtn: $('#play-btn'),
      menuError: $('#menu-error'),

      loading: $('#loading'),
      loadingText: $('#loading-text'),

      score: $('#score'),
      combo: $('#combo'),
      judgment: $('#judgment'),
      barLabel: $('#bar-label'),
      barFill: $('#bar-fill'),
      shield: $('#shield'),
      modeBadge: $('#mode-badge'),
      backBtn: $('#back-btn'),

      resultTitle: $('#result-title'),
      resultRank: $('#result-rank'),
      resultScore: $('#result-score'),
      resultRows: $('#result-rows'),
      recordBadge: $('#record-badge'),
      resultDaily: $('#result-daily'),
      shareImage: $('#share-image'),
      shareBtn: $('#share-btn'),
      downloadBtn: $('#download-btn'),
      retryBtn: $('#retry-btn'),
      menuBtn: $('#menu-btn'),
    };

    this._judgmentHideAt = 0;
    this._now = 0;
    this._lastScore = -1;
    this._lastCombo = -1;
    this._lastBar = -1;
    this._lastShield = null;
    this._shareUrl = null;

    this.hud = {
      showJudgment: (text, cls) => this.showJudgment(text, cls),
    };

    this._buildMenu();
    this._bindEvents();
  }

  // ── Меню ─────────────────────────────────────────────────────────────────

  _buildMenu() {
    const modeHtml = Object.values(MODES).map((mode) => `
      <button type="button" class="mode-card" data-mode="${mode.id}" style="--accent: ${mode.accent}">
        <span class="mode-title">${mode.title}</span>
        <span class="mode-subtitle">${t(`mode.${mode.id}.subtitle`)}</span>
      </button>
    `).join('');
    this.el.modeList.innerHTML = modeHtml;

    const diffHtml = Object.keys(DRIVE_DIFFICULTY).map((key) => `
      <button type="button" class="chip" data-difficulty="${key}">${t(`diff.${key}`)}</button>
    `).join('');
    this.el.difficultyList.innerHTML = diffHtml;

    const trackHtml = TRACKS.map((track) => `
      <button type="button" class="track-btn" data-track="${track.id}">
        <span class="track-info">
          <span class="track-title">${track.title}</span>
          <span class="track-record" data-record="${track.id}"></span>
        </span>
        <span class="track-mood">${t(`mood.${track.mood}`)}</span>
      </button>
    `).join('');
    this.el.trackList.innerHTML = trackHtml;

    const langHtml = [{ code: 'auto', name: t('lang.auto') }, ...LANGUAGES]
      .map((lang) => `<option value="${lang.code}">${lang.name}</option>`)
      .join('');
    this.el.langSelect.innerHTML = langHtml;
    this.el.langSelect.value = languagePreference();
  }

  /** Перерисовка после смены языка: статика + собранные из шаблонов списки. */
  retranslate() {
    applyStaticText();
    this._buildMenu();
  }

  _bindEvents() {
    this.el.modeList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-mode]');
      if (button) this.handlers.onModeChange(button.dataset.mode);
    });

    this.el.difficultyList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-difficulty]');
      if (button) this.handlers.onDifficultyChange(button.dataset.difficulty);
    });

    this.el.trackList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-track]');
      if (button) this.handlers.onTrackChange(button.dataset.track);
    });

    this.el.fileInput.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) this.handlers.onCustomFile(file);
    });

    this.el.offsetInput.addEventListener('input', () => {
      const value = Number(this.el.offsetInput.value);
      this.el.offsetValue.textContent = this._offsetLabel(value);
      this.handlers.onOffsetChange(value);
    });

    this.el.langSelect.addEventListener('change', () => {
      this.handlers.onLanguageChange(this.el.langSelect.value);
    });

    this.el.playBtn.addEventListener('click', () => this.handlers.onPlay());
    this.el.backBtn.addEventListener('click', () => this.handlers.onBack());
    this.el.retryBtn.addEventListener('click', () => this.handlers.onRetry());
    this.el.menuBtn.addEventListener('click', () => this.handlers.onMenu());

    this.el.shareBtn.addEventListener('click', () => {
      const text = this.el.shareBtn.dataset.text || 'Rhythm Game';
      if (!shareResult(text)) {
        navigator.clipboard?.writeText(text);
        this.el.shareBtn.textContent = t('result.copied');
      }
    });

    this.el.downloadBtn.addEventListener('click', () => {
      if (!this._shareUrl) return;
      const link = document.createElement('a');
      link.href = this._shareUrl;
      link.download = 'rhythm-game-score.jpg';
      link.click();
    });
  }

  syncMenu(state) {
    for (const button of this.el.modeList.querySelectorAll('[data-mode]')) {
      button.classList.toggle('selected', button.dataset.mode === state.mode);
    }
    for (const button of this.el.difficultyList.querySelectorAll('[data-difficulty]')) {
      button.classList.toggle('selected', button.dataset.difficulty === state.difficulty);
    }
    for (const button of this.el.trackList.querySelectorAll('[data-track]')) {
      button.classList.toggle('selected', !state.customFile && button.dataset.track === state.trackId);
    }

    for (const label of this.el.trackList.querySelectorAll('[data-record]')) {
      const best = state.records?.[label.dataset.record] ?? 0;
      label.textContent = best > 0
        ? t('track.record', { score: formatNumber(best) })
        : t('track.noRecord');
    }

    if (state.daily) {
      this.el.dailyTitle.textContent = state.daily.title;
      this.el.dailyStatus.textContent = state.daily.done
        ? t('daily.done')
        : `${formatNumber(state.daily.progress)} / ${formatNumber(state.daily.target)}`;
      this.el.dailyStatus.classList.toggle('done', state.daily.done);
      this.el.dailyFill.style.width = `${Math.round(state.daily.ratio * 100)}%`;
    }

    this.el.difficultyRow.classList.toggle('hidden', state.mode !== 'drive');
    this.el.customName.textContent = state.customFile ? state.customFile.name : '';
    this.el.offsetInput.value = String(state.offsetMs);
    this.el.offsetValue.textContent = this._offsetLabel(state.offsetMs);
    this.el.langSelect.value = languagePreference();

    const mode = MODES[state.mode];
    this.el.playBtn.textContent = t('menu.play', { mode: mode.title });
    this.el.playBtn.style.setProperty('--accent', mode.accent);
    document.body.dataset.mode = state.mode;
  }

  _offsetLabel(ms) {
    return `${ms > 0 ? '+' : ''}${ms} ${t('unit.ms')}`;
  }

  showError(message) {
    this.el.menuError.textContent = message || '';
  }

  // ── Экраны ───────────────────────────────────────────────────────────────

  showScreen(name) {
    for (const [key, element] of Object.entries(this.el.screens)) {
      element.classList.toggle('active', key === name);
    }
  }

  setLoading(text) {
    if (!text) {
      this.el.loading.classList.add('hidden');
      return;
    }
    this.el.loadingText.textContent = text;
    this.el.loading.classList.remove('hidden');
  }

  // ── HUD ──────────────────────────────────────────────────────────────────

  prepareHud(modeId) {
    const mode = MODES[modeId];
    this.el.barLabel.textContent = mode.barLabel;
    this.el.modeBadge.textContent = mode.title;
    this.el.modeBadge.style.color = mode.accent;
    this.el.shield.textContent = modeId === 'drive' ? t('hud.shield') : t('hud.flow');
    this.el.judgment.textContent = '';
    this.el.judgment.className = 'judgment';
    this._judgmentHideAt = 0;
    this._lastScore = -1;
    this._lastCombo = -1;
    this._lastBar = -1;
    this._lastShield = null;
  }

  /** Синхронизация с часами AudioContext в начале кадра. */
  setNow(now) {
    this._now = now;
  }

  showJudgment(text, cls) {
    this.el.judgment.textContent = text;
    this.el.judgment.className = `judgment ${cls}`;
    this._judgmentHideAt = this._now + 0.55;
  }

  /** Вызывается из игрового цикла: обновляет HUD по данным режима. */
  tick(now, mode, shieldActive) {
    if (mode.score !== this._lastScore) {
      this._lastScore = mode.score;
      this.el.score.textContent = formatNumber(mode.score);
    }
    if (mode.combo !== this._lastCombo) {
      this._lastCombo = mode.combo;
      this.el.combo.textContent = mode.combo > 0 ? `x${mode.combo}` : '';
    }

    const bar = Math.round(mode.barValue);
    if (bar !== this._lastBar) {
      this._lastBar = bar;
      this.el.barFill.style.width = `${bar}%`;
      const isHealthBar = typeof mode.hp === 'number';
      this.el.barFill.classList.toggle('danger', isHealthBar && bar <= 25);
    }

    const shield = Boolean(shieldActive);
    if (shield !== this._lastShield) {
      this._lastShield = shield;
      this.el.shield.classList.toggle('hidden', !shield);
    }

    if (this._judgmentHideAt > 0 && now > this._judgmentHideAt) {
      this.el.judgment.textContent = '';
      this.el.judgment.className = 'judgment';
      this._judgmentHideAt = 0;
    }
  }

  // ── Результат ────────────────────────────────────────────────────────────

  showResult(stats, meta) {
    const rank = rankFor(stats.accuracy);

    this.el.resultTitle.textContent = stats.failed
      ? t('result.failed')
      : t(stats.mode === 'relax' ? 'result.relaxDone' : 'result.driveDone');
    this.el.resultRank.textContent = rank.label;
    this.el.resultRank.style.color = rank.color;
    this.el.resultScore.textContent = formatNumber(stats.score);

    this.el.resultRows.innerHTML = stats.rows
      .map(([label, value]) => `<li><span>${label}</span><b>${value}</b></li>`)
      .join('');

    const record = meta.record;
    this.el.recordBadge.classList.toggle('hidden', !record?.isRecord);
    if (record?.isRecord) {
      this.el.recordBadge.textContent = record.previous > 0
        ? t('result.newRecord', { score: formatNumber(record.previous) })
        : t('result.firstRecord');
    }

    const daily = meta.daily;
    if (daily) {
      this.el.resultDaily.textContent = daily.justCompleted
        ? t('daily.completed', { title: daily.title })
        : daily.done
          ? t('daily.alreadyDone')
          : t('daily.progress', {
            progress: formatNumber(daily.progress),
            target: formatNumber(daily.target),
          });
      this.el.resultDaily.classList.toggle('done', daily.done);
    }

    const text = t('share.text', {
      mode: meta.modeTitle,
      track: meta.trackTitle,
      score: formatNumber(stats.score),
      rank: rank.label,
    });
    this.el.shareBtn.dataset.text = text;
    this.el.shareBtn.textContent = t('result.share');

    this._shareUrl = this._buildShareCard(stats, meta, rank);
    this.el.shareImage.src = this._shareUrl;

    this.showScreen('result');
  }

  /** Карточка 9:16 для Telegram Stories. */
  _buildShareCard(stats, meta, rank) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext('2d');

    const accent = meta.accent;
    const gradient = ctx.createLinearGradient(0, 0, 540, 1920);
    gradient.addColorStop(0, '#12101f');
    gradient.addColorStop(0.6, '#0a0912');
    gradient.addColorStop(1, '#05050a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1080, 1920);

    const glow = ctx.createRadialGradient(540, 760, 40, 540, 760, 760);
    glow.addColorStop(0, `${accent}55`);
    glow.addColorStop(1, `${accent}00`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 1080, 1920);

    ctx.textAlign = 'center';

    ctx.fillStyle = accent;
    ctx.font = '700 64px -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(meta.modeTitle, 540, 320);

    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.font = '400 44px -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(meta.trackTitle, 540, 400);

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 200px -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(formatNumber(stats.score), 540, 780);

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '500 40px -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(t('result.points').toLocaleUpperCase(), 540, 850);

    // Ранг в круге
    ctx.strokeStyle = rank.color;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(540, 1090, 150, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = rank.color;
    ctx.font = '800 180px -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(rank.label, 540, 1155);

    // В RTL-языках подпись уходит к правому краю, значение — к левому
    const rtl = isRtl();
    const labelX = rtl ? 860 : 220;
    const valueX = rtl ? 220 : 860;
    const rows = stats.rows.slice(-3);
    ctx.font = '500 44px -apple-system, Segoe UI, Roboto, sans-serif';
    rows.forEach((row, index) => {
      const y = 1400 + index * 90;
      ctx.textAlign = rtl ? 'right' : 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(row[0], labelX, y);
      ctx.textAlign = rtl ? 'left' : 'right';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(row[1], valueX, y);
    });

    ctx.textAlign = 'center';
    const user = getUser();
    if (user.name && user.name !== 'Player') {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = '600 46px -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.fillText(user.name, 540, 220);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '500 38px -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText('RHYTHM GAME · Telegram Mini App', 540, 1760);

    // JPEG вместо PNG: карточка 1080×1920 в base64 иначе занимает мегабайты
    return canvas.toDataURL('image/jpeg', 0.92);
  }
}
