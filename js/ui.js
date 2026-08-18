/**
 * Управление экранами, HUD и итоговой карточкой результата.
 * Скрытие текста оценки идёт по часам AudioContext, а не по таймерам.
 */

import { MODES, DRIVE_DIFFICULTY, rankFor } from './config.js';
import { shareResult, getUser, openDonate, peekLocal, storage, showBackButton, isTelegram, haptic } from './telegram.js';
import { LANGUAGES, t, formatNumber, languagePreference, applyStaticText, isRtl } from './i18n.js';
import { donateRuntime, liveops, activeTracks, tracksForMode, isBanned, activeEvent } from './liveops.js';
import { me } from './social.js';
import { buildInvite } from './social.js';

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => (
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
));

export class Ui {
  constructor(handlers) {
    this.handlers = handlers;

    this.el = {
      screens: {
        menu: $('#menu'),
        game: $('#game-screen'),
        result: $('#result-screen'),
        profile: $('#profile-screen'),
      },
      profileChip: $('#profile-chip'),
      chipAvatar: $('#chip-avatar'),
      chipName: $('#chip-name'),
      chipMeta: $('#chip-meta'),
      chipRank: $('#chip-rank'),
      modeList: $('#mode-list'),
      difficultyRow: $('#difficulty-row'),
      difficultyList: $('#difficulty-list'),
      diffHint: $('#diff-hint'),
      trackCard: $('#track-card'),
      trackCardTitle: $('#track-card-title'),
      trackCardMeta: $('#track-card-meta'),
      library: $('#library'),
      libraryList: $('#library-list'),
      libraryEmpty: $('#library-empty'),
      librarySearch: $('#library-search'),
      libraryTabs: $('#library-tabs'),
      libraryClose: $('#library-close'),
      fileInput: $('#custom-track'),
      customHint: $('#custom-track-hint'),
      dailyTitle: $('#daily-title'),
      dailyStatus: $('#daily-status'),
      dailyFill: $('#daily-fill'),
      offsetInput: $('#offset-input'),
      offsetValue: $('#offset-value'),
      langSelect: $('#lang-select'),
      opsBanner: $('#ops-banner'),
      playBtn: $('#play-btn'),
      playMeta: $('#play-meta'),
      playHint: $('#play-hint'),
      menuError: $('#menu-error'),
      coach: $('#coach'),

      loading: $('#loading'),
      loadingText: $('#loading-text'),

      score: $('#score'),
      combo: $('#combo'),
      judgment: $('#judgment'),
      barLabel: $('#bar-label'),
      barFill: $('#bar-fill'),
      shield: $('#shield'),
      modeBadge: $('#mode-badge'),
      pauseBtn: $('#pause-btn'),
      pauseOverlay: $('#pause-overlay'),
      pauseScore: $('#pause-score'),
      resumeBtn: $('#resume-btn'),
      saveScoreBtn: $('#save-score-btn'),
      pauseMenuBtn: $('#pause-menu-btn'),

      resultTitle: $('#result-title'),
      resultRank: $('#result-rank'),
      resultScore: $('#result-score'),
      resultRows: $('#result-rows'),
      recordBadge: $('#record-badge'),
      resultDaily: $('#result-daily'),
      shareImage: $('#share-image'),
      shareBtn: $('#share-btn'),
      challengeResultBtn: $('#challenge-result-btn'),
      downloadBtn: $('#download-btn'),
      retryBtn: $('#retry-btn'),
      menuBtn: $('#menu-btn'),

      profileAvatar: $('#profile-avatar'),
      profileName: $('#profile-name'),
      profileHandle: $('#profile-handle'),
      profileTitle: $('#profile-title'),
      profileStreak: $('#profile-streak'),
      heroPoints: $('#hero-points'),
      rankGlobal: $('#rank-global'),
      rankFriends: $('#rank-friends'),
      rankClan: $('#rank-clan'),
      statRating: $('#stat-rating'),
      statPlays: $('#stat-plays'),
      statBest: $('#stat-best'),
      statCombo: $('#stat-combo'),
      boardHint: $('#board-hint'),
      boardList: $('#board-list'),
      boardEmpty: $('#board-empty'),
      clanForm: $('#clan-form'),
      clanActions: $('#clan-actions'),
      clanBanner: $('#clan-banner'),
      clanName: $('#clan-name'),
      clanCode: $('#clan-code'),
      createClanBtn: $('#create-clan-btn'),
      joinClanBtn: $('#join-clan-btn'),
      shareClanBtn: $('#share-clan-btn'),
      leaveClanBtn: $('#leave-clan-btn'),
      inviteBtn: $('#invite-btn'),
      challengeBtn: $('#challenge-btn'),
      donatePacks: $('#donate-packs'),
      appNav: $('#app-nav'),
      toast: $('#toast'),
    };

    this._judgmentHideAt = 0;
    this._now = 0;
    this._lastScore = -1;
    this._lastCombo = -1;
    this._lastBar = -1;
    this._lastShield = null;
    this._shareUrl = null;
    this._board = 'global';
    this._toastHideAt = 0;
    this._lastResultScore = 0;
    this._libraryTab = 'mode';
    this._libraryQuery = '';
    this._menuState = null;

    this.hud = {
      showJudgment: (text, cls) => this.showJudgment(text, cls),
    };

    if (isTelegram) document.body.classList.add('in-telegram');
    this.el.downloadBtn?.classList.toggle('hidden', isTelegram);

    this._buildMenu();
    this._fillProfileStatics();
    this._bindEvents();
  }

  // ── Меню ─────────────────────────────────────────────────────────────────

  _buildMenu() {
    const modeHtml = Object.values(MODES).map((mode) => `
      <button type="button" class="mode-card" data-mode="${mode.id}" style="--accent: ${mode.accent}">
        <span class="mode-glyph" aria-hidden="true"></span>
        <span class="mode-title">${mode.title}</span>
        <span class="mode-subtitle">${t(`mode.${mode.id}.subtitle`)}</span>
      </button>
    `).join('');
    this.el.modeList.innerHTML = modeHtml;

    const diffHtml = Object.keys(DRIVE_DIFFICULTY).map((key) => `
      <button type="button" class="chip" data-difficulty="${key}">
        <span class="diff-dot" aria-hidden="true"></span>${t(`diff.${key}`)}
      </button>
    `).join('');
    this.el.difficultyList.innerHTML = diffHtml;

    this._paintLibraryTabs();

    const langHtml = [{ code: 'auto', name: t('lang.auto') }, ...LANGUAGES]
      .map((lang) => `<option value="${lang.code}">${lang.name}</option>`)
      .join('');
    this.el.langSelect.innerHTML = langHtml;
    this.el.langSelect.value = languagePreference();
  }

  _paintLibraryTabs() {
    if (!this.el.libraryTabs) return;
    const labels = {
      mode: MODES[this._menuState?.mode]?.title || t('library.tabMode'),
      mine: t('library.tabMine'),
      all: t('library.tabAll'),
    };
    for (const button of this.el.libraryTabs.querySelectorAll('[data-lib-tab]')) {
      button.textContent = labels[button.dataset.libTab] || '';
      button.classList.toggle('selected', button.dataset.libTab === this._libraryTab);
    }
    if (this.el.librarySearch) this.el.librarySearch.placeholder = t('library.search');
  }

  isLibraryOpen() {
    return Boolean(this.el.library && !this.el.library.classList.contains('hidden'));
  }

  openLibrary() {
    if (!this.el.library) return;
    const state = this._menuState || {};
    this._libraryQuery = '';
    if (this.el.librarySearch) this.el.librarySearch.value = '';
    this._libraryTab = state.customFile ? 'mine' : 'mode';
    this._paintLibraryTabs();
    this._fillLibrary();
    this.el.library.classList.remove('hidden');
    document.body.dataset.library = 'open';
    this.el.trackCard?.setAttribute('aria-expanded', 'true');
    haptic('selection');
    this._syncBackButton();
  }

  closeLibrary() {
    this.el.library?.classList.add('hidden');
    delete document.body.dataset.library;
    this.el.trackCard?.setAttribute('aria-expanded', 'false');
    this._syncBackButton();
  }

  _syncBackButton() {
    const screen = document.body.dataset.screen;
    showBackButton(
      this.isLibraryOpen()
      || screen === 'game'
      || screen === 'result'
      || screen === 'profile'
    );
  }

  _fillLibrary() {
    if (!this.el.libraryList) return;
    const state = this._menuState || {};
    const query = this._libraryQuery.trim().toLowerCase();
    const catalog = activeTracks();
    const modeId = state.mode || 'relax';

    let rows = [];
    if (this._libraryTab === 'mine') {
      if (state.customFile) {
        rows = [{
          id: 'custom',
          title: state.customFile.name.replace(/\.[^.]+$/, ''),
          mood: 'both',
          custom: true,
        }];
      }
    } else if (this._libraryTab === 'mode') {
      rows = tracksForMode(modeId);
    } else {
      rows = catalog;
    }

    if (query) {
      rows = rows.filter((track) => track.title.toLowerCase().includes(query));
    }

    this.el.libraryList.innerHTML = rows.map((track) => {
      const selected = track.custom
        ? Boolean(state.customFile)
        : !state.customFile && track.id === state.trackId;
      const best = track.custom ? 0 : (state.records?.[track.id] ?? 0);
      const record = track.custom
        ? t('library.custom')
        : best > 0
          ? t('track.record', { score: formatNumber(best) })
          : t('track.noRecord');
      return `
        <button type="button" class="track-btn${selected ? ' selected' : ''}" data-track="${esc(track.id)}">
          <span class="track-info">
            <span class="track-title">${esc(track.title)}</span>
            <span class="track-record">${esc(record)}</span>
          </span>
          <span class="track-mood">${esc(t(`mood.${track.mood}`))}</span>
        </button>`;
    }).join('');

    const empty = !rows.length
      ? (this._libraryTab === 'mine' && !query ? t('library.emptyMine') : t('library.empty'))
      : '';
    if (this.el.libraryEmpty) {
      this.el.libraryEmpty.textContent = empty;
      this.el.libraryEmpty.classList.toggle('hidden', !empty);
    }
    if (this.el.librarySearch) {
      this.el.librarySearch.classList.toggle('hidden', catalog.length < 8 && !query);
    }
  }

  /** Перерисовка после смены языка: статика + собранные из шаблонов списки. */
  retranslate() {
    applyStaticText();
    this._buildMenu();
    this._fillProfileStatics();
    if (this._menuState) this.syncMenu(this._menuState);
  }

  _fillProfileStatics() {
    if (this.el.clanName) this.el.clanName.placeholder = t('profile.clanName');
    if (this.el.clanCode) this.el.clanCode.placeholder = t('profile.clanCode');
    this.el.donatePacks.innerHTML = donateRuntime().packs.map((stars) => `
      <button type="button" class="donate-pack" data-stars="${stars}">${t('profile.stars', { n: stars })}</button>
    `).join('');
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

    this.el.trackCard.addEventListener('click', () => this.openLibrary());
    this.el.libraryClose.addEventListener('click', () => this.closeLibrary());
    this.el.library.addEventListener('click', (event) => {
      if (event.target === this.el.library) this.closeLibrary();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (this.isLibraryOpen()) {
        event.preventDefault();
        this.closeLibrary();
      }
    });
    this.el.libraryTabs.addEventListener('click', (event) => {
      const button = event.target.closest('[data-lib-tab]');
      if (!button) return;
      haptic('selection');
      this._libraryTab = button.dataset.libTab;
      this._paintLibraryTabs();
      this._fillLibrary();
    });
    this.el.librarySearch.addEventListener('input', () => {
      this._libraryQuery = this.el.librarySearch.value;
      this._fillLibrary();
    });
    this.el.libraryList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-track]');
      if (!button) return;
      haptic('selection');
      if (button.dataset.track === 'custom') {
        this.closeLibrary();
        return;
      }
      this.handlers.onTrackChange(button.dataset.track);
      this.closeLibrary();
    });

    this.el.fileInput.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      this._libraryTab = 'mine';
      this.handlers.onCustomFile(file);
      this.closeLibrary();
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
    this.el.pauseBtn.addEventListener('click', () => this.handlers.onPause());
    this.el.resumeBtn.addEventListener('click', () => this.handlers.onResume());
    this.el.saveScoreBtn.addEventListener('click', () => this.handlers.onSaveScore());
    this.el.pauseMenuBtn?.addEventListener('click', () => this.handlers.onBack());
    this.el.pauseOverlay?.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      this.handlers.onResume();
    });
    this.el.retryBtn.addEventListener('click', () => this.handlers.onRetry());
    this.el.menuBtn.addEventListener('click', () => this.handlers.onMenu());
    this.el.profileChip.addEventListener('click', () => this.handlers.onOpenProfile());

    this.el.appNav.addEventListener('click', (event) => {
      const button = event.target.closest('[data-nav]');
      if (!button) return;
      if (button.dataset.nav === 'profile') this.handlers.onOpenProfile();
      else this.handlers.onMenu();
    });

    this.el.profileScreen = this.el.screens.profile;
    this.el.screens.profile.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-board]');
      if (tab) this.handlers.onBoardChange(tab.dataset.board);
    });

    this.el.inviteBtn?.addEventListener('click', () => this.handlers.onInvite('friend'));
    this.el.challengeBtn.addEventListener('click', () => this.handlers.onInvite('challenge'));
    this.el.shareClanBtn.addEventListener('click', () => this.handlers.onInvite('clan'));
    this.el.createClanBtn.addEventListener('click', () => this.handlers.onCreateClan(this.el.clanName.value));
    this.el.joinClanBtn.addEventListener('click', () => this.handlers.onJoinClan(this.el.clanCode.value));
    this.el.leaveClanBtn.addEventListener('click', () => this.handlers.onLeaveClan());
    this.el.donatePacks.addEventListener('click', (event) => {
      const button = event.target.closest('[data-stars]');
      if (!button) return;
      const stars = Number(button.dataset.stars);
      const result = openDonate(stars, donateRuntime());
      this.showToast(t(result === 'copy' ? 'profile.donateThanks' : 'profile.donateThanks'));
      this.handlers.onDonate?.(stars, result);
    });

    this.el.shareBtn.addEventListener('click', () => {
      const text = this.el.shareBtn.dataset.text || 'Rhythm Game';
      const url = this.el.shareBtn.dataset.url || '';
      if (!shareResult(text, url || undefined)) {
        navigator.clipboard?.writeText(url ? `${text}\n${url}` : text);
        this.el.shareBtn.textContent = t('result.copied');
      }
    });

    this.el.challengeResultBtn?.addEventListener('click', () => {
      this.handlers.onChallengeResult?.(this._lastResultScore);
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
    this._menuState = state;
    this._fillProfileStatics();
    this._paintLibraryTabs();
    if (this.isLibraryOpen()) this._fillLibrary();

    for (const button of this.el.modeList.querySelectorAll('[data-mode]')) {
      button.classList.toggle('selected', button.dataset.mode === state.mode);
    }
    for (const button of this.el.difficultyList.querySelectorAll('[data-difficulty]')) {
      button.classList.toggle('selected', button.dataset.difficulty === state.difficulty);
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
    if (this.el.diffHint) {
      this.el.diffHint.textContent = state.mode === 'drive' ? t(`diff.${state.difficulty}.hint`) : '';
    }
    this.el.offsetInput.value = String(state.offsetMs);
    this.el.offsetValue.textContent = this._offsetLabel(state.offsetMs);
    this.el.langSelect.value = languagePreference();

    const mode = MODES[state.mode];
    this.el.playBtn.style.setProperty('--accent', mode.accent);
    document.body.dataset.mode = state.mode;

    const catalog = activeTracks();
    const current = catalog.find((item) => item.id === state.trackId) ?? catalog[0];
    const trackTitle = state.customFile
      ? state.customFile.name.replace(/\.[^.]+$/, '')
      : current?.title ?? '—';
    this.el.playBtn.textContent = t('menu.play', { mode: trackTitle });
    const best = state.customFile ? 0 : (state.records?.[state.trackId] ?? 0);
    if (this.el.trackCardTitle) this.el.trackCardTitle.textContent = trackTitle;
    if (this.el.trackCardMeta) {
      this.el.trackCardMeta.textContent = state.customFile
        ? t('library.custom')
        : [
          current ? t(`mood.${current.mood}`) : '',
          best > 0 ? t('track.record', { score: formatNumber(best) }) : t('track.noRecord'),
        ].filter(Boolean).join(' · ');
    }
    this.el.trackCard?.classList.toggle('custom', Boolean(state.customFile));

    const event = activeEvent();
    if (this.el.playMeta) {
      const text = event
        ? (event.name
          ? t('ops.eventNamed', { name: event.name, mult: event.mult })
          : t('ops.eventMult', { mult: event.mult }))
        : '';
      this.el.playMeta.textContent = text;
      this.el.playMeta.classList.toggle('hidden', !text);
    }

    if (state.profile) this._paintChip(state.profile);

    const ops = liveops();
    const banner = ops.maintenance
      ? (ops.maintenanceText || t('ops.maintenance'))
      : (ops.banner || (event && !ops.banner
        ? (event.name
          ? t('ops.eventNamed', { name: event.name, mult: event.mult })
          : t('ops.eventMult', { mult: event.mult }))
        : ''));
    this.el.opsBanner.textContent = banner;
    this.el.opsBanner.classList.toggle('hidden', !banner);
    this.el.opsBanner.classList.toggle('alert', Boolean(ops.maintenance));
    this.el.opsBanner.classList.toggle('event', Boolean(event && !ops.maintenance));
    const noCatalog = catalog.length === 0 && !state.customFile;
    const locked = Boolean(ops.maintenance) || isBanned(me().id) || noCatalog;
    this.el.playBtn.disabled = locked;
    if (this.el.playHint) {
      const hint = locked
        ? (ops.maintenance
          ? (ops.maintenanceText || t('ops.maintenance'))
          : isBanned(me().id)
            ? t('ops.banned')
            : t('ops.noTracks'))
        : '';
      this.el.playHint.textContent = hint;
      this.el.playHint.classList.toggle('hidden', !hint);
    }

    const upload = document.querySelector('.upload-btn');
    if (upload) upload.classList.toggle('hidden', ops.allowUpload === false);
    if (this.el.fileInput) this.el.fileInput.disabled = ops.allowUpload === false;
    if (this.el.customHint) {
      this.el.customHint.classList.toggle('hidden', !state.customFile);
    }
    const donateBar = document.querySelector('.donate-bar');
    if (donateBar) donateBar.classList.toggle('hidden', ops.allowDonate === false);
    const inviteBtn = this.el.inviteBtn;
    if (inviteBtn) inviteBtn.disabled = false;
  }

  _offsetLabel(ms) {
    return `${ms > 0 ? '+' : ''}${ms} ${t('unit.ms')}`;
  }

  _setAvatar(element, name, photo) {
    const initial = (name || 'P').trim().charAt(0).toUpperCase();
    element.textContent = photo ? '' : initial;
    element.style.backgroundImage = photo ? `url("${photo}")` : '';
  }

  _paintChip(profile) {
    const { player, stats, league } = profile;
    this._setAvatar(this.el.chipAvatar, player.name, player.photo);
    this.el.chipName.textContent = player.name;
    this.el.chipMeta.textContent = `${formatNumber(stats.totalScore)} · ${t(`league.${league.id}`)}`;
    this.el.chipRank.textContent = t(`title.${profile.title.id}`);
    this.el.chipRank.style.color = league.color;
  }

  showToast(message) {
    if (!message) return;
    this.el.toast.textContent = message;
    this.el.toast.classList.remove('hidden');
    window.clearTimeout(this._toastHideAt);
    this._toastHideAt = window.setTimeout(() => this.el.toast.classList.add('hidden'), 2400);
  }

  syncProfile(profile, board = this._board) {
    this._board = board;
    this._paintChip(profile);

    const { player, stats, league, title } = profile;
    this._setAvatar(this.el.profileAvatar, player.name, player.photo);
    this.el.profileName.textContent = player.name;
    this.el.profileHandle.textContent = player.username || t('profile.you');
    this.el.profileTitle.textContent = `${t(`title.${title.id}`)} · ${t(`league.${league.id}`)}`;
    this.el.profileTitle.style.color = league.color;
    this.el.profileStreak.textContent = String(stats.streak || 0);
    this.el.heroPoints.textContent = formatNumber(stats.totalScore);

    this.el.rankGlobal.textContent = profile.global.size > 1
      ? `#${profile.global.place}`
      : t(`league.${league.id}`);
    this.el.rankFriends.textContent = profile.friends.size > 1
      ? `#${profile.friends.place}`
      : '—';
    this.el.rankClan.textContent = profile.clan
      ? `#${profile.clan.place}`
      : '—';

    this.el.statRating.textContent = formatNumber(profile.rating);
    this.el.statPlays.textContent = formatNumber(stats.plays);
    this.el.statBest.textContent = formatNumber(stats.bestScore);
    this.el.statCombo.textContent = formatNumber(stats.maxCombo);

    for (const card of document.querySelectorAll('.rank-card, .board-tab')) {
      card.classList.toggle('selected', card.dataset.board === board);
    }

    const pack = board === 'friends' ? profile.friends : board === 'clan' ? profile.clan : profile.global;
    const rows = pack?.rows ?? [];
    const empty = board === 'friends'
      ? t('profile.emptyFriends')
      : board === 'clan'
        ? t('profile.emptyClan')
        : t('profile.emptyGlobal');

    this.el.boardHint.textContent = t('profile.networkHint');
    this.el.boardList.innerHTML = rows.map((row) => `
      <li class="board-row${row.self ? ' self' : ''}">
        <span class="board-place">${row.place}</span>
        <span class="avatar" style="${row.photo ? `background-image:url('${esc(row.photo)}')` : ''}">${row.photo ? '' : esc((row.name || 'P').charAt(0))}</span>
        <span class="board-name">${row.self ? t('profile.me') : esc(row.name)}</span>
        <span class="board-score">${formatNumber(row.score)}</span>
      </li>
    `).join('');

    const lonely = rows.length <= 1 && board !== 'clan';
    const clanEmpty = board === 'clan' && !profile.clan;
    this.el.boardEmpty.textContent = lonely || clanEmpty ? empty : '';
    this.el.boardEmpty.classList.toggle('hidden', !(lonely || clanEmpty));
    if (board === 'clan' && profile.clan) this.el.boardEmpty.classList.add('hidden');

    this.el.clanForm.classList.toggle('hidden', board !== 'clan' || Boolean(profile.clan));
    this.el.clanActions.classList.toggle('hidden', board !== 'clan' || !profile.clan);
    if (profile.clan) {
      const role = t(profile.clan.role === 'leader' ? 'profile.leader' : 'profile.member');
      this.el.clanBanner.textContent = `${profile.clan.name} · ${profile.clan.code} · ${role}`;
    }
  }

  showError(message) {
    this.el.menuError.textContent = message || '';
  }

  resetFileInput() {
    if (this.el.fileInput) this.el.fileInput.value = '';
  }

  // ── Экраны ───────────────────────────────────────────────────────────────

  showScreen(name) {
    for (const [key, element] of Object.entries(this.el.screens)) {
      element.classList.toggle('active', key === name);
    }
    document.body.dataset.screen = name;
    for (const button of this.el.appNav.querySelectorAll('[data-nav]')) {
      button.classList.toggle('selected', button.dataset.nav === (name === 'profile' ? 'profile' : 'menu'));
    }
    if (name !== 'game') this.hidePause();
    if (name !== 'menu') this.closeLibrary();
    this._syncBackButton();
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

  prepareHud(modeId, difficulty) {
    const mode = MODES[modeId];
    this._modeId = modeId;
    this._difficulty = difficulty;
    this.el.barLabel.textContent = mode.barLabel;
    this.el.modeBadge.textContent = mode.title;
    this.el.modeBadge.style.color = mode.accent;
    this.el.shield.textContent = modeId === 'drive' ? t('hud.rageHint') : t('hud.calmHint');
    this.el.judgment.textContent = '';
    this.el.judgment.className = 'judgment';
    this._judgmentHideAt = 0;
    this._lastScore = -1;
    this._lastCombo = -1;
    this._lastBar = -1;
    this._lastShield = null;
    this._lastShieldVisible = null;
    this._lastBarLabel = '';
    this.showCoach(modeId, difficulty);
    this.hidePause();
  }

  showPause(score) {
    if (this.el.pauseScore) {
      this.el.pauseScore.textContent = `${t('result.points')} · ${formatNumber(score)}`;
    }
    this.el.pauseOverlay?.classList.remove('hidden');
    if (this.el.pauseBtn) this.el.pauseBtn.classList.add('hidden');
  }

  hidePause() {
    this.el.pauseOverlay?.classList.add('hidden');
    if (this.el.pauseBtn) this.el.pauseBtn.classList.remove('hidden');
  }

  showCoach(modeId, difficulty) {
    if (!this.el.coach) return;
    const seenKey = difficulty ? `${modeId}:${difficulty}` : modeId;
    const seen = (peekLocal('ux_coach_v2') || '').split(',').filter(Boolean);
    if (seen.includes(seenKey)) {
      this.el.coach.classList.add('hidden');
      return;
    }
    const key = modeId === 'drive' && difficulty ? `coach.drive.${difficulty}` : `coach.${modeId}`;
    this.el.coach.textContent = t(key);
    this.el.coach.classList.remove('hidden');
  }

  dismissCoach(modeId, difficulty) {
    if (!this.el.coach || this.el.coach.classList.contains('hidden')) return;
    this.el.coach.classList.add('hidden');
    const seenKey = difficulty ? `${modeId}:${difficulty}` : modeId;
    const seen = new Set((peekLocal('ux_coach_v2') || '').split(',').filter(Boolean));
    seen.add(seenKey);
    storage.set('ux_coach_v2', [...seen].join(','));
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
      const isHealthBar = Boolean(mode.diff?.canFail);
      this.el.barFill.classList.toggle('danger', isHealthBar && bar <= 25);
      this.el.barFill.classList.toggle('fever', Boolean(mode.feverActive));
      this.el.barFill.classList.toggle('bliss', Boolean(mode.blissActive));
    }

    let barLabel = MODES[this._modeId]?.barLabel ?? '';
    if (mode.blissActive) barLabel = t('hud.bliss');
    else if (mode.feverActive) barLabel = t('hud.fever');
    else if (this._modeId === 'drive' && mode.diff?.canFail) barLabel = 'HP';
    if (barLabel !== this._lastBarLabel) {
      this._lastBarLabel = barLabel;
      this.el.barLabel.textContent = barLabel;
    }

    let shieldText = this._modeId === 'drive' ? t('hud.rageHint') : t('hud.calmHint');
    if (mode.feverActive) shieldText = t('hud.fever');
    else if (mode.blissActive) shieldText = t('hud.bliss');
    else if (this._modeId === 'drive' && mode.diff?.canFail && shieldActive) {
      shieldText = t('hud.shield');
    }
    if (this.el.shield.textContent !== shieldText) {
      this.el.shield.textContent = shieldText;
    }

    const showBadge = this._modeId === 'relax'
      || (this._modeId === 'drive' && !mode.diff?.canFail)
      || Boolean(shieldActive);
    if (showBadge !== this._lastShieldVisible) {
      this._lastShieldVisible = showBadge;
      this.el.shield.classList.toggle('hidden', !showBadge);
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
    const pack = buildInvite('challenge', { score: stats.score });
    const shareBody = pack.url ? `${text}\n${pack.url}` : `${text}\n${t('profile.inviteCode', { code: pack.payload })}`;
    this.el.shareBtn.dataset.text = shareBody;
    this.el.shareBtn.dataset.url = pack.url || '';
    this.el.shareBtn.textContent = t('result.share');
    this._lastResultScore = stats.score;

    this._shareUrl = this._buildShareCard(stats, meta, rank);
    this.el.shareImage.src = this._shareUrl;
    this.el.downloadBtn?.classList.toggle('hidden', isTelegram);

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
