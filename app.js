// ═══════════════════════════════════════════════
// BINGO FIELDS -25 per generation
// ═══════════════════════════════════════════════

const FIELDS = {
  G45: [
    'Has bought a domain for an idea that never launched',
    'Has bought more than 3 domains for ideas that never launched',
    'Has a notes app full of unfinished startup ideas',
    'Has watched a startup documentary past midnight',
    'Has no idea what they want to build yet',
    'Has described M&M as "it changed my life" within the first week',
    'Has said "let\'s align" in the last 24 hours',
    'Has Notion, Obsidian AND a notebook -uses none of them',
    'Has Googled a term their mentor used and nodded along',
    'Has "Entrepreneur" on LinkedIn before having a product',
    'Has rewritten their M&M application at least twice',
    'Has a pitch deck with no product behind it',
    'Has a side project that\'s been "almost ready" for months',
    'Has "Founder" in their Tinder or Bumble profile',
    'Has already mentioned "high agency" this evening',
    'Has DMed a stranger on LinkedIn for "a quick coffee"',
    'Has said "we\'re pre-revenue" to sound intentional',
    'Has a group chat with future co-founders that\'s gone quiet',
    'Has attended a hackathon but never shipped the project',
    'Has described a coffee chat as "a meeting"',
    'Has used "pivot" in a sentence this month',
    'Has a newsletter or Substack draft never published',
    'Has told someone they\'re "building something in stealth"',
    '🤝 CROSS-GEN: Find an Alumni -ask their biggest mistake. Foto together.',
    '🤝 CROSS-GEN: Find a G42-44 -ask what they wish they knew. Foto together.',
  ],

  Active: [
    'Has convinced someone to apply to M&M who got rejected',
    'Has pitched Manage and More on a first date',
    'Has survived the Business Design Bootcamp',
    'Has cold-emailed a CEO and actually got a reply',
    'Has built something nobody used',
    'Has "Founder" in their Tinder or Bumble profile',
    'Has already mentioned "high agency" this evening',
    'Has a YC rejection email saved somewhere',
    'Has pitched at Start and Spread',
    'Has more laptop stickers than revenue',
    'Has used "founder mode" unironically this month',
    'Has said "we\'re early stage" to avoid hard questions',
    'Has a domain that\'s been parked for over a year',
    'Has a newsletter with fewer than 20 subscribers',
    'Has introduced themselves by their company name first',
    'Has taken a business call during a date and thought it was fine',
    'Has said "let\'s take this offline" in the last week',
    'Has used startup jargon in an argument with someone close',
    'Has applied to more than one accelerator',
    'Has a podcast that stopped after 4 episodes',
    'Has described M&M as "it changed my life" to a stranger',
    'Has said "let\'s align" in the last 24 hours',
    'Has bought more than 3 domains for ideas that never launched',
    '🤝 CROSS-GEN: Find a G45 -give them your best advice. Foto together.',
    '🤝 CROSS-GEN: Find an Alumni -ask how they got their first customer. Foto together.',
  ],

  Alumni: [
    'Has cried in a pitch meeting',
    'Has convinced a stranger to invest within 10 minutes',
    'Has been on a date that turned into a business meeting',
    'Has pretended to understand a term sheet',
    'Has run out of runway with no backup plan',
    'Has lost a co-founder mid-launch',
    'Has incorporated a company before having a single user',
    'Has applied to YC with an idea that no longer exists',
    'Has read every Paul Graham essay at least once',
    'Has ended a friendship because of an equity dispute',
    'Has convinced someone to apply to M&M who got rejected',
    'Has described M&M as "it changed my life" -and still means it',
    'Has had a startup post-mortem longer than the startup itself',
    'Has more than 3 domains for dead companies',
    'Has a slide deck from a company that no longer exists',
    'Has raised a friends & family round from actual friends and family',
    'Has written a "lessons learned" post after shutting down',
    'Has hired someone better than them at their own job',
    'Has lost a pitch competition to an idea they thought was worse',
    'Has a cap table that required a lawyer to explain',
    'Has described their first product as "an MVP" in retrospect',
    'Has said "if I\'d known then what I know now" this year',
    'Has a YC rejection email saved and occasionally re-reads it',
    '🤝 CROSS-GEN: Find a G45 -tell them what you wish you knew. Foto together.',
    '🤝 CROSS-GEN: Find a G42-44 -share your worst pivot story. Foto together.',
  ],
};

const GEN_LABELS = {
  G45:    'Gen 45 - Newest',
  Active: 'Gen 42-44 - Active',
  Alumni: 'Alumni - G41+',
};

// ═══════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════

let db = null;
let feedChannel = null;
let lbDebounceTimer = null;
let modalOpen = false; // Fix 3: debounce double-tap

// Fix 1+2: safe localStorage helpers
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) {}
}
function lsGet(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch(e) { return fallback; }
}

const state = {
  player: null,   // { name, generation }
  fields: [],     // ordered array of field strings for this player
  completed: new Set(), // Set of indices (0–24) that are done
  uploading: false,
};

// ═══════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════

function init() {
  // Supabase -only if credentials are provided
  if (typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL && SUPABASE_URL !== 'YOUR_SUPABASE_URL') {
    db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  // Beamer/TV display mode: ?display=true
  if (new URLSearchParams(window.location.search).get('display') === 'true') {
    document.body.classList.add('display-mode');
    showScreen('display');
    loadDisplayFeed();
    return;
  }

  // Restore session from localStorage (Fix 1+2: safe helpers)
  const savedPlayer = lsGet('mm-player', null);
  const savedFields = lsGet('mm-fields', null);
  const savedCompleted = lsGet('mm-completed', []);

  if (savedPlayer && savedFields) {
    state.player    = savedPlayer;
    state.fields    = savedFields;
    state.completed = new Set(savedCompleted);
    showScreen('card');
    renderCard();
  } else {
    showScreen('entry');
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' &&
        document.getElementById('screen-feed').classList.contains('active')) {
      subscribeFeed();
    }
  });
}

// ═══════════════════════════════════════════════
// DISPLAY MODE (Beamer/TV)
// ═══════════════════════════════════════════════

// Fullscreen -registered at top level so it's always a direct user-event handler
const fsBtn = document.getElementById('fullscreen-btn');
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
  fsBtn.textContent = document.fullscreenElement ? '✕ Fullscreen' : '⛶ Fullscreen';
});

async function loadDisplayFeed() {
  if (!db) {
    document.getElementById('display-list').innerHTML = '<div class="display-empty">Supabase not configured</div>';
    return;
  }

  const { data } = await db
    .from('completions')
    .select('*')
    .not('photo_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(6);

  renderDisplayFeed(data || []);

  // Leaderboard for display
  await loadDisplayLeaderboard();

  // Use shared feed channel (subscribeFeed handles real-time for both)
  if (!feedChannel) subscribeFeed();
}

async function loadDisplayLeaderboard() {
  const el = document.getElementById('display-lb');
  if (!el) return;
  await loadLeaderboard(el);
}

function renderDisplayFeed(items) {
  const list = document.getElementById('display-list');
  list.innerHTML = items.length === 0
    ? '<div class="display-empty">No photos yet. Let\'s go! 🎯</div>'
    : '';
  items.forEach(item => list.appendChild(displayItem(item)));
}

function displayItem(item) {
  const div = document.createElement('div');
  div.className = 'display-item';
  const isCross = item.field_text?.startsWith('🤝');
  const fieldTxt = item.field_text?.replace('🤝 CROSS-GEN: ', '🤝 ') ?? '';
  div.innerHTML = `
    ${item.photo_url ? `<img class="display-photo" src="${safe(item.photo_url)}" loading="lazy">` : ''}
    <div class="display-info">
      <div class="display-name">${safe(item.player_name)}</div>
      <div class="display-gen">${safe(GEN_LABELS[item.generation] ?? item.generation)}</div>
      <div class="display-field ${isCross ? 'is-cross-gen' : ''}">${safe(fieldTxt)}</div>
    </div>`;
  return div;
}

// ═══════════════════════════════════════════════
// SCREEN ROUTING
// ═══════════════════════════════════════════════

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
}

// ═══════════════════════════════════════════════
// ENTRY SCREEN
// ═══════════════════════════════════════════════

let selectedGen = null;

document.querySelectorAll('.gen-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.gen-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedGen = btn.dataset.gen;
    syncStartBtn();
  });
});

document.getElementById('name-input').addEventListener('input', syncStartBtn);

function syncStartBtn() {
  const name = document.getElementById('name-input').value.trim();
  document.getElementById('start-btn').disabled = !(name && selectedGen);
}

document.getElementById('start-btn').addEventListener('click', () => {
  const name = document.getElementById('name-input').value.trim();
  if (!name || !selectedGen) return;

  state.player    = { name, generation: selectedGen };
  state.fields    = shuffle([...FIELDS[selectedGen]]);
  state.completed = new Set();

  lsSet('mm-player', state.player);
  lsSet('mm-fields', state.fields);
  lsSet('mm-completed', []);

  showScreen('card');
  renderCard();
});

// ═══════════════════════════════════════════════
// BINGO CARD
// ═══════════════════════════════════════════════

function renderCard() {
  document.getElementById('player-display-name').textContent = state.player.name;
  document.getElementById('player-display-gen').textContent  = GEN_LABELS[state.player.generation];
  updateProgress();

  const grid = document.getElementById('bingo-grid');
  grid.innerHTML = '';

  state.fields.forEach((field, i) => {
    const cell = document.createElement('div');
    cell.className  = 'bingo-cell';
    cell.dataset.i  = i;

    const isCross = field.startsWith('🤝');
    if (isCross) cell.classList.add('cross-gen');

    if (state.completed.has(i)) {
      cell.classList.add('completed');
      cell.textContent = '✓';
    } else {
      const inner = document.createElement('span');
      inner.className = 'bingo-cell-inner';
      inner.textContent = cellAbbrev(field);
      cell.appendChild(inner);
    }

    cell.addEventListener('click', () => openModal(i));
    grid.appendChild(cell);
  });
}

function updateProgress() {
  document.getElementById('progress-count').textContent = state.completed.size;
}

document.getElementById('reset-btn').addEventListener('click', () => {
  if (!confirm('Reset? Your progress will be deleted.')) return;
  localStorage.clear();
  location.reload();
});

// ═══════════════════════════════════════════════
// PHOTO MODAL
// ═══════════════════════════════════════════════

let activeFieldIndex = null;
let chosenFile       = null;

function openModal(index) {
  if (state.completed.has(index)) { showToast('Already checked off ✓'); return; }
  if (modalOpen) return; // Fix 3: debounce
  modalOpen = true;

  activeFieldIndex = index;
  chosenFile       = null;

  const field   = state.fields[index];
  const isCross = field.startsWith('🤝');

  const el = document.getElementById('modal-field-text');
  el.textContent = field;
  el.className   = 'modal-field-text' + (isCross ? ' is-cross-gen' : '');

  document.getElementById('photo-preview').classList.remove('visible');
  document.getElementById('photo-preview').src = '';
  document.getElementById('upload-btn').disabled = true;
  document.getElementById('photo-input').value   = '';

  document.getElementById('modal-photo').classList.add('active');
}

function closeModal() {
  document.getElementById('modal-photo').classList.remove('active');
  activeFieldIndex = null;
  chosenFile       = null;
  modalOpen = false; // Fix 3: reset debounce
}

document.getElementById('take-photo-btn').addEventListener('click', () => {
  document.getElementById('photo-input').click();
});

document.getElementById('photo-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  chosenFile = file;

  const reader = new FileReader();
  reader.onload = ev => {
    const preview = document.getElementById('photo-preview');
    preview.src = ev.target.result;
    preview.classList.add('visible');
    document.getElementById('upload-btn').disabled = false;
  };
  reader.readAsDataURL(file);
});

document.getElementById('upload-btn').addEventListener('click', async () => {
  const btn = document.getElementById('upload-btn');
  if (!chosenFile || state.uploading) return;
  btn.disabled = true;
  await submitCompletion();
  btn.disabled = false;
});

document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
document.getElementById('modal-backdrop').addEventListener('click', closeModal);

async function submitCompletion() {
  state.uploading = true;
  showLoading('Uploading...');

  const onUnload = e => { e.preventDefault(); e.returnValue = ''; };
  window.addEventListener('beforeunload', onUnload);

  try {
    const photoUrl = db ? await uploadWithRetry(chosenFile) : null;

    await db.from('completions').insert({
      player_name: state.player.name,
      generation:  state.player.generation,
      field_text:  state.fields[activeFieldIndex],
      photo_url:   photoUrl,
    }).throwOnError();

    markCompleted(activeFieldIndex);
    closeModal();
    showToast('Checked off! 🎉');

  } catch (err) {
    console.error(err);
    showToast('Upload failed. Try again?');
  } finally {
    state.uploading = false;
    hideLoading();
    window.removeEventListener('beforeunload', onUnload);
  }
}

async function uploadWithRetry(file, attempts = 3) {
  const compressed = await compressImage(file);
  const fileName   = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

  for (let i = 0; i < attempts; i++) {
    const { error } = await db.storage
      .from('bingo photos')
      .upload(fileName, compressed, { contentType: 'image/jpeg' });

    if (!error) break;
    if (i === attempts - 1) throw error;
    await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    showLoading(`Retrying... (${i + 2}/${attempts})`);
  }

  return db.storage.from('bingo photos').getPublicUrl(fileName).data.publicUrl;
}

// Fix 6: compress image to max 1200px, JPEG 0.8
function compressImage(file) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1200;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
        else { width = Math.round(width * MAX / height); height = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => resolve(blob || file), 'image/jpeg', 0.8);
    };
    img.onerror = () => resolve(file); // fallback: use original
    img.src = url;
  });
}

function markCompleted(index) {
  state.completed.add(index);
  lsSet('mm-completed', [...state.completed]);

  const cell = document.querySelector(`.bingo-cell[data-i="${index}"]`);
  if (cell) {
    cell.classList.add('completed');
    cell.textContent = '✓';
  }

  updateProgress();
  checkBingo();
}

// ═══════════════════════════════════════════════
// BINGO DETECTION
// ═══════════════════════════════════════════════

function checkBingo() {
  const c = state.completed;

  const lines = [
    [0,1,2,3,4], [5,6,7,8,9], [10,11,12,13,14], [15,16,17,18,19], [20,21,22,23,24],
    [0,5,10,15,20], [1,6,11,16,21], [2,7,12,17,22], [3,8,13,18,23], [4,9,14,19,24],
    [0,6,12,18,24], [4,8,12,16,20],
  ];

  // Win = beide Cross-Gen Felder abgehakt + mind. 2 volle Reihen/Spalten/Diagonalen
  const crossGenIndices = state.fields
    .map((f, i) => f.startsWith('🤝') ? i : -1)
    .filter(i => i !== -1);
  const hasBothCrossGen = crossGenIndices.every(i => c.has(i));

  const completedLines = lines.filter(line => line.every(i => c.has(i)));
  const hasTwoLines = completedLines.length >= 2;

  if (!hasBothCrossGen || !hasTwoLines) return;

  // Flash alle gewonnenen Reihen
  completedLines.flat().forEach(i => {
    document.querySelector(`.bingo-cell[data-i="${i}"]`)?.classList.add('bingo-flash');
  });

  setTimeout(() => {
    showScreen('win');
    document.getElementById('win-player-name').textContent = state.player.name;
    fireworks();
  }, 900);
}

function fireworks() {
  if (typeof confetti === 'undefined') return;
  const end = Date.now() + 3500;
  const colors = ['#0ABDE3', '#ffffff', '#1B1F3B'];
  (function frame() {
    if (Date.now() > end) return;
    confetti({ particleCount: 40, spread: 70, origin: { y: 0.6 }, colors });
    confetti({ particleCount: 20, spread: 120, origin: { x: 0.1, y: 0.5 }, colors });
    confetti({ particleCount: 20, spread: 120, origin: { x: 0.9, y: 0.5 }, colors });
    requestAnimationFrame(frame);
  })();
}

// ═══════════════════════════════════════════════
// LIVE FEED
// ═══════════════════════════════════════════════

document.getElementById('feed-btn').addEventListener('click', () => {
  showScreen('feed');
  loadFeed();
  if (db && !feedChannel) subscribeFeed();
});

document.getElementById('back-to-card-btn').addEventListener('click', () => showScreen('card'));

// ═══════════════════════════════════════════════
// LEADERBOARD
// ═══════════════════════════════════════════════

document.getElementById('lb-btn').addEventListener('click', () => {
  showScreen('leaderboard');
  loadLeaderboard();
  if (db && !feedChannel) subscribeFeed(); // reuse feed subscription for realtime triggers
});

document.getElementById('back-from-lb-btn').addEventListener('click', () => showScreen('card'));

function scheduleLeaderboardRefresh() {
  clearTimeout(lbDebounceTimer);
  lbDebounceTimer = setTimeout(() => {
    if (document.getElementById('screen-leaderboard').classList.contains('active')) {
      loadLeaderboard();
    }
    if (document.getElementById('screen-display').classList.contains('active')) {
      loadDisplayLeaderboard();
    }
  }, 3000);
}

async function loadLeaderboard(targetEl = document.getElementById('lb-list')) {
  if (!db) {
    targetEl.innerHTML = '<div class="lb-empty">Supabase not connected</div>';
    return;
  }

  const { data, error } = await db
    .from('completions')
    .select('player_name, generation');

  if (error || !data) { targetEl.innerHTML = '<div class="lb-empty">Could not load</div>'; return; }
  if (data.length === 0) { targetEl.innerHTML = '<div class="lb-empty">Nobody here yet. Take the first photo! 📸</div>'; return; }

  // Aggregate client-side (avoids need for DB functions)
  const counts = {};
  data.forEach(({ player_name, generation }) => {
    const key = player_name;
    if (!counts[key]) counts[key] = { player_name, generation, count: 0 };
    counts[key].count++;
  });

  const ranked = Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 20);
  const medals = ['🥇', '🥈', '🥉'];

  targetEl.innerHTML = '';
  ranked.forEach((entry, i) => {
    const div = document.createElement('div');
    div.className = 'lb-entry';
    div.innerHTML = `
      <span class="lb-rank">${medals[i] ?? `#${i + 1}`}</span>
      <div class="lb-info">
        <span class="lb-name">${safe(entry.player_name)}</span>
        <span class="lb-gen">${safe(GEN_LABELS[entry.generation] ?? entry.generation)}</span>
      </div>
      <span class="lb-count">${entry.count}<span class="lb-total">/25</span></span>`;
    targetEl.appendChild(div);
  });
}

async function loadFeed() {
  const list = document.getElementById('feed-list');
  list.innerHTML = '<div class="feed-empty"><div class="feed-empty-icon">⏳</div><div>Loading...</div></div>';

  if (!db) {
    list.innerHTML = '<div class="feed-empty"><div class="feed-empty-icon">📡</div><div>Supabase not configured.<br>Photos saved locally only.</div></div>';
    return;
  }

  const { data, error } = await db
    .from('completions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(60);

  if (error || !data) {
    list.innerHTML = '<div class="feed-empty"><div class="feed-empty-icon">⚠️</div><div>Could not load feed.</div></div>';
    return;
  }

  if (data.length === 0) {
    list.innerHTML = '<div class="feed-empty"><div class="feed-empty-icon">📸</div><div>No photos yet. Be the first!</div></div>';
    return;
  }

  list.innerHTML = '';
  data.forEach(item => list.appendChild(feedItem(item)));
}

function feedItem(item) {
  const div      = document.createElement('div');
  div.className  = 'feed-item';
  const isCross  = item.field_text?.startsWith('🤝');
  const fieldTxt = item.field_text?.replace('🤝 CROSS-GEN: ', '🤝 ') ?? '';

  div.innerHTML = `
    ${item.photo_url ? `<div class="feed-item-photo-wrap"><img class="feed-item-photo" src="${safe(item.photo_url)}" loading="lazy"></div>` : ''}
    <div class="feed-item-info">
      <div class="feed-item-top">
        <span class="feed-item-name">${safe(item.player_name)}</span>
        <span class="feed-item-gen">${safe(GEN_LABELS[item.generation] ?? item.generation)}</span>
      </div>
      <div class="feed-item-field ${isCross ? 'is-cross-gen' : ''}">${safe(fieldTxt)}</div>
      <div class="feed-item-time">${timeAgo(item.created_at)}</div>
    </div>`;

  if (item.photo_url) {
    div.querySelector('.feed-item-photo-wrap').addEventListener('click', () => openLb(item.photo_url));
  }

  return div;
}

function subscribeFeed() {
  if (feedChannel) {
    feedChannel.unsubscribe();
    feedChannel = null;
  }
  feedChannel = db.channel('feed')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'completions' }, payload => {
      // Update feed list
      const list  = document.getElementById('feed-list');
      const empty = list.querySelector('.feed-empty');
      if (empty) empty.remove();
      list.insertBefore(feedItem(payload.new), list.firstChild);

      // Update display feed (only items with photos)
      const dList = document.getElementById('display-list');
      if (dList && payload.new.photo_url) {
        const de = dList.querySelector('.display-empty');
        if (de) de.remove();
        dList.insertBefore(displayItem(payload.new), dList.firstChild);
        while (dList.children.length > 6) dList.lastChild.remove();
      }

      // Debounced leaderboard refresh
      scheduleLeaderboardRefresh();
    })
    .subscribe();
}

// ═══════════════════════════════════════════════
// WIN SCREEN
// ═══════════════════════════════════════════════

document.getElementById('win-feed-btn').addEventListener('click', () => {
  showScreen('feed');
  loadFeed();
  if (db && !feedChannel) subscribeFeed();
});

document.getElementById('win-card-btn').addEventListener('click', () => showScreen('card'));

// ═══════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════

function cellAbbrev(field) {
  if (field.startsWith('🤝')) {
    // Cross-gen: just show who to find
    // "🤝 CROSS-GEN: Find an Alumni -ask..." → "🤝\nAlumni"
    const who = field.includes('Alumni') ? 'Alumni' : field.includes('G45') ? 'G45' : 'G42-44';
    return '🤝\n' + who;
  }
  // Strip "Has " and take first 3–4 meaningful words
  const clean = field.replace(/^Has /, '');
  const words = clean.split(' ');
  // Take up to 4 words, break naturally
  return words.slice(0, 4).join(' ') + (words.length > 4 ? '…' : '');
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function safe(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60)   return 'Just now';
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

function showLoading(msg = 'Lädt...') {
  document.getElementById('loading-text').textContent = msg;
  document.getElementById('loading-overlay').classList.add('active');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('active');
}

let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('visible'), 3000);
}

// ═══════════════════════════════════════════════
// LIGHTBOX
// ═══════════════════════════════════════════════

function openLb(url) {
  document.getElementById('lightbox-img').src = url;
  document.getElementById('lightbox').classList.add('open');
}
function closeLb() {
  document.getElementById('lightbox').classList.remove('open');
}
document.getElementById('lightbox').addEventListener('click', closeLb);

// ═══════════════════════════════════════════════
// GO
// ═══════════════════════════════════════════════

init();
