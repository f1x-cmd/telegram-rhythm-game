/**
 * LiveOps-консоль. Не игровой тайминг: Date/localStorage здесь для отчётов
 * и сохранения конфига, а не для синхронизации нот с музыкой.
 */

import { ADMIN, TRACKS, leagueFor, titleFor, skillRating } from './config.js';
import { initTelegram, getUser } from './telegram.js';
import {
  loadLiveOps, liveops, saveLiveOps, resetLiveOps,
  scoreMultiplier, exportLiveOps, importLiveOps,
} from './liveops.js';
import { loadTelemetry, telemetry, summarize, clearTelemetry } from './telemetry.js';
import { loadCareer, career } from './career.js';
import { loadRecords, allRecords } from './records.js';
import { loadSocial, me, socialDump } from './social.js';
import { loadDaily, status as dailyStatus, adminSetGoal } from './daily.js';
import { loadLanguage } from './i18n.js';

const SESSION = 'rhythm_ops_ok';
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const VIEWS = {
  overview: ['Обзор', 'Метрики этого устройства и сети инвайтов — не глобальный DAU'],
  live: ['События', 'Техработы, баннер меню, множитель очков'],
  catalog: ['Каталог', 'Какие треки видит игрок'],
  economy: ['Экономика', 'Бот Mini App и пакеты Stars'],
  daily: ['Цель дня', 'Пороги заданий и принудительный слот'],
  balance: ['Баланс', 'NPS и щит новичка в DRIVE'],
  players: ['Игроки', 'Карьера, сеть, рекорды, ограничения'],
  logs: ['Журнал', 'Телеметрия партий и аудит конфига'],
};

const GOAL_LABELS = {
  notes: 'Ноты',
  score: 'Очки',
  combo: 'Комбо',
  perfect: 'PERFECT',
  flow: 'Поток',
};

let dirty = false;

function operatorName() {
  const user = getUser();
  return user?.username || user?.name || 'ops';
}

function authed() {
  return sessionStorage.getItem(SESSION) === '1';
}

function grant() {
  sessionStorage.setItem(SESSION, '1');
}

function canEnterByTelegram() {
  const user = getUser();
  if (!user?.id || !ADMIN.ids?.length) return false;
  return ADMIN.ids.map(String).includes(String(user.id));
}

function flash(text) {
  const el = $('#flash');
  el.textContent = text;
  el.classList.remove('hidden');
}

function fmt(n) {
  return Number(n || 0).toLocaleString('ru-RU');
}

function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return String(iso).slice(0, 16);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : value;
}

function markDirty() {
  dirty = true;
  $('#save-btn').textContent = 'Сохранить •';
}

function clearDirty() {
  dirty = false;
  $('#save-btn').textContent = 'Сохранить';
}

function setView(id) {
  $$('.view').forEach((el) => {
    const on = el.dataset.view === id;
    el.classList.toggle('active', on);
    el.hidden = !on;
  });
  $$('.nav-item').forEach((el) => el.classList.toggle('selected', el.dataset.view === id));
  const [title, sub] = VIEWS[id] || VIEWS.overview;
  $('#view-title').textContent = title;
  $('#view-sub').textContent = sub;
}

function fillTracks(ops) {
  const hidden = new Set(ops.disabledTracks || []);
  $('#track-toggles').innerHTML = TRACKS.map((track) => `
    <label class="toggle">
      <input type="checkbox" data-track="${track.id}" ${hidden.has(track.id) ? '' : 'checked'}>
      <span>${track.title} <small>(${track.id})</small></span>
    </label>
  `).join('');
}

function fillDailyTargets(ops) {
  const targets = ops.dailyTargets || {};
  $('#daily-targets').innerHTML = Object.keys(GOAL_LABELS).map((id) => `
    <label>${GOAL_LABELS[id]}
      <input data-daily="${id}" type="number" min="1" value="${targets[id] ?? ''}">
    </label>
  `).join('');
}

function fillBans(ops) {
  const bans = ops.bans || [];
  $('#ban-list').innerHTML = bans.length
    ? bans.map((id) => `<li class="row"><span>${id}</span><button type="button" class="ghost" data-unban="${id}">Снять</button></li>`).join('')
    : '<li class="muted">Ограничений нет</li>';
}

function fillForm(ops) {
  $('#maintenance').checked = Boolean(ops.maintenance);
  $('#maintenanceText').value = ops.maintenanceText || '';
  $('#banner').value = ops.banner || '';
  $('#eventName').value = ops.eventName || '';
  $('#eventMult').value = ops.eventMult ?? 1;
  $('#eventUntil').value = toLocalInput(ops.eventUntil);
  $('#featuredMode').value = ops.featuredMode || '';
  $('#allowUpload').checked = ops.allowUpload !== false;
  $('#allowDonate').checked = ops.allowDonate !== false;
  $('#telegramBot').value = ops.telegramBot || '';
  $('#telegramApp').value = ops.telegramApp || 'rhythm';
  $('#donatePacks').value = (ops.donatePacks || []).join(', ');
  $('#donateUrl').value = ops.donateUrl || '';
  $('#donateBot').value = ops.donateBot || '';
  $('#forceDaily').value = ops.forceDaily || '';
  $('#npsRelax').value = ops.nps?.relax ?? 1.5;
  $('#npsEasy').value = ops.nps?.easy ?? 2;
  $('#npsMedium').value = ops.nps?.medium ?? 3.4;
  $('#npsHard').value = ops.nps?.hard ?? 6;
  $('#shieldTime').value = ops.shieldTime ?? 15;
  $('#shieldMisses').value = ops.shieldMisses ?? 3;
  fillTracks(ops);
  fillDailyTargets(ops);
  fillBans(ops);
  clearDirty();
}

function collectPatch() {
  const packs = $('#donatePacks').value.split(/[,;\s]+/).map(Number).filter((n) => n > 0);
  const dailyTargets = {};
  $$('[data-daily]').forEach((el) => {
    dailyTargets[el.dataset.daily] = Math.max(1, Number(el.value) || 1);
  });
  const disabledTracks = $$('[data-track]').filter((el) => !el.checked).map((el) => el.dataset.track);
  return {
    maintenance: $('#maintenance').checked,
    maintenanceText: $('#maintenanceText').value.trim(),
    banner: $('#banner').value.trim(),
    eventName: $('#eventName').value.trim(),
    eventMult: Math.max(1, Number($('#eventMult').value) || 1),
    eventUntil: fromLocalInput($('#eventUntil').value),
    featuredMode: $('#featuredMode').value,
    allowUpload: $('#allowUpload').checked,
    allowDonate: $('#allowDonate').checked,
    telegramBot: $('#telegramBot').value.trim().replace(/^@/, ''),
    telegramApp: $('#telegramApp').value.trim() || 'rhythm',
    donatePacks: packs.length ? packs : [50, 150, 500],
    donateUrl: $('#donateUrl').value.trim(),
    donateBot: $('#donateBot').value.trim().replace(/^@/, ''),
    forceDaily: $('#forceDaily').value,
    dailyTargets,
    nps: {
      relax: Number($('#npsRelax').value) || 1.5,
      easy: Number($('#npsEasy').value) || 2,
      medium: Number($('#npsMedium').value) || 3.4,
      hard: Number($('#npsHard').value) || 6,
    },
    shieldTime: Math.max(0, Number($('#shieldTime').value) || 0),
    shieldMisses: Math.max(0, Number($('#shieldMisses').value) || 0),
    disabledTracks,
    bans: liveops().bans || [],
    _audit: 'save panel',
  };
}

function bars(map, empty) {
  const entries = Object.entries(map || {});
  if (!entries.length) return `<p class="muted">${empty}</p>`;
  const max = Math.max(...entries.map(([, n]) => n), 1);
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([label, n]) => `
      <div class="bar-row">
        <span>${label}</span>
        <div class="bar-track"><i style="width:${Math.round((n / max) * 100)}%"></i></div>
        <b>${fmt(n)}</b>
      </div>
    `).join('');
}

function renderOverview() {
  const ops = liveops();
  const kpi = summarize();
  const stats = career();
  const on = TRACKS.length - (ops.disabledTracks || []).length;
  const event = scoreMultiplier();

  $('#kpi-row').innerHTML = [
    ['Партии сегодня', kpi.today],
    ['Партии всего', kpi.total],
    ['Средний счёт', kpi.avg],
    ['Инвайты / Stars', `${kpi.invites} / ${kpi.donates}`],
  ].map(([label, value]) => `<article class="kpi"><b>${typeof value === 'number' ? fmt(value) : value}</b><span>${label}</span></article>`).join('');

  $('#day-bars').innerHTML = bars(kpi.days, 'Ещё нет партий на этом устройстве');
  $('#split-bars').innerHTML = bars(
    { RELAX: kpi.byMode.relax, DRIVE: kpi.byMode.drive, ...kpi.byTrack },
    'Нет разбивки — сыграйте хотя бы одну партию',
  );

  $('#prod-dl').innerHTML = [
    ['Статус', ops.maintenance ? 'ТЕХРАБОТЫ' : 'LIVE'],
    ['Баннер', ops.banner || '—'],
    ['Ивент', ops.eventName ? `${ops.eventName} ×${event}` : `множитель ×${event}`],
    ['Режим меню', ops.featuredMode || 'как у игрока'],
    ['Треки', `${on} из ${TRACKS.length}`],
    ['Загрузка MP3', ops.allowUpload === false ? 'выкл' : 'вкл'],
    ['Донат', ops.allowDonate === false ? 'скрыт' : 'в кабинете'],
    ['Карьера', `${fmt(stats.plays)} партий, ${fmt(stats.totalScore)} очков`],
    ['Последнее событие', fmtTime(kpi.lastAt)],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

function renderPlayers() {
  const stats = career();
  const player = me();
  const dump = socialDump();
  const league = leagueFor(stats.totalScore);
  const title = titleFor(stats.totalScore);

  $('#me-dl').innerHTML = [
    ['Имя', player.name],
    ['ID', player.id],
    ['Telegram', player.username || '—'],
    ['Лига / титул', `${league.id} / ${title.id}`],
    ['Рейтинг', fmt(skillRating(stats))],
    ['Всего очков', fmt(stats.totalScore)],
    ['Партии', `${fmt(stats.plays)} (R ${stats.relaxPlays} / D ${stats.drivePlays})`],
    ['Лучший забег', fmt(stats.bestScore)],
    ['Макс. комбо', fmt(stats.maxCombo)],
    ['Стрик', `${stats.streak} (лучш. ${stats.bestStreak})`],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

  const seen = new Map();
  for (const row of [...(dump.network || []), ...(dump.friends || []), ...(dump.clan?.members || [])]) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.set(row.id, row);
  }
  const rows = [...seen.values()].sort((a, b) => (b.score || 0) - (a.score || 0));
  $('#network-body').innerHTML = rows.length
    ? rows.map((row, i) => `<tr><td>${i + 1}</td><td>${row.name || '—'}</td><td>${row.id}</td><td>${fmt(row.score)}</td></tr>`).join('')
    : '<tr><td colspan="4">Сеть пуста — инвайты ещё не приходили</td></tr>';

  const records = Object.entries(allRecords());
  $('#records-body').innerHTML = records.length
    ? records.sort((a, b) => b[1] - a[1]).map(([key, score]) => `<tr><td>${key}</td><td>${fmt(score)}</td></tr>`).join('')
    : '<tr><td colspan="2">Рекордов нет</td></tr>';
}

function renderLogs() {
  const events = [...telemetry()].reverse().slice(0, 40);
  $('#tel-body').innerHTML = events.length
    ? events.map((ev) => {
      const { at, type, ...rest } = ev;
      return `<tr><td>${fmtTime(at)}</td><td>${type}</td><td>${JSON.stringify(rest)}</td></tr>`;
    }).join('')
    : '<tr><td colspan="3">Журнал пуст</td></tr>';

  const audit = liveops().audit || [];
  $('#audit-body').innerHTML = audit.length
    ? audit.map((row) => `<tr><td>${fmtTime(row.at)}</td><td>${row.who}</td><td>${row.note}</td></tr>`).join('')
    : '<tr><td colspan="3">Изменений конфига ещё не было</td></tr>';
}

function renderDailyNow() {
  const now = dailyStatus();
  $('#daily-now').textContent = now.done
    ? `Сегодня: ${now.title} — выполнено (${fmt(now.progress)} / ${fmt(now.target)})`
    : `Сегодня: ${now.title} — ${fmt(now.progress)} / ${fmt(now.target)}`;
}

function refreshLivePill() {
  const ops = liveops();
  const pill = $('#live-pill');
  if (ops.maintenance) {
    pill.textContent = 'MAINT';
    pill.classList.add('off');
    return;
  }
  const mult = scoreMultiplier();
  pill.textContent = mult > 1 ? `LIVE ×${mult}` : 'LIVE';
  pill.classList.remove('off');
}

function refresh() {
  renderOverview();
  renderPlayers();
  renderLogs();
  renderDailyNow();
  refreshLivePill();
}

function save(note) {
  const patch = collectPatch();
  if (note) patch._audit = note;
  saveLiveOps(patch, operatorName());
  fillForm(liveops());
  refresh();
  flash('Конфиг записан. Игра подхватит его при следующем заходе в меню.');
}

function openShell() {
  const gate = $('#gate');
  gate.classList.add('hidden');
  gate.hidden = true;
  $('#shell').classList.remove('hidden');
}

async function bootConsole() {
  initTelegram();
  await Promise.all([
    loadLanguage(),
    loadLiveOps(),
    loadTelemetry(),
    loadCareer(),
    loadRecords(),
    loadSocial(),
    loadDaily(),
  ]);
  fillForm(liveops());
  setView('overview');
  refresh();
  openShell();
}

function bind() {
  $('#gate-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const pin = $('#pin').value;
    if (pin === ADMIN.pin || canEnterByTelegram()) {
      grant();
      bootConsole();
      return;
    }
    $('#gate-error').textContent = 'Неверный PIN.';
  });

  $('#nav').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (btn) setView(btn.dataset.view);
  });

  $('#shell').addEventListener('input', (e) => {
    if (e.target.closest('.view')) markDirty();
  });
  $('#shell').addEventListener('change', (e) => {
    if (e.target.closest('.view')) markDirty();
  });

  $('#save-btn').addEventListener('click', () => save('save panel'));

  $('#apply-daily-btn').addEventListener('click', () => {
    save('daily force');
    const id = $('#forceDaily').value;
    if (id) adminSetGoal(id);
    renderDailyNow();
    flash(id ? 'Сегодняшняя цель сброшена на выбранный слот.' : 'Слот снят, цель снова от даты.');
  });

  $('#ban-btn').addEventListener('click', () => {
    const id = $('#ban-id').value.trim();
    if (!id) return;
    const bans = [...new Set([...(liveops().bans || []), id])];
    saveLiveOps({ bans, _audit: `ban ${id}` }, operatorName());
    $('#ban-id').value = '';
    fillBans(liveops());
    refreshLivePill();
    flash(`Игрок ${id} ограничен. Старт партии на его устройстве блокируется после синка конфига.`);
  });

  $('#ban-list').addEventListener('click', (e) => {
    const id = e.target.dataset.unban;
    if (!id) return;
    const bans = (liveops().bans || []).filter((item) => item !== id);
    saveLiveOps({ bans, _audit: `unban ${id}` }, operatorName());
    fillBans(liveops());
    flash(`Ограничение с ${id} снято.`);
  });

  $('#clear-tel-btn').addEventListener('click', () => {
    if (!confirm('Очистить локальный журнал партий?')) return;
    clearTelemetry();
    renderLogs();
    renderOverview();
    flash('Телеметрия очищена.');
  });

  $('#export-btn').addEventListener('click', () => {
    const blob = new Blob([exportLiveOps()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rhythm-liveops.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      importLiveOps(text, operatorName());
      fillForm(liveops());
      refresh();
      flash('JSON загружен и применён.');
    } catch (_) {
      flash('Не удалось прочитать JSON.');
    }
  });

  $('#reset-btn').addEventListener('click', () => {
    if (!confirm('Сбросить LiveOps к заводским значениям?')) return;
    resetLiveOps();
    fillForm(liveops());
    refresh();
    flash('LiveOps сброшен.');
  });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (!$('#shell').classList.contains('hidden')) save('save shortcut');
    }
  });
}

initTelegram();
bind();

if (authed() || canEnterByTelegram()) {
  if (canEnterByTelegram()) grant();
  bootConsole();
}
