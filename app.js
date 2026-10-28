// Tasks live only in the `tasks` table and stay unreadable until kickoff (RLS), so they remain a surprise
const DEFAULT_KICKOFF = '2026-10-29T15:00:00+01:00';

// Agenda fallback; the source of truth is the `agenda` table (Berlin time, CET = +01:00)
const FALLBACK_AGENDA = [
  ['2026-10-29T09:19', '2026-10-29T13:57', 'Train Munich → Berlin'],
  ['2026-10-29T14:00', '2026-10-29T15:00', 'HBF → Friedrichshain'],
  ['2026-10-29T15:00', null,               'Housing check-in'],
  ['2026-10-29T16:00', '2026-10-29T17:15', 'Speedinvest visit'],
  ['2026-10-29T17:30', '2026-10-29T19:00', 'Telli visit'],
  ['2026-10-29T19:30', '2026-10-29T22:00', 'Reonic visit + dinner & drinks'],
  ['2026-10-29T22:00', '2026-10-29T23:30', 'Bar'],
  ['2026-10-30T10:00', '2026-10-30T12:00', 'Knowunity visit'],
  ['2026-10-30T12:30', '2026-10-30T14:00', 'Lunch: Planet A'],
  ['2026-10-30T12:30', '2026-10-30T14:00', 'Alternative lunch'],
  ['2026-10-30T15:00', '2026-10-30T17:15', 'ICEYE + LiveEO + Reflex Aerospace'],
  ['2026-10-30T18:15', '2026-10-30T21:30', 'Zauber x Lucid Capital visit + dinner & drinks'],
  ['2026-10-30T21:30', '2026-10-30T23:30', 'Bar'],
  ['2026-10-31T09:30', '2026-10-31T10:30', 'Sightseeing coffee run'],
  ['2026-10-31T11:00', '2026-10-31T12:00', 'Breakfast together'],
  ['2026-10-31T12:30', '2026-10-31T16:00', 'Architecture tour with Desi'],
  ['2026-10-31T12:30', '2026-10-31T16:00', 'Coworking'],
  ['2026-10-31T12:30', '2026-10-31T16:00', 'Hackathon GTM'],
  ['2026-10-31T12:30', '2026-10-31T16:00', 'Underground tour'],
  ['2026-10-31T16:00', '2026-10-31T18:00', 'Team building'],
  ['2026-10-31T18:00', '2026-10-31T19:30', 'Costumes on + dinner'],
  ['2026-10-31T19:30', '2026-10-31T21:00', 'Pre-drinks + makeup', 'Costume pitch'],
  ['2026-10-31T23:00', null,               'Lokschuppen: Disco'],
  ['2026-11-01T13:00', '2026-11-01T14:30', 'Train Berlin → Munich', 'Individual'],
].map(([s, e, title, note]) => ({ starts_at: s + '+01:00', ends_at: e && e + '+01:00', title, note }));

const BUCKET       = 'bingo-photos';
const ORIGINALS_BUCKET = 'bingo-originals';
const FEED_PAGE    = 10;
const LB_POLL_MS   = 20000;
const LS_PLAYER    = 'bt-player';
const LS_DONE      = 'bt-done';
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ═══════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════

let db = null;
let channel = null;
let lbTimer = null;
let lbPollTimer = null;

const state = {
  tasks: [],
  kickoff: new Date(DEFAULT_KICKOFF),
  live: false,
  agenda: FALLBACK_AGENDA,
  player: null,        // { id, name }
  done: {},            // task_id -> { photo_url }
  active: null,        // task_id open in the sheet
  file: null,
  uploading: false,
  lbRows: [],
  shownPoints: 0,
};

const $ = id => document.getElementById(id);

function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
}
function lsGet(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch (e) { return fallback; }
}

const taskById  = id => state.tasks.find(t => t.id === id);
const maxPoints = () => state.tasks.reduce((s, t) => s + t.points, 0);
const myPoints  = () => Object.keys(state.done).reduce((s, id) => s + (taskById(id)?.points ?? 0), 0);

// ═══════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════

async function init() {
  if (typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL && !SUPABASE_URL.includes('YOUR_')) {
    db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  await Promise.all([loadConfig(), loadAgenda()]);
  if (isLive()) await loadTasks();

  if (new URLSearchParams(location.search).get('display') === 'true') {
    document.body.classList.add('display-mode');
    showScreen('display');
    initDisplay();
    return;
  }

  state.player = lsGet(LS_PLAYER, null);
  state.done   = lsGet(LS_DONE, {});

  if (state.player?.id && isLive()) {
    enterApp();
  } else {
    showSplash();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !db) return;
    subscribe();                 // sockets often die while the phone is locked
    refreshLeaderboard();
    if (state.player) syncMyCompletions();
  });
}

async function loadTasks() {
  if (!db) return;
  const { data } = await db.from('tasks').select('id, text, points, sort').order('sort');
  if (data?.length) state.tasks = data;
}

// Retry until the challenges arrive (RLS returns [] until the server clock passes kickoff)
async function ensureTasks() {
  for (let i = 0; i < 15 && !state.tasks.length; i++) {
    await loadTasks();
    if (!state.tasks.length) await new Promise(r => setTimeout(r, 2000));
  }
  $('score-max').textContent = maxPoints();
  renderTasks();
  updateScore(false);
}

async function loadConfig() {
  if (!db) return;
  const { data } = await db.from('config').select('kickoff_at').eq('id', 1).maybeSingle();
  if (data?.kickoff_at) state.kickoff = new Date(data.kickoff_at);
}

const isLive = () => Date.now() >= state.kickoff.getTime();

async function loadAgenda() {
  if (!db) return;
  const { data } = await db.from('agenda').select('starts_at, ends_at, title, note').order('starts_at').order('id');
  if (data?.length) state.agenda = data;
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === `screen-${name}`));
}

// ═══════════════════════════════════════════════
// SPLASH
// ═══════════════════════════════════════════════

const nameInput = $('name-input');
const goBtn     = $('go-btn');
let countdownTimer = null;

function showSplash() {
  showScreen('splash');
  renderAgenda($('splash-agenda'), false);
  const k = state.kickoff;
  const at = state.agenda.find(a => new Date(a.starts_at).getTime() === k.getTime());
  $('cd-when').textContent = [
    k.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ }),
    fmtTime(k),
    at?.title,
  ].filter(Boolean).join(' · ');
  state.live = isLive();
  setSplashLive(state.live);
  tickCountdown();
  clearInterval(countdownTimer);
  countdownTimer = setInterval(tickCountdown, 1000);
}

function tickCountdown() {
  const ms = state.kickoff.getTime() - Date.now();
  if (ms <= 0) {
    clearInterval(countdownTimer);
    if (!state.live) onKickoff();
    return;
  }
  const sec = Math.floor(ms / 1000);
  setDigit('d', Math.floor(sec / 86400));
  setDigit('h', Math.floor(sec / 3600) % 24);
  setDigit('m', Math.floor(sec / 60) % 60);
  setDigit('s', sec % 60);
}

function setDigit(unit, value) {
  const el = document.querySelector(`.cd-unit b[data-u="${unit}"]`);
  const text = String(value).padStart(2, '0');
  if (el.textContent === text) return;
  el.textContent = text;
  el.classList.remove('tick');
  void el.offsetWidth;
  el.classList.add('tick');
}

// Fires live when the countdown hits zero while the page is open
async function onKickoff() {
  state.live = true;
  setSplashLive(true);
  fireworks(2500);
  buzz([40, 60, 120]);
  await loadTasks();
}

function setSplashLive(live) {
  $('screen-splash').classList.toggle('is-live', live);
  goBtn.disabled = !live;
  $('go-label').textContent = live
    ? "Let's fucking go"
    : `🔒 Unlocks ${state.kickoff.toLocaleDateString('en-GB', { weekday: 'short', timeZone: TZ })} ${fmtTime(state.kickoff)}`;
}

goBtn.addEventListener('click', () => {
  if (!isLive()) return;
  const step = $('name-step');
  if (!step.classList.contains('open')) {
    step.classList.add('open');
    goBtn.disabled = !nameInput.value.trim();
    setTimeout(() => nameInput.focus(), 250);
    return;
  }
  startPlaying();
});

nameInput.addEventListener('input', () => { goBtn.disabled = !nameInput.value.trim(); });
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') startPlaying(); });

function startPlaying() {
  if (!isLive()) return;
  const name = nameInput.value.trim().slice(0, 40);
  if (!name) return;
  state.player = { id: crypto.randomUUID?.() ?? uuidFallback(), name };
  state.done = {};
  lsSet(LS_PLAYER, state.player);
  lsSet(LS_DONE, state.done);
  buzz(20);
  enterApp();
}

// ═══════════════════════════════════════════════
// APP SHELL
// ═══════════════════════════════════════════════

function enterApp() {
  showScreen('app');
  clearInterval(countdownTimer);
  $('player-name').textContent = state.player.name;
  $('score-max').textContent = maxPoints();
  renderTasks();
  updateScore(false);
  if (!state.tasks.length) ensureTasks();
  renderAgenda();
  renderNowCard();
  setInterval(() => { renderNowCard(); if ($('view-agenda').classList.contains('active')) renderAgenda(); }, 60000);

  if (!db) return;
  subscribe();
  syncMyCompletions();
  refreshLeaderboard();
  clearInterval(lbPollTimer);
  lbPollTimer = setInterval(() => { if (document.visibilityState === 'visible') refreshLeaderboard(); }, LB_POLL_MS);
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
});

function switchView(view) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  if (view === 'feed') {
    $('feed-dot').classList.remove('on');
    phoneFeed.start();
  }
  if (view === 'ranking') refreshLeaderboard();
  if (view === 'agenda') renderAgenda();
}

// ═══════════════════════════════════════════════
// AGENDA
// ═══════════════════════════════════════════════

const TZ = 'Europe/Berlin';
const fmtTime = d => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const dayKey  = d => d.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD

function agendaItems() {
  return state.agenda.map(a => {
    const start = new Date(a.starts_at);
    // Open-ended entries count as "now" for 90 min
    const end = a.ends_at ? new Date(a.ends_at) : new Date(start.getTime() + 90 * 60000);
    return { ...a, start, end, day: dayKey(start) };
  });
}

// Simple plan: all days stacked, one row per slot, parallel options joined with "or"
function renderAgenda(list = $('agenda-list'), scrollToToday = true) {
  const items = agendaItems();
  const today = dayKey(new Date());
  const now = Date.now();
  list.innerHTML = '';

  [...new Set(items.map(i => i.day))].forEach(day => {
    const d = new Date(day + 'T12:00:00');
    const section = document.createElement('section');
    section.className = 'plan-day' + (day === today ? ' today' : '') + (day < today ? ' past' : '');
    section.innerHTML = `<h3>${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}${day === today ? '<span>Today</span>' : ''}</h3>`;

    const slots = [];
    items.filter(i => i.day === day).forEach(i => {
      const last = slots[slots.length - 1];
      if (last && last[0].starts_at === i.starts_at) last.push(i); else slots.push([i]);
    });

    slots.forEach(slot => {
      const first = slot[0];
      const status = now >= first.end.getTime() ? 'past' : now >= first.start.getTime() ? 'live' : '';
      const note = slot.length > 1 ? 'Pick one' : first.note;
      const row = document.createElement('div');
      row.className = `plan-row ${status}`;
      row.innerHTML = `
        <time>${fmtTime(first.start)}</time>
        <div>
          <div class="plan-title">${slot.map(i => safe(i.title)).join(' <i>or</i> ')}${status === 'live' ? ' <span class="live-pill">Now</span>' : ''}</div>
          ${note || first.ends_at ? `<div class="plan-sub">${[note && safe(note), first.ends_at && `until ${fmtTime(first.end)}`].filter(Boolean).join(' · ')}</div>` : ''}
        </div>`;
      section.appendChild(row);
    });
    list.appendChild(section);
  });

  if (scrollToToday) list.querySelector('.plan-day.today')?.scrollIntoView({ block: 'start', behavior: 'instant' });
}

function renderNowCard() {
  const card = $('now-card');
  const now = Date.now();
  const items = agendaItems();
  const live = items.filter(i => now >= i.start && now < i.end);
  const next = items.find(i => i.start > now);
  if (!live.length && !next) { card.hidden = true; return; }

  const titles = list => list.map(i => safe(i.title)).join(' <i>or</i> ');
  const nextGroup = next ? items.filter(i => i.starts_at === next.starts_at) : [];
  const lead = live.length
    ? `<span class="live-pill">Now</span><b>${titles(live)}</b><small>until ${fmtTime(live[0].end)}</small>`
    : `<span class="next-pill">Next</span><b>${titles(nextGroup)}</b><small>${relDay(next.start)} ${fmtTime(next.start)}</small>`;
  const after = live.length && next ? `<div class="now-next">Next: ${titles(nextGroup)} · ${relDay(next.start)} ${fmtTime(next.start)}</div>` : '';
  card.innerHTML = `<div class="now-main">${lead}</div>${after}`;
  card.hidden = false;
}

$('now-card').addEventListener('click', () => switchView('agenda'));

function relDay(d) {
  const diff = Math.round((new Date(dayKey(d)) - new Date(dayKey(new Date()))) / 86400000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: TZ });
}

$('reset-btn').addEventListener('click', () => {
  if (!confirm('Switch player? Your points stay on the leaderboard, but this phone starts fresh.')) return;
  [LS_PLAYER, LS_DONE].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
  location.reload();
});

// Server is the truth: pull my completions so points survive cache loss and match the leaderboard
async function syncMyCompletions() {
  const { data, error } = await db
    .from('completions')
    .select('task_id, photo_url')
    .eq('player_id', state.player.id);
  if (error || !data) return;
  const next = {};
  data.forEach(r => { next[r.task_id] = { photo_url: r.photo_url }; });
  const changed = JSON.stringify(Object.keys(next).sort()) !== JSON.stringify(Object.keys(state.done).sort());
  state.done = next;
  lsSet(LS_DONE, next);
  if (changed) { renderTasks(); updateScore(true); }
}

// ═══════════════════════════════════════════════
// TASK LIST
// ═══════════════════════════════════════════════

function renderTasks() {
  const list = $('task-list');
  list.innerHTML = '';
  if (!state.tasks.length) {
    list.innerHTML = '<li class="task-loading"><div class="spinner"></div>Loading challenges…</li>';
    return;
  }
  // Open tasks first (highest points on top), done ones sink to the bottom
  const sorted = [...state.tasks].sort((a, b) =>
    (!!state.done[a.id] - !!state.done[b.id]) || (b.points - a.points));

  sorted.forEach((task, i) => {
    const done = state.done[task.id];
    const li = document.createElement('li');
    li.className = 'task' + (done ? ' done' : '');
    li.style.setProperty('--i', i);
    li.dataset.id = task.id;
    li.innerHTML = `
      <span class="pts-badge">${task.points}<small>pt${task.points > 1 ? 's' : ''}</small></span>
      <span class="task-text">${safe(task.text)}</span>
      ${done
        ? `<span class="task-thumb"><img src="${safe(done.photo_url)}" alt="" loading="lazy" decoding="async"><i>✓</i></span>`
        : `<span class="task-cta"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span>`}`;
    li.addEventListener('click', () => done ? openLightbox(done.photo_url) : openSheet(task.id));
    list.appendChild(li);
  });
}

function updateScore(animate) {
  const pts = myPoints();
  const max = maxPoints();
  countUp($('score-points'), state.shownPoints, pts, animate);
  state.shownPoints = pts;
  $('progress-bar').style.transform = `scaleX(${max ? pts / max : 0})`;
  updateRankLabel();
}

function updateRankLabel() {
  const el = $('score-rank');
  if (!state.player) return;
  const idx = state.lbRows.findIndex(r => r.player_id === state.player.id);
  el.textContent = idx === -1 ? 'Not ranked yet' : `#${idx + 1} of ${state.lbRows.length}`;
}

// ═══════════════════════════════════════════════
// COMPLETE A TASK (bottom sheet)
// ═══════════════════════════════════════════════

function openSheet(taskId) {
  if (state.uploading) return;
  const task = taskById(taskId);
  state.active = taskId;
  state.file = null;
  $('sheet-points').textContent = `+${task.points}`;
  $('sheet-task').textContent = task.text;
  $('photo-preview').removeAttribute('src');
  $('photo-drop').classList.remove('has-photo');
  $('photo-input').value = '';
  $('submit-btn').disabled = true;
  $('sheet').classList.add('open');
  $('sheet').setAttribute('aria-hidden', 'false');
  buzz(10);
}

function closeSheet() {
  if (state.uploading) return;
  $('sheet').classList.remove('open');
  $('sheet').setAttribute('aria-hidden', 'true');
  state.active = null;
  state.file = null;
}

$('sheet-backdrop').addEventListener('click', closeSheet);
$('sheet-cancel').addEventListener('click', closeSheet);
$('photo-drop').addEventListener('click', () => $('photo-input').click());

$('photo-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  state.file = file;
  const preview = $('photo-preview');
  if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
  preview.src = URL.createObjectURL(file);
  $('photo-drop').classList.add('has-photo');
  $('submit-btn').disabled = false;
});

$('submit-btn').addEventListener('click', async () => {
  if (!state.file || state.uploading) return;
  $('submit-btn').disabled = true;
  await submitCompletion();
  $('submit-btn').disabled = !state.file;
});

async function submitCompletion() {
  if (!db) { showToast('Not connected. Try again in a sec.'); return; }
  const taskId = state.active;
  const original = state.file;
  const task = taskById(taskId);
  state.uploading = true;
  showLoading('Uploading...');

  const onUnload = e => { e.preventDefault(); e.returnValue = ''; };
  window.addEventListener('beforeunload', onUnload);

  try {
    const photo = await uploadWithRetry(state.file);
    const { error } = await db.from('completions').insert({
      player_id:   state.player.id,
      player_name: state.player.name,
      task_id:     taskId,
      photo_url:   photo.url,
      photo_w:     photo.w,
      photo_h:     photo.h,
    });

    // 23505 = unique violation: already checked off (double tap, second tab) — not an error for the user
    if (error && error.code !== '23505') throw error;

    state.done[taskId] = { photo_url: photo.url };
    uploadOriginal(original, taskId); // fire and forget, the player never waits for it
    lsSet(LS_DONE, state.done);
    state.uploading = false;
    closeSheet();
    renderTasks();
    updateScore(true);
    celebrate(task.points);
    refreshLeaderboard();
  } catch (err) {
    console.error(err);
    showToast('Upload failed. Try again?');
  } finally {
    state.uploading = false;
    hideLoading();
    window.removeEventListener('beforeunload', onUnload);
  }
}

// Full-resolution copy for printing, in a private bucket (insert-only, not publicly readable)
let originalsPending = 0;
const guardOriginals = e => { e.preventDefault(); e.returnValue = ''; };

async function uploadOriginal(file, taskId, attempts = 4) {
  if (!db || !file) return;
  if (originalsPending++ === 0) window.addEventListener('beforeunload', guardOriginals);
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${state.player.id}/${taskId}-${Date.now()}.${ext}`;
  try {
    for (let i = 0; i < attempts; i++) {
      const { error } = await db.storage.from(ORIGINALS_BUCKET).upload(path, file, { contentType: file.type || 'image/jpeg' });
      if (!error) return;
      if (i === attempts - 1) console.error('original upload failed', error);
      else await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  } finally {
    if (--originalsPending === 0) window.removeEventListener('beforeunload', guardOriginals);
  }
}

async function uploadWithRetry(file, attempts = 3) {
  const img = await compressImage(file);
  const fileName = `${state.player.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

  for (let i = 0; i < attempts; i++) {
    const { error } = await db.storage.from(BUCKET).upload(fileName, img.blob, { contentType: 'image/jpeg' });
    if (!error) break;
    if (i === attempts - 1) throw error;
    await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    showLoading(`Retrying... (${i + 2}/${attempts})`);
  }

  return { url: db.storage.from(BUCKET).getPublicUrl(fileName).data.publicUrl, w: img.w, h: img.h };
}

// Compress to max 1080px JPEG and report dimensions so the feed can reserve space (no layout jumps)
function compressImage(file) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1080; // keeps photos ~150-250 KB so 30 people scrolling stay well inside free-tier egress
      let { naturalWidth: width, naturalHeight: height } = img;
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
        else { width = Math.round(width * MAX / height); height = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => resolve({ blob: blob || file, w: width, h: height }), 'image/jpeg', 0.78);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ blob: file, w: null, h: null }); };
    img.src = url;
  });
}

function celebrate(points) {
  buzz([30, 40, 60]);
  showToast(`+${points} point${points > 1 ? 's' : ''}. Let's go!`);
  fireworks(points >= 4 ? 2200 : 900);
  if (myPoints() === maxPoints()) {
    setTimeout(() => {
      $('all-done-points').textContent = maxPoints();
      $('all-done').classList.add('open');
      fireworks(3500);
    }, 1200);
  }
}

$('all-done-close').addEventListener('click', () => {
  $('all-done').classList.remove('open');
  switchView('ranking');
});

function fireworks(ms) {
  if (typeof confetti === 'undefined' || REDUCED_MOTION) return;
  const end = Date.now() + ms;
  const colors = ['#0ABDE3', '#ffffff', '#FF5A36', '#F5C451'];
  (function frame() {
    if (Date.now() > end) return;
    confetti({ particleCount: 6, angle: 60,  spread: 60, origin: { x: 0, y: 0.7 }, colors });
    confetti({ particleCount: 6, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors });
    requestAnimationFrame(frame);
  })();
}

// ═══════════════════════════════════════════════
// LEADERBOARD
// ═══════════════════════════════════════════════

function scheduleLeaderboardRefresh() {
  clearTimeout(lbTimer);
  lbTimer = setTimeout(refreshLeaderboard, 800);
}

async function refreshLeaderboard() {
  if (!db) return;
  const { data, error } = await db
    .from('leaderboard')
    .select('player_id, player_name, points, done, last_at')
    .order('points', { ascending: false })
    .order('last_at', { ascending: true });
  if (error || !data) return;
  state.lbRows = data;
  updateRankLabel();
  const target = document.body.classList.contains('display-mode') ? $('display-lb') : $('lb-list');
  renderLeaderboard(target, data);
}

// Keyed render with FLIP: rows glide to their new rank instead of jumping
function renderLeaderboard(list, rows) {
  if (!rows.length) {
    list.innerHTML = '<li class="empty">Nobody on the board yet. Go get the first points!</li>';
    return;
  }
  list.querySelector('.empty')?.remove();

  const before = new Map();
  list.querySelectorAll('.lb-row').forEach(el => before.set(el.dataset.id, el.getBoundingClientRect().top));

  const existing = new Map([...list.querySelectorAll('.lb-row')].map(el => [el.dataset.id, el]));
  const keep = new Set();
  const max = maxPoints();

  rows.forEach((row, i) => {
    let el = existing.get(row.player_id);
    if (!el) {
      el = document.createElement('li');
      el.className = 'lb-row is-new';
      el.dataset.id = row.player_id;
      el.innerHTML = `<span class="lb-rank"></span><span class="lb-main"><span class="lb-name"></span><span class="lb-bar"><i></i></span></span><span class="lb-pts"></span>`;
    }
    const prevPts = Number(el.dataset.pts ?? 0);
    el.dataset.pts = row.points;
    el.classList.toggle('me', row.player_id === state.player?.id);
    el.classList.remove('r1', 'r2', 'r3');
    if (i < 3) el.classList.add(`r${i + 1}`);
    el.querySelector('.lb-rank').textContent = i + 1;
    el.querySelector('.lb-name').textContent = row.player_name;
    el.querySelector('.lb-bar i').style.transform = `scaleX(${max ? row.points / max : 0})`;
    countUp(el.querySelector('.lb-pts'), prevPts, row.points, prevPts !== row.points && before.size > 0);
    list.appendChild(el); // re-appending in order sorts the DOM
    keep.add(row.player_id);
  });

  existing.forEach((el, id) => { if (!keep.has(id)) el.remove(); });

  if (REDUCED_MOTION) return;
  list.querySelectorAll('.lb-row').forEach(el => {
    const old = before.get(el.dataset.id);
    if (old === undefined) return;
    const dy = old - el.getBoundingClientRect().top;
    if (!dy) return;
    el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
      { duration: 600, easing: 'cubic-bezier(.2,.8,.2,1)' });
    if (dy > 0) el.animate([{ backgroundColor: 'rgba(10,189,227,.25)' }, { backgroundColor: 'transparent' }], { duration: 1400 });
  });
}

// ═══════════════════════════════════════════════
// FEED — endless scroll, full-width photos
// ═══════════════════════════════════════════════

function createFeed(list, { root = list, pill, countEl } = {}) {
  const feed = { started: false, cursor: null, loading: false, finished: false, ids: new Set(), pending: [] };

  const sentinel = document.createElement('div');
  sentinel.className = 'feed-sentinel';

  const observer = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) loadPage();
  }, { root, rootMargin: '1200px 0px' });

  async function loadPage() {
    if (!db || feed.loading || feed.finished) return;
    feed.loading = true;
    let q = db.from('completions')
      .select('id, player_name, task_id, photo_url, photo_w, photo_h, created_at')
      .order('created_at', { ascending: false })
      .limit(FEED_PAGE);
    if (feed.cursor) q = q.lt('created_at', feed.cursor);
    const { data, error } = await q;
    feed.loading = false;
    if (error || !data) { showSkeleton(false); return; }

    showSkeleton(false);
    data.forEach(item => {
      if (feed.ids.has(item.id)) return;
      feed.ids.add(item.id);
      list.insertBefore(feedCard(item), sentinel);
    });
    if (data.length) feed.cursor = data[data.length - 1].created_at;
    if (data.length < FEED_PAGE) {
      feed.finished = true;
      sentinel.classList.add('end');
      sentinel.textContent = feed.ids.size ? "That's all. Go make more memories." : '';
      if (!feed.ids.size) list.insertBefore(emptyState(), sentinel);
    }
  }

  function showSkeleton(on) {
    list.querySelectorAll('.skeleton').forEach(el => el.remove());
    if (on) for (let i = 0; i < 2; i++) {
      const s = document.createElement('div');
      s.className = 'feed-card skeleton';
      s.innerHTML = '<div class="feed-photo" style="aspect-ratio:4/5"></div><div class="feed-meta"><i></i><i></i></div>';
      list.insertBefore(s, sentinel);
    }
  }

  function emptyState() {
    const e = document.createElement('div');
    e.className = 'feed-empty';
    e.innerHTML = '<b>No photos yet.</b><span>Check off a task and you\'re first on the wall.</span>';
    return e;
  }

  function prepend(item) {
    if (feed.ids.has(item.id)) return;
    feed.ids.add(item.id);
    list.querySelector('.feed-empty')?.remove();
    const card = feedCard(item);
    card.classList.add('incoming');
    const first = list.querySelector('.feed-card');
    list.insertBefore(card, first || sentinel);
  }

  function flushPending() {
    feed.pending.sort((a, b) => a.created_at.localeCompare(b.created_at)).forEach(prepend);
    feed.pending = [];
    pill?.classList.remove('show');
  }

  pill?.addEventListener('click', () => {
    flushPending();
    root.scrollTo({ top: 0, behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
  });

  root.addEventListener('scroll', () => {
    if (root.scrollTop < 40 && feed.pending.length) flushPending();
  }, { passive: true });

  return {
    start() {
      if (feed.started) return;
      feed.started = true;
      list.appendChild(sentinel);
      showSkeleton(true);
      observer.observe(sentinel);
    },
    onInsert(item) {
      if (!feed.started) return false;
      // Only add on top when the user is at the top, otherwise the scroll position would jump
      if (root.scrollTop < 40) { prepend(item); return true; }
      feed.pending.push(item);
      if (countEl) countEl.textContent = feed.pending.length;
      pill?.classList.add('show');
      return true;
    },
    onDelete(id) {
      feed.ids.delete(id);
      feed.pending = feed.pending.filter(p => p.id !== id);
      list.querySelector(`.feed-card[data-id="${id}"]`)?.remove();
    },
  };
}

function feedCard(item) {
  const task = taskById(item.task_id);
  const card = document.createElement('article');
  card.className = 'feed-card';
  card.dataset.id = item.id;
  const ratio = item.photo_w && item.photo_h ? `${item.photo_w}/${item.photo_h}` : '4/5';
  card.innerHTML = `
    <div class="feed-photo" style="aspect-ratio:${ratio}">
      <img src="${safe(item.photo_url)}" alt="" loading="lazy" decoding="async">
    </div>
    <div class="feed-meta">
      <div class="feed-who"><b>${safe(item.player_name)}</b><time>${timeAgo(item.created_at)}</time></div>
      <div class="feed-task">${task ? `<span class="pts-badge sm">+${task.points}</span>` : ''}<span>${safe(task?.text ?? '')}</span></div>
    </div>`;
  const img = card.querySelector('img');
  const ready = () => img.classList.add('loaded');
  img.complete ? ready() : img.addEventListener('load', ready, { once: true });
  card.querySelector('.feed-photo').addEventListener('click', () => openLightbox(item.photo_url));
  return card;
}

const phoneFeed = createFeed($('feed-list'), { root: $('view-feed'), pill: $('new-pill'), countEl: $('new-count') });
let displayFeed = null;

// ═══════════════════════════════════════════════
// REALTIME
// ═══════════════════════════════════════════════

function subscribe() {
  if (!db) return;
  if (channel) db.removeChannel(channel);
  channel = db.channel('tour')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'completions' }, ({ new: item }) => {
      const shown = (displayFeed ?? phoneFeed).onInsert(item);
      if (!shown || !$('view-feed').classList.contains('active')) $('feed-dot').classList.add('on');
      scheduleLeaderboardRefresh();
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'completions' }, ({ old }) => {
      (displayFeed ?? phoneFeed).onDelete(old.id);
      scheduleLeaderboardRefresh();
      if (state.player) syncMyCompletions();
    })
    .subscribe();
}

// ═══════════════════════════════════════════════
// DISPLAY MODE (Beamer/TV)
// ═══════════════════════════════════════════════

function initDisplay() {
  if (!db) {
    $('display-lb').innerHTML = '<li class="empty">Supabase not configured</li>';
    return;
  }
  displayFeed = createFeed($('display-feed'));
  displayFeed.start();
  refreshLeaderboard();
  subscribe();
  setInterval(refreshLeaderboard, LB_POLL_MS);
}

const fsBtn = $('fullscreen-btn');
fsBtn.addEventListener('click', () => {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    const el = document.documentElement;
    const goFull = el.requestFullscreen || el.webkitRequestFullscreen;
    if (goFull) goFull.call(el);
  }
});
document.addEventListener('fullscreenchange', () => {
  fsBtn.textContent = document.fullscreenElement ? '✕ Exit' : '⛶ Fullscreen';
});

// ═══════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════

function countUp(el, from, to, animate) {
  if (!animate || REDUCED_MOTION || from === to) { el.textContent = to; return; }
  const start = performance.now();
  const dur = 700;
  (function step(now) {
    const t = Math.min(1, (now - start) / dur);
    el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(step);
  })(start);
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

function buzz(pattern) {
  try { navigator.vibrate?.(pattern); } catch (e) {}
}

function uuidFallback() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function safe(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60)    return 'just now';
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function showLoading(msg) {
  $('loading-text').textContent = msg;
  $('loading').classList.add('active');
}
function hideLoading() {
  $('loading').classList.remove('active');
}

let toastTimer = null;
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('visible'), 2600);
}

function openLightbox(url) {
  $('lightbox-img').src = url;
  $('lightbox').classList.add('open');
}
$('lightbox').addEventListener('click', () => $('lightbox').classList.remove('open'));

// ═══════════════════════════════════════════════
// GO
// ═══════════════════════════════════════════════

init();
