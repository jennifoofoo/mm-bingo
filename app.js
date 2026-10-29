// Tasks live only in the `tasks` table and stay unreadable until kickoff (RLS), so they remain a surprise.
// The orga unlocks by hand (orga_unlock sets kickoff_at to now); countdown_at is only what the splash counts down to
const DEFAULT_KICKOFF   = '2099-01-01T00:00:00+01:00';
const DEFAULT_COUNTDOWN = '2026-10-29T14:45:00+01:00';
const UNLOCK_POLL_MS = 6000;

// Food at the visits, shown as a loud badge in the agenda (mirrors agenda.food)
const FALLBACK_FOOD = {
  'Speedinvest visit': '🥐 Pastries from the bakery',
  'Reonic visit + dinner & drinks': '🍕 Pizza & drinks',
  'Knowunity visit': '☕ Coffee',
  'Option A: Lunch at Planet A': '🍽️ Food',
  'Option B: Merantix AI (VC)': '🍽️ Food',
  'Zauber x Lucid Capital visit + dinner & drinks': '🍽️ Dinner & drinks',
};

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
  ['2026-10-30T12:30', '2026-10-30T14:00', 'Option A: Lunch at Planet A'],
  ['2026-10-30T12:30', '2026-10-30T14:00', 'Option B: Merantix AI (VC)'],
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
].map(([s, e, title, note]) => ({ starts_at: s + '+01:00', ends_at: e && e + '+01:00', title, note, food: FALLBACK_FOOD[title] }));

const BUCKET       = 'bingo-photos';
const ORIGINALS_BUCKET = 'bingo-originals';
const SNAP = '__snap__'; // sheet target for a random photo (no task, no points)
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
let agendaTimer = null;

const state = {
  tasks: [],
  kickoff: new Date(DEFAULT_KICKOFF),
  countdown: new Date(DEFAULT_COUNTDOWN),
  live: false,
  agenda: FALLBACK_AGENDA,
  player: null,        // { id, name }
  done: {},            // task_id -> { photo_url }
  pending: new Set(),  // task_ids saved on the phone, waiting for signal
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

  const display = new URLSearchParams(location.search).get('display') === 'true';
  state.player = lsGet(LS_PLAYER, null);
  state.done   = lsGet(LS_DONE, {});

  // Paint immediately with built-in data; a slow or hanging network must never leave a black screen
  if (display) { document.body.classList.add('display-mode'); showScreen('display'); }
  else showSplash();

  const soft = p => withTimeout(p, 5000).catch(() => {});
  await Promise.all([soft(loadConfig()), soft(loadAgenda())]);
  if (isLive()) await soft(loadTasks());

  if (display) {
    initDisplay();
  } else if (state.player?.id && isLive()) {
    enterApp();
  } else {
    showSplash(); // re-render with the server's kickoff time and agenda
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !db) return;
    subscribe();                 // sockets often die while the phone is locked
    refreshLeaderboard();
    (displayFeed ?? phoneFeed).catchUp();
    if (!displayFeed) { snapFeed.catchUp(); catchUpComments(); }
    if (state.player) { syncMyCompletions(); flushQueue(); }
  });
}

async function loadTasks() {
  if (!db) return;
  const { data } = await db.from('tasks').select('*').order('sort');
  if (data?.length) state.tasks = data;
}

// Retry until the challenges arrive (RLS returns [] until the server clock passes kickoff)
let ensuring = false;
async function ensureTasks() {
  if (ensuring) return;
  ensuring = true;
  for (let i = 0; i < 15 && !state.tasks.length; i++) {
    await loadTasks().catch(() => {});
    if (!state.tasks.length) await new Promise(r => setTimeout(r, 2000));
  }
  ensuring = false;
  $('score-max').textContent = maxPoints();
  renderTasks();
  updateScore(false);
}

async function loadConfig() {
  if (!db) return;
  const { data } = await db.from('config').select('kickoff_at, countdown_at').eq('id', 1).maybeSingle();
  if (data?.kickoff_at) state.kickoff = new Date(data.kickoff_at);
  if (data?.countdown_at) state.countdown = new Date(data.countdown_at);
}

const isLive = () => Date.now() >= state.kickoff.getTime();

async function loadAgenda() {
  if (!db) return;
  const { data } = await db.from('agenda').select('*').order('starts_at').order('id');
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
let unlockTimer = null;

function showSplash() {
  showScreen('splash');
  renderAgenda($('splash-agenda'), false);
  const k = state.countdown;
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
  clearInterval(unlockTimer);
  if (!state.live) unlockTimer = setInterval(checkUnlock, UNLOCK_POLL_MS);
}

// Watch for the orga's unlock while the splash is open
async function checkUnlock() {
  if (document.visibilityState !== 'visible') return;
  await withTimeout(loadConfig(), 5000).catch(() => {});
  if (isLive()) tickCountdown();
}

function tickCountdown() {
  if (isLive()) {
    clearInterval(countdownTimer);
    clearInterval(unlockTimer);
    if (!state.live) onKickoff();
    return;
  }
  // Countdown over but not unlocked yet: hold at zero until the orga flips the switch
  const ms = Math.max(0, state.countdown.getTime() - Date.now());
  const waiting = ms === 0;
  if ($('screen-splash').classList.contains('is-waiting') !== waiting) {
    $('screen-splash').classList.toggle('is-waiting', waiting);
    setSplashLive(false);
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

// Fires when the orga unlocks while the page is open
async function onKickoff() {
  // Quiet unlock: only the button turns on, the confetti + prize reveal wait until people tap in
  state.live = true;
  setSplashLive(true);
  buzz(30);
  await loadTasks();
}

function setSplashLive(live) {
  $('screen-splash').classList.toggle('is-live', live);
  if (live) $('screen-splash').classList.remove('is-waiting');
  goBtn.disabled = !live;
  $('go-label').textContent = live
    ? "Let's fucking go"
    : $('screen-splash').classList.contains('is-waiting')
      ? 'Waiting for the orga to unlock 🔒'
      : `Opens ${state.countdown.toLocaleDateString('en-GB', { weekday: 'short', timeZone: TZ })} ${fmtTime(state.countdown)}`;
}

// Orga preview: the password is checked inside the DB (preview_tasks), never shipped in this file
$('orga-link').addEventListener('click', () => {
  $('orga-form').hidden = false;
  $('orga-pw').focus();
});

$('orga-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!db) return;
  const { data } = await db.rpc('preview_tasks', { pw: $('orga-pw').value });
  if (!data?.length) { showToast('Wrong password'); buzz(80); return; }
  state.tasks = data;
  state.preview = true;
  state.orgaPw = $('orga-pw').value; // memory only, used for orga check-offs before kickoff
  state.player = { id: '00000000-0000-4000-8000-000000000000', name: 'Orga' };
  state.done = {};
  $('preview-badge').hidden = false;
  $('unlock-btn').hidden = isLive();
  enterApp();
});

// Orga switch: unlocks challenges for everyone. Second tap confirms (no native dialogs)
let unlockArmed = null;
$('unlock-btn').addEventListener('click', async () => {
  const btn = $('unlock-btn');
  if (!unlockArmed) {
    btn.classList.add('armed');
    btn.textContent = 'Tap again to unlock for everyone';
    buzz(20);
    unlockArmed = setTimeout(() => {
      unlockArmed = null;
      btn.classList.remove('armed');
      btn.textContent = '🔓 Unlock everything';
    }, 4000);
    return;
  }
  clearTimeout(unlockArmed);
  unlockArmed = null;
  btn.disabled = true;
  const { data, error } = await db.rpc('orga_unlock', { pw: state.orgaPw });
  btn.disabled = false;
  if (error || !data) {
    btn.classList.remove('armed');
    btn.textContent = '🔓 Unlock everything';
    showToast('Unlock failed. Try again?');
    buzz(80);
    return;
  }
  state.kickoff = new Date(data);
  btn.hidden = true;
  showToast("Unlocked! Everyone's in 🎉");
  fireworks(2500);
  buzz([40, 60, 120]);
  // Back to the splash so the orga can join as a normal player
  setTimeout(() => location.reload(), 3000);
});

goBtn.addEventListener('click', () => {
  if (!isLive()) return;
  if (state.player?.id && !state.preview) { enterApp(); return; }
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

// Same name as an existing player = probably a new phone or cleared browser → offer to continue
let returning = null;

async function startPlaying() {
  if (!isLive()) return;
  const name = nameInput.value.trim().slice(0, 40);
  if (!name) return;
  if (db && !returning) {
    const { data } = await db.from('leaderboard').select('player_id, player_name, points').ilike('player_name', name.replace(/[%_]/g, ''));
    if (data?.length) {
      returning = data[0];
      $('welcome-back-text').textContent = `${returning.player_name} already has ${returning.points} point${returning.points === 1 ? '' : 's'}. Is that you?`;
      $('welcome-back').hidden = false;
      buzz(15);
      return;
    }
  }
  beginAs(crypto.randomUUID?.() ?? uuidFallback(), name);
}

function beginAs(id, name) {
  state.player = { id, name };
  state.done = {};
  lsSet(LS_PLAYER, state.player);
  lsSet(LS_DONE, state.done);
  buzz(20);
  enterApp();
}

$('wb-me').addEventListener('click', () => beginAs(returning.player_id, returning.player_name));
$('wb-new').addEventListener('click', () => {
  $('welcome-back').hidden = true;
  returning = null;
  nameInput.focus();
  showToast('Pick a different name, e.g. your full name or a nickname');
});
nameInput.addEventListener('input', () => { returning = null; $('welcome-back').hidden = true; });

// ═══════════════════════════════════════════════
// APP SHELL
// ═══════════════════════════════════════════════

function enterApp() {
  showScreen('app');
  clearInterval(countdownTimer);
  clearInterval(unlockTimer);
  $('player-name').textContent = state.player.name;
  $('score-max').textContent = maxPoints();
  renderTasks();
  updateScore(false);
  if (!state.tasks.length) ensureTasks();
  if (!lsGet('bt-howto-seen', false)) $('howto').hidden = false;
  if (!state.preview && !lsGet('bt-prize-seen', false)) showPrize();
  renderAgenda();
  renderNowCard();
  clearInterval(agendaTimer);
  agendaTimer = setInterval(() => { renderNowCard(); if ($('view-agenda').classList.contains('active')) renderAgenda(); }, 60000);

  if (!db) return;
  subscribe();
  syncMyCompletions();
  restorePending();
  refreshLeaderboard();
  clearInterval(lbPollTimer);
  lbPollTimer = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (!state.tasks.length) ensureTasks();
    refreshLeaderboard();
    phoneFeed.catchUp();
    snapFeed.catchUp();
    catchUpComments();
    flushQueue();
  }, LB_POLL_MS);
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
});

function switchView(view) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  if (view === 'feed') {
    $('feed-dot').classList.remove('on');
    (feedMode === 'random' ? snapFeed : phoneFeed).start();
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

// One day at a time behind day tabs, one row per slot, parallel options joined with "or"
function renderAgenda(list = $('agenda-list')) {
  const items = agendaItems();
  const today = dayKey(new Date());
  const now = Date.now();
  const days = [...new Set(items.map(i => i.day))];
  // Keep the tab the user picked; otherwise today, or the first/last day outside the tour
  // Only a tap pins a day; otherwise follow today so a phone left open overnight moves on
  if (!list.dataset.picked || !days.includes(list.dataset.day)) list.dataset.day = days.includes(today) ? today : today > days[days.length - 1] ? days[days.length - 1] : days[0];
  list.innerHTML = '';

  const tabs = document.createElement('div');
  tabs.className = 'day-tabs';
  tabs.innerHTML = days.map(day => {
    const d = new Date(day + 'T12:00:00');
    return `<button data-day="${day}" class="${day === list.dataset.day ? 'active' : ''}${day === today ? ' today' : ''}">
      <b>${d.toLocaleDateString('en-GB', { weekday: 'short' })}</b><small>${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}</small></button>`;
  }).join('');
  tabs.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    list.dataset.day = b.dataset.day;
    list.dataset.picked = '1';
    buzz(8);
    renderAgenda(list);
  });
  list.appendChild(tabs);

  days.filter(day => day === list.dataset.day).forEach(day => {
    const d = new Date(day + 'T12:00:00');
    const section = document.createElement('section');
    section.className = 'plan-day' + (day === today ? ' today' : '');
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
          ${slot.filter(i => i.food).map(i => `<div class="plan-food">${slot.length > 1 ? `${safe(i.title.replace(/^Option [AB]: /, ''))}: ` : ''}${safe(i.food)}</div>`).join('')}
          ${slot.filter(i => i.info || i.address || i.websites?.length).map(i => planInfo(i, slot.length > 1)).join('')}
        </div>`;
      section.appendChild(row);
    });
    list.appendChild(section);
  });
}

// What the visit is about + where it is, so everyone knows what's going on
const siteName = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

function planInfo(item, labelled) {
  const maps = item.address && `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`;
  const sites = (item.websites ?? []).filter(u => /^https:\/\//.test(u) && siteName(u));
  return `<div class="plan-info">
    ${item.info ? `<p>${labelled ? `<b>${safe(item.title)}:</b> ` : ''}${safe(item.info)}</p>` : ''}
    ${item.tags?.length ? `<div class="plan-tags">${item.tags.map(t => `<span>${safe(t)}</span>`).join('')}</div>` : ''}
    ${sites.length ? `<div class="plan-sites">${sites.map(u => `<a href="${safe(u)}" target="_blank" rel="noopener">${safe(siteName(u))} ↗</a>`).join('')}</div>
      <p class="plan-prep">Prep: 2 min on their site, bring 1 question → <b>+1 point</b></p>` : ''}
    ${maps ? `<a class="plan-addr" href="${maps}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><path d="M12 22s7-6.2 7-12a7 7 0 10-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>${safe(item.address)}</a>` : ''}
  </div>`;
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
  const food = [...new Set((live.length ? live : nextGroup).map(i => i.food).filter(Boolean))];
  const foodLine = food.length ? `<div class="now-food">${food.map(safe).join(' · ')}</div>` : '';
  card.innerHTML = `<div class="now-main">${lead}</div>${foodLine}${after}`;
  card.hidden = false;
}

$('now-card').addEventListener('click', () => switchView('agenda'));

function relDay(d) {
  const diff = Math.round((new Date(dayKey(d)) - new Date(dayKey(new Date()))) / 86400000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: TZ });
}

$('howto-close').addEventListener('click', () => {
  $('howto').hidden = true;
  lsSet('bt-howto-seen', true);
});

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

const isSettled = id => !!state.done[id] || state.pending.has(id);

const CATEGORIES = [
  { id: 'tour',    label: 'Tour',    sub: 'At the visits and in between',
    icon: '<path d="M4 21V5a1 1 0 011-1h9a1 1 0 011 1v16M15 9h4a1 1 0 011 1v11M3 21h18M8 8h3M8 12h3M8 16h3"/>' },
  { id: 'team',    label: 'Team',    sub: '3+ people. Everyone in the photo checks it off',
    icon: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0112 0M16 5a3 3 0 010 6M21 20a6 6 0 00-4-5.6"/>' },
  { id: 'club',    label: 'Club',    sub: 'Lokschuppen, bars and the night',
    icon: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>' },
  { id: 'spicy',   label: 'Spicy',   sub: 'Only if you want to. Big points.',
    icon: '<path d="M12 20.5s-7.5-4.6-9.3-9.2A4.9 4.9 0 0112 7.2a4.9 4.9 0 019.3 4.1c-1.8 4.6-9.3 9.2-9.3 9.2z"/>' },
  { id: 'special', label: 'Special', sub: 'Big points.',
    icon: '<path d="M12 22c4 0 7-2.7 7-7 0-4-3-6.5-4-10-2.5 1.5-4 4-4 6.5C9.5 10 8.5 9 8 7.5 6 9.5 5 12 5 15c0 4.3 3 7 7 7z"/>' },
];
const RANDOM_CAT = { id: 'random', label: 'Random', sub: '',
  icon: '<rect x="3" y="5" width="18" height="15" rx="3"/><circle cx="12" cy="12.5" r="3.5"/><path d="M8 5l1.5-2h5L16 5"/>' };
const catOf = t => CATEGORIES.some(c => c.id === t.category) ? t.category : 'tour';
const catIcon = c => `<svg viewBox="0 0 24 24" aria-hidden="true">${c.icon}</svg>`;
state.cat = 'all';

function renderCatChips() {
  const el = $('cat-chips');
  el.innerHTML = '';
  [{ id: 'all', label: 'All' }, ...CATEGORIES.filter(c => state.tasks.some(t => catOf(t) === c.id)), RANDOM_CAT].forEach(c => {
    const b = document.createElement('button');
    b.className = 'cat-chip' + (state.cat === c.id ? ' active' : '');
    b.innerHTML = `${c.icon ? catIcon(c) : ''}<span>${c.label}</span>`;
    b.addEventListener('click', () => {
      state.cat = c.id;
      renderTasks();
      $('view-tasks').scrollTo({ top: 0, behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
      buzz(8);
    });
    el.appendChild(b);
  });
}

function renderTasks() {
  const list = $('task-list');
  list.innerHTML = '';
  if (!state.tasks.length) {
    $('cat-chips').innerHTML = '';
    list.innerHTML = '<li class="task-loading"><div class="spinner"></div>Loading challenges…</li>';
    return;
  }
  renderCatChips();

  if (state.cat === 'all' || state.cat === 'random') {
    const card = document.createElement('li');
    card.className = 'random-card';
    card.innerHTML = `<span class="sec-icon">${catIcon(RANDOM_CAT)}</span>
      <span class="sec-text"><b>Share a random moment</b></span>
      <span class="task-cta"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span>`;
    card.addEventListener('click', openSnapSheet);
    list.appendChild(card);
  }
  if (state.cat === 'random') return;

  let i = 0;
  CATEGORIES.filter(c => state.cat === 'all' || state.cat === c.id).forEach(cat => {
    // Open tasks first (highest points on top), done ones sink to the bottom of their group
    const tasks = state.tasks.filter(t => catOf(t) === cat.id).sort((a, b) =>
      (isSettled(a.id) - isSettled(b.id)) || (b.points - a.points));
    if (!tasks.length) return;

    const head = document.createElement('li');
    head.className = `task-section cat-${cat.id}`;
    head.innerHTML = `<span class="sec-icon">${catIcon(cat)}</span><span class="sec-text"><b>${cat.label}</b><small>${cat.sub}</small></span><span class="sec-count">${tasks.filter(t => isSettled(t.id)).length}/${tasks.length}</span>`;
    list.appendChild(head);

    tasks.forEach(task => {
      const done = state.done[task.id];
      const pending = !done && state.pending.has(task.id);
      const li = document.createElement('li');
      li.className = `task cat-${cat.id}` + (done ? ' done' : '') + (pending ? ' pending' : '');
      li.style.setProperty('--i', i++);
      li.dataset.id = task.id;
      li.innerHTML = `
        <span class="pts-badge">${task.points}<small>pt${task.points > 1 ? 's' : ''}</small></span>
        <span class="task-text">${safe(task.text)}</span>
        ${done
          ? `<span class="task-thumb"><img src="${safe(done.photo_url)}" alt="" loading="lazy" decoding="async"><i>✓</i></span>`
          : pending
            ? `<span class="task-wait"><span class="spinner sm"></span><small>Waiting for signal</small></span>`
            : `<span class="task-cta"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span>`}`;
      li.addEventListener('click', () => {
        if (done) openLightbox(done.photo_url);
        else if (pending) { showToast('Saved on your phone. Uploads when you have signal.'); flushQueue(); }
        else openSheet(task.id);
      });
      list.appendChild(li);
    });
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

// Against feed spam: 30 random photos per person per Berlin day (the DB enforces it too)
const SNAP_DAILY_LIMIT = 30;
async function openSnapSheet() {
  if (db && state.player) {
    const { count } = await withTimeout(db.from('snaps').select('id', { count: 'exact', head: true })
      .eq('player_id', state.player.id).gte('created_at', `${dayKey(new Date())}T00:00:00+01:00`), 4000).catch(() => ({}));
    if (count >= SNAP_DAILY_LIMIT) { showToast(`That's ${SNAP_DAILY_LIMIT} random moments today. More tomorrow!`); buzz(60); return; }
  }
  openSheet(SNAP);
}

function openSheet(taskId) {
  if (state.uploading) return;
  const snap = taskId === SNAP;
  const task = snap ? null : taskById(taskId);
  state.active = taskId;
  state.file = null;
  $('sheet-points').hidden = snap;
  $('sheet-points').textContent = snap ? '' : `+${task.points}`;
  $('sheet-task').textContent = snap ? 'Random moment. No points, just vibes.' : task.text;
  $('snap-caption').hidden = !snap;
  $('snap-caption').value = '';
  $('submit-btn').querySelector('span').textContent = snap ? 'Share it' : 'Check it off';
  $('photo-drop').querySelector('.photo-drop-empty b').textContent = snap ? 'Add a photo' : 'Add your proof';
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

// ═══════════════════════════════════════════════
// OFFLINE QUEUE — a check-off is saved on the phone before any network call,
// so bad club signal never blocks playing; it syncs as soon as there is signal
// ═══════════════════════════════════════════════

const memQueue = new Map(); // fallback when IndexedDB is unavailable (some private modes)

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('bt-queue', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'key' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function qAll() {
  try {
    const d = await idb();
    const rows = await new Promise((res, rej) => {
      const r = d.transaction('items').objectStore('items').getAll();
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return [...rows, ...memQueue.values()];
  } catch (e) { return [...memQueue.values()]; }
}
async function qPut(item) {
  try {
    const d = await idb();
    await new Promise((res, rej) => {
      const t = d.transaction('items', 'readwrite');
      t.objectStore('items').put(item);
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
  } catch (e) { memQueue.set(item.key, item); }
}
async function qDel(key) {
  memQueue.delete(key);
  try {
    const d = await idb();
    await new Promise(res => { const t = d.transaction('items', 'readwrite'); t.objectStore('items').delete(key); t.oncomplete = res; t.onerror = res; });
  } catch (e) {}
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
const alreadyThere = err => /exists|duplicate/i.test(err?.message ?? '') || err?.statusCode === '409';
// Errors that will never succeed on retry (bad data, locked before kickoff stays retryable)
const permanent = err => err?.code && err.code.startsWith('23') && err.code !== '23505';

async function submitCompletion() {
  const taskId = state.active;
  const snap = taskId === SNAP;
  const task = snap ? null : taskById(taskId);
  const file = state.file;
  const stamp = Date.now();
  state.uploading = true;
  showLoading('Uploading...');

  try {
    const img = await compressImage(file);
    const item = {
      key: snap ? `${state.player.id}:snap:${stamp}` : `${state.player.id}:${taskId}`,
      kind: snap ? 'snap' : 'task',
      caption: snap ? $('snap-caption').value.trim().slice(0, 80) : null,
      player_id: state.player.id, player_name: state.player.name, task_id: snap ? null : taskId,
      // Raw bytes instead of Blob/File: Safari can refuse to store File objects in IndexedDB
      blob: await img.blob.arrayBuffer(), w: img.w, h: img.h,
      original: await file.arrayBuffer(), origType: file.type || 'image/jpeg', origExt: (file.name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg',
      stamp, stage: 'photo',
    };
    await qPut(item);
    if (!snap) state.pending.add(taskId);

    let synced = false;
    inFlight.add(item.key);
    try { synced = await sendPhoto(item, 25000); } catch (e) { console.warn('queued', e); }
    finally { inFlight.delete(item.key); }

    state.uploading = false;
    closeSheet();
    if (synced) {
      markSynced(item);
      if (snap) { showToast('Shared ✓'); buzz(20); fireworks(500); }
      else celebrate(task.points);
    } else {
      if (!snap) renderTasks();
      showToast('Saved. Uploads when you have signal.');
      buzz(20);
    }
    flushQueue(); // original upload (and anything else waiting) in the background
  } catch (err) {
    console.error(err);
    showToast('Could not read that photo. Try another one?');
  } finally {
    state.uploading = false;
    hideLoading();
  }
}

// Feed photo + DB row. Deterministic path so a retry after a half-finished attempt is safe.
async function sendPhoto(item, timeout = 30000) {
  if (!db || item.stage !== 'photo') return item.stage !== 'photo';
  const isSnap = item.kind === 'snap';
  const path = `${item.player_id}/${isSnap ? 'snap' : item.task_id}-${item.stamp}.jpg`;
  const { error: upErr } = await withTimeout(db.storage.from(BUCKET).upload(path, new Blob([item.blob], { type: 'image/jpeg' }), { contentType: 'image/jpeg' }), timeout);
  if (upErr && !alreadyThere(upErr)) throw upErr;
  const url = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  // Orga preview checks off through a password-guarded function, everyone else inserts directly
  // Random snaps go to their own table so they can never mix into the challenge feed
  const orga = state.orgaPw && !isLive();
  const base = { player_id: item.player_id, player_name: item.player_name, photo_url: url, photo_w: item.w, photo_h: item.h };
  const write = isSnap
    ? (orga
      ? db.rpc('orga_snap', { pw: state.orgaPw, p_player_id: item.player_id, p_player_name: item.player_name,
          p_caption: item.caption ?? '', p_photo_url: url, p_w: item.w, p_h: item.h })
      : db.from('snaps').insert({ ...base, caption: item.caption || null }))
    : (orga
      ? db.rpc('orga_complete', { pw: state.orgaPw, p_player_id: item.player_id, p_player_name: item.player_name,
          p_task_id: item.task_id, p_photo_url: url, p_w: item.w, p_h: item.h })
      : db.from('completions').insert({ ...base, task_id: item.task_id }));
  const { error } = await withTimeout(write, 15000);
  if (error && error.code !== '23505') throw error;
  item.stage = 'original';
  item.url = url;
  item.blob = null;
  await qPut(item);
  return true;
}

// Full-resolution copy for printing, private bucket (insert-only, not publicly readable)
async function sendOriginal(item) {
  if (item.original) {
    const path = `${item.player_id}/${item.kind === 'snap' ? 'snap' : item.task_id}-${item.stamp}.${item.origExt}`;
    const { error } = await withTimeout(db.storage.from(ORIGINALS_BUCKET).upload(path, new Blob([item.original], { type: item.origType }), { contentType: item.origType }), 180000);
    if (error && !alreadyThere(error)) throw error;
  }
  await qDel(item.key);
}

function markSynced(item) {
  if (item.kind === 'snap') { snapFeed.catchUp(); return; }
  if (item.player_id !== state.player?.id) return;
  state.pending.delete(item.task_id);
  state.done[item.task_id] = { photo_url: item.url };
  lsSet(LS_DONE, state.done);
  renderTasks();
  updateScore(true);
  refreshLeaderboard();
}

let flushing = false;
const inFlight = new Set(); // queue keys the sheet is sending right now; flushQueue must not send them twice
async function flushQueue() {
  if (!db || flushing) return;
  flushing = true;
  try {
    for (const item of await qAll()) {
      if (inFlight.has(item.key)) continue;
      try {
        if (item.stage === 'photo') {
          await sendPhoto(item);
          markSynced(item);
          if (item.kind === 'snap') showToast('Random photo shared ✓');
          const t = item.kind === 'snap' ? null : taskById(item.task_id);
          if (t) { showToast(`Synced ✓ +${t.points} point${t.points > 1 ? 's' : ''}`); buzz([30, 40, 60]); }
        }
        await sendOriginal(item);
      } catch (err) {
        if (permanent(err)) { await qDel(item.key); state.pending.delete(item.task_id); renderTasks(); }
        if (err?.message === 'timeout' || !navigator.onLine) break; // no signal: stop, try again later
      }
    }
  } finally {
    flushing = false;
  }
}

async function restorePending() {
  const mine = (await qAll()).filter(i => i.player_id === state.player.id && i.stage === 'photo' && i.kind !== 'snap');
  mine.forEach(i => state.pending.add(i.task_id));
  if (mine.length) renderTasks();
  flushQueue();
}

window.addEventListener('online', () => flushQueue());

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

// One-time big reveal of what the winner gets
function showPrize() {
  $('prize').classList.add('open');
  $('prize').setAttribute('aria-hidden', 'false');
  setTimeout(() => { buzz([40, 60, 40, 60, 120]); fireworks(3200); }, 500);
}

$('prize-close').addEventListener('click', () => {
  $('prize').classList.remove('open');
  $('prize').setAttribute('aria-hidden', 'true');
  lsSet('bt-prize-seen', true);
  buzz(10);
});

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
    confetti({ particleCount: 6, angle: 60,  spread: 60, origin: { x: 0, y: 0.7 }, colors, zIndex: 300 });
    confetti({ particleCount: 6, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors, zIndex: 300 });
    requestAnimationFrame(frame);
  })();
}

// ═══════════════════════════════════════════════
// LEADERBOARD
// ═══════════════════════════════════════════════

function scheduleLeaderboardRefresh() {
  clearTimeout(lbTimer);
  lbTimer = setTimeout(() => { refreshLeaderboard(); (displayFeed ?? phoneFeed).catchUp(); }, 800);
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
  renderLeaderboard(target, document.body.classList.contains('display-mode') ? data.slice(0, 15) : data);
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

const FEED_COLUMNS = 'id, player_name, task_id, photo_url, photo_w, photo_h, created_at';
const SNAP_COLUMNS = 'id, player_name, caption, photo_url, photo_w, photo_h, created_at';

function createFeed(list, { root = list, pill, countEl, table = 'completions', columns = FEED_COLUMNS, card = feedCard } = {}) {
  const feed = { started: false, cursor: null, newest: null, loading: false, finished: false, ids: new Set(), pending: [] };

  const sentinel = document.createElement('div');
  sentinel.className = 'feed-sentinel';

  const observer = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) loadPage();
  }, { root, rootMargin: '1200px 0px' });

  async function loadPage() {
    if (!db || feed.loading || feed.finished) return;
    feed.loading = true;
    let q = db.from(table)
      .select(columns)
      .order('created_at', { ascending: false })
      .limit(FEED_PAGE);
    if (feed.cursor) q = q.lt('created_at', feed.cursor);
    const { data, error } = await q;
    feed.loading = false;
    // Flaky network: the sentinel is already visible so the observer won't fire again, retry by hand
    if (error || !data) { setTimeout(loadPage, 4000); return; }

    showSkeleton(false);
    data.forEach(item => {
      if (feed.ids.has(item.id)) return;
      feed.ids.add(item.id);
      list.insertBefore(card(item), sentinel);
    });
    if (data.length) feed.cursor = data[data.length - 1].created_at;
    if (data.length && !document.body.classList.contains('display-mode')) loadComments(table, data.map(d => d.id));
    if (data.length && (!feed.newest || data[0].created_at > feed.newest)) feed.newest = data[0].created_at;
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
    const el = card(item);
    el.classList.add('incoming');
    const first = list.querySelector('.feed-card');
    list.insertBefore(el, first || sentinel);
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
      if (feed.ids.has(item.id) || feed.pending.some(p => p.id === item.id)) return true;
      if (!feed.newest || item.created_at > feed.newest) feed.newest = item.created_at;
      // Only add on top when the user is at the top, otherwise the scroll position would jump
      if (root.scrollTop < 40) { prepend(item); return true; }
      feed.pending.push(item);
      if (countEl) countEl.textContent = feed.pending.length;
      pill?.classList.add('show');
      return true;
    },
    // Realtime drops events under bursts, so this pulls everything newer than what we have
    async catchUp() {
      if (!db || !feed.started || feed.loading) return;
      if (!feed.newest && !feed.finished) return loadPage(); // first page never arrived
      this.prune();
      let q = db.from(table)
        .select(columns)
        .order('created_at', { ascending: true })
        .limit(50);
      if (feed.newest) q = q.gt('created_at', feed.newest);
      const { data } = await q;
      data?.forEach(item => this.onInsert(item));
    },
    // Deletes missed by realtime (locked phone, dropped socket) would otherwise stay up for hours
    async prune() {
      const shown = [...list.querySelectorAll('.feed-card[data-id]')].slice(0, 150).map(el => el.dataset.id);
      if (!shown.length) return;
      const { data, error } = await db.from(table).select('id').in('id', shown);
      if (error || !data) return;
      const alive = new Set(data.map(r => r.id));
      shown.filter(id => !alive.has(id)).forEach(id => this.onDelete(id));
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
      <div class="feed-who"><b>${safe(item.player_name)}</b><time data-t="${safe(item.created_at)}">${timeAgo(item.created_at)}</time></div>
      <div class="feed-task">${task ? `<span class="pts-badge sm">+${task.points}</span>` : ''}<span>${safe(task?.text ?? '')}</span></div>
    </div>`;
  const img = card.querySelector('img');
  const ready = () => img.classList.add('loaded');
  img.complete ? ready() : img.addEventListener('load', ready, { once: true });
  card.querySelector('.feed-photo').addEventListener('click', () => openLightbox(item.photo_url));
  attachComments(card, `completion:${item.id}`);
  return card;
}

function snapCard(item) {
  const card = document.createElement('article');
  card.className = 'feed-card snap-card';
  card.dataset.id = item.id;
  const ratio = item.photo_w && item.photo_h ? `${item.photo_w}/${item.photo_h}` : '4/5';
  card.innerHTML = `
    <div class="feed-photo" style="aspect-ratio:${ratio}">
      <img src="${safe(item.photo_url)}" alt="" loading="lazy" decoding="async">
    </div>
    <div class="feed-meta">
      <div class="feed-who"><b>${safe(item.player_name)}</b><time data-t="${safe(item.created_at)}">${timeAgo(item.created_at)}</time></div>
      ${item.caption ? `<div class="feed-task"><span>${safe(item.caption)}</span></div>` : ''}
    </div>`;
  const img = card.querySelector('img');
  const ready = () => img.classList.add('loaded');
  img.complete ? ready() : img.addEventListener('load', ready, { once: true });
  card.querySelector('.feed-photo').addEventListener('click', () => openLightbox(item.photo_url));
  attachComments(card, `snap:${item.id}`);
  return card;
}

// ═══════════════════════════════════════════════
// COMMENTS — under challenge photos and random snaps
// ═══════════════════════════════════════════════

const COMMENT_MAX = 140;
const COMMENT_COLUMNS = 'id, completion_id, snap_id, player_name, body, created_at';
const comments = new Map();   // "completion:<id>" | "snap:<id>" -> [comment], oldest first
const openThreads = new Set();
let newestComment = null;
const commentKey = c => c.snap_id ? `snap:${c.snap_id}` : `completion:${c.completion_id}`;

function addComment(c) {
  const key = commentKey(c);
  const list = comments.get(key) ?? [];
  if (!newestComment || c.created_at > newestComment) newestComment = c.created_at;
  if (list.some(x => x.id === c.id)) return;
  list.push(c);
  list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  comments.set(key, list);
  renderThread(key);
}

function removeComment(id) {
  for (const [key, list] of comments) {
    const i = list.findIndex(c => c.id === id);
    if (i < 0) continue;
    list.splice(i, 1);
    renderThread(key);
    return;
  }
}

// One query per feed page, not per card
async function loadComments(table, ids) {
  if (!db || !ids.length) return;
  const col = table === 'snaps' ? 'snap_id' : 'completion_id';
  const { data } = await db.from('comments').select(COMMENT_COLUMNS).in(col, ids).order('created_at').limit(1000);
  data?.forEach(addComment);
}

// Realtime can drop events, so the poll also pulls comments newer than the last one we saw
async function catchUpComments() {
  if (!db) return;
  // Without a baseline take the newest 200, never page through the whole history
  const q = newestComment
    ? db.from('comments').select(COMMENT_COLUMNS).gte('created_at', newestComment).order('created_at').limit(200)
    : db.from('comments').select(COMMENT_COLUMNS).order('created_at', { ascending: false }).limit(200);
  const { data } = await q;
  data?.forEach(addComment);
  const shown = [...document.querySelectorAll('.cmt-list li[data-cid]')].slice(0, 200).map(li => li.dataset.cid);
  if (!shown.length) return;
  const { data: alive } = await db.from('comments').select('id').in('id', shown);
  if (!alive) return;
  const ok = new Set(alive.map(r => r.id));
  shown.filter(id => !ok.has(id)).forEach(removeComment);
}

function attachComments(card, key) {
  if (document.body.classList.contains('display-mode')) return; // beamer stays photos only
  const box = document.createElement('div');
  box.className = 'cmts';
  box.dataset.key = key;
  box.innerHTML = `
    <ul class="cmt-list"></ul>
    <button class="cmt-toggle"></button>
    <form class="cmt-form">
      <input type="text" maxlength="${COMMENT_MAX}" placeholder="Add a comment..." enterkeyhint="send" autocomplete="off">
      <button type="submit" aria-label="Send">↑</button>
    </form>`;
  box.querySelector('.cmt-toggle').addEventListener('click', () => {
    openThreads.add(key);
    renderThread(key);
    box.querySelector('input').focus();
  });
  box.querySelector('.cmt-form').addEventListener('submit', e => { e.preventDefault(); sendComment(box); });
  box.querySelector('.cmt-list').addEventListener('click', e => {
    const del = e.target.closest('.cmt-del');
    if (del) deleteComment(del.dataset.id);
  });
  card.appendChild(box);
  renderThread(key, box);
}

function renderThread(key, only) {
  const boxes = only ? [only] : document.querySelectorAll(`.cmts[data-key="${key}"]`);
  const list = comments.get(key) ?? [];
  const open = openThreads.has(key);
  const shown = open ? list : list.slice(-2);
  boxes.forEach(box => {
    box.classList.toggle('open', open);
    box.querySelector('.cmt-list').innerHTML = shown.map(c => `
      <li data-cid="${c.id}"><b>${safe(c.player_name)}</b> <span>${safe(c.body)}</span>
        <time data-t="${safe(c.created_at)}">${timeAgo(c.created_at)}</time>${state.orgaPw ? `<button class="cmt-del" data-id="${c.id}" aria-label="Delete">🗑</button>` : ''}</li>`).join('');
    box.querySelector('.cmt-toggle').textContent = list.length > shown.length ? `View all ${list.length} comments` : '💬 Add a comment';
  });
}

async function sendComment(box) {
  const input = box.querySelector('input');
  const body = input.value.trim().slice(0, COMMENT_MAX);
  if (!body || !db || !state.player || box.classList.contains('sending')) return;
  const [kind, id] = box.dataset.key.split(':');
  const target = { completion_id: kind === 'completion' ? id : null, snap_id: kind === 'snap' ? id : null };
  box.classList.add('sending');
  const orga = state.orgaPw && !isLive();
  const { data, error } = await withTimeout(orga
    ? db.rpc('orga_comment', { pw: state.orgaPw, p_player_id: state.player.id, p_player_name: state.player.name,
        p_completion_id: target.completion_id, p_snap_id: target.snap_id, p_body: body })
    : db.from('comments').insert({ ...target, player_id: state.player.id, player_name: state.player.name, body })
        .select(COMMENT_COLUMNS).single(), 15000).catch(err => ({ error: err }));
  box.classList.remove('sending');
  // Text stays in the field on failure so nothing typed gets lost
  if (error || !data) { showToast(error?.code === '23503' ? 'That post was deleted' : 'Could not send, try again'); buzz(60); return; }
  input.value = '';
  addComment(data);
  buzz(10);
}

async function deleteComment(id) {
  if (!state.orgaPw) return;
  const { error } = await db.rpc('orga_delete_comment', { pw: state.orgaPw, p_id: id });
  if (error) { showToast('Could not delete'); return; }
  removeComment(id);
}

const phoneFeed = createFeed($('feed-list'), { root: $('view-feed'), pill: $('new-pill'), countEl: $('new-count') });
const snapFeed = createFeed($('snap-list'), { root: $('view-feed'), pill: $('snap-pill'), countEl: $('snap-count'),
  table: 'snaps', columns: SNAP_COLUMNS, card: snapCard });
let feedMode = 'challenges';

function setFeedMode(mode) {
  feedMode = mode;
  document.querySelectorAll('.feed-switch button').forEach(b => b.classList.toggle('active', b.dataset.f === mode));
  $('feed-list').hidden = mode !== 'challenges';
  $('new-pill').hidden = mode !== 'challenges';
  $('snap-list').hidden = mode !== 'random';
  $('snap-pill').hidden = mode !== 'random';
  (mode === 'random' ? snapFeed : phoneFeed).start();
  $('view-feed').scrollTo({ top: 0 });
}
document.querySelectorAll('.feed-switch button').forEach(b => b.addEventListener('click', () => { setFeedMode(b.dataset.f); buzz(8); }));
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
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'snaps' }, ({ new: item }) => {
      if (displayFeed) return; // beamer shows challenges only
      const shown = snapFeed.onInsert(item);
      if (!shown || !$('view-feed').classList.contains('active') || feedMode !== 'random') $('feed-dot').classList.add('on');
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'snaps' }, ({ old }) => snapFeed.onDelete(old.id))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, ({ new: c }) => { if (!displayFeed) addComment(c); })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'comments' }, ({ old }) => removeComment(old.id))
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
  // Before kickoff (or while tasks are still locked) show a countdown, then reload once tasks unlock
  if (!isLive() || !state.tasks.length) {
    document.body.classList.add('display-waiting');
    const c = state.countdown;
    $('display-wait-sub').textContent = `${c.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ })} · ${fmtTime(c)}`;
    let n = 0, busy = false;
    const tick = async () => {
      const ms = state.countdown.getTime() - Date.now();
      if (ms > 0) {
        const sec = Math.floor(ms / 1000);
        const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s2 = sec % 60;
        $('display-countdown').textContent = `${h}:${String(m).padStart(2, '0')}:${String(s2).padStart(2, '0')}`;
      } else if (!isLive()) {
        $('display-countdown').textContent = 'Any second now 🔒';
      }
      // Poll for the orga's unlock every few seconds, then reload into the live board
      if (busy || n++ % (UNLOCK_POLL_MS / 1000)) return;
      busy = true;
      await withTimeout(loadConfig(), 5000).catch(() => {});
      if (isLive()) {
        $('display-countdown').textContent = "It's on.";
        await loadTasks().catch(() => {});
        if (state.tasks.length) location.reload();
      }
      busy = false;
    };
    tick();
    setInterval(tick, 1000);
    return;
  }
  displayFeed = createFeed($('display-feed'));
  displayFeed.start();
  refreshLeaderboard();
  subscribe();
  setInterval(() => { refreshLeaderboard(); displayFeed.catchUp(); }, LB_POLL_MS);
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

// "just now" must not stick for hours on the beamer
const refreshTimes = () => document.querySelectorAll('time[data-t]').forEach(t => { t.textContent = timeAgo(t.dataset.t); });
setInterval(() => { if (document.visibilityState === 'visible') refreshTimes(); }, 60000);

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (Number.isNaN(s)) return '';
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
// STARTUP LOGO MARQUEE
// ═══════════════════════════════════════════════

// Heights are tuned per logo so they look optically the same size
const STARTUPS = [
  ['speedinvest.svg', 'Speedinvest', 19], ['telli.svg', 'telli', 23], ['reonic.svg', 'Reonic', 22],
  ['knowunity.png', 'Knowunity', 24], ['planet-a.svg', 'Planet A', 24], ['iceye.png', 'ICEYE', 17],
  ['liveeo.svg', 'LiveEO', 22], ['reflex.png?v=2', 'Reflex Aerospace', 28], ['lucid.png', 'Lucid', 26],
  [null, 'Zauber'],
];

function renderMarquees() {
  const items = STARTUPS.map(([file, name, h]) => file
    ? `<img src="logos/${file}" alt="${name}" style="height:${h}px" decoding="async">`
    : `<span class="logo-word">—✧ ${name}</span>`).join('');
  // Two identical halves → translateX(-50%) loops seamlessly
  document.querySelectorAll('.marquee-track').forEach(t => { t.innerHTML = `<span>${items}</span><span>${items}</span>`; });
}
renderMarquees();

// ═══════════════════════════════════════════════
// INSTALL AS APP (home screen, standalone, no browser bars)
// ═══════════════════════════════════════════════

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installPrompt = null;

function showInstallHint() {
  if (isStandalone() || lsGet('bt-install-dismissed', false) || document.body.classList.contains('display-mode')) return;
  if (!isIOS && !installPrompt) return; // Android/Chrome: only once the browser offers installing
  $('install-btn').hidden = !installPrompt;
  if (installPrompt) $('install-text').innerHTML = 'Get the app on your home screen';
  $('install-hint').hidden = false;
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  showInstallHint();
});
$('install-btn').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('install-hint').hidden = true;
});
$('install-close').addEventListener('click', () => {
  $('install-hint').hidden = true;
  lsSet('bt-install-dismissed', true);
});
setTimeout(showInstallHint, 2500);

// ═══════════════════════════════════════════════
// GO
// ═══════════════════════════════════════════════

init();
