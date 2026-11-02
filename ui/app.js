/* Transfer UI v0.3: folders as first-class pages, per-folder modes and lines,
   light/dark, liquid motion. Talks to the Rust engine through Tauri; in a plain
   browser it runs on demo data so the design can be tried as-is. */

/* ---------- icons + lines ---------- */
const P = {
  shortcuts: 'M7 17L17 7M9 7h8v8', installers: 'M12 3v12M8 11l4 4 4-4M5 20h14',
  videos: 'M4 6h11a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2zM17 10l5-3v10l-5-3',
  images: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9h.01',
  audio: 'M9 18V6l11-2v12M9 18a3 3 0 11-6 0 3 3 0 016 0zM20 16a3 3 0 11-6 0 3 3 0 016 0z',
  docs: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5M9 13h6M9 17h4',
  archives: 'M3 4h18v4H3zM5 8v11a1 1 0 001 1h12a1 1 0 001-1V8M10 12h4',
  code: 'M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14',
  holding: 'M9.5 9a2.5 2.5 0 115 .5c0 1.5-2.5 2-2.5 3.5M12 17h.01',
  home: 'M3 11l9-7 9 7M5 10v10h14V10', review: 'M4 13l2-8h12l2 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5',
  history: 'M12 7v5l3 2M21 12a9 9 0 11-9-9 9 9 0 019 9z', settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4', lock: 'M5 11h14v10H5zM8 11V7a4 4 0 018 0v4',
  chevR: 'M9 6l6 6-6 6', chevD: 'M6 9l6 6 6-6', plus: 'M12 5v14M5 12h14', folder: 'M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  check: 'M5 12l5 5 9-10', sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  open: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5', reveal: 'M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2zM12 11v5M9.5 13.5L12 16l2.5-2.5',
  copy: 'M9 9h10v11H9zM5 15V4h10', undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3', dupes: 'M8 8h11v12H8zM5 16V4h11',
};
const LINES = [
  { id: 'shortcuts', name: 'Shortcuts', c: '#5aa9ff', d: '#0060df' },
  { id: 'installers', name: 'Installers', c: '#ff7a70', d: '#d70015' },
  { id: 'videos', name: 'Videos', c: '#ffb340', d: '#c25e00' },
  { id: 'images', name: 'Images', c: '#ffd84d', d: '#9a7400' },
  { id: 'audio', name: 'Audio', c: '#d394ff', d: '#8e2bc9' },
  { id: 'docs', name: 'Docs', c: '#5be37d', d: '#1b8a3c' },
  { id: 'archives', name: 'Archives', c: '#d9bd94', d: '#7f5e33' },
  { id: 'code', name: 'Code', c: '#7ee0ff', d: '#007a9e' },
];
const HOLD = { id: 'holding', name: 'Review', c: '#c7c7cc', d: '#5a5a66' };
const L = id => LINES.find(l => l.id === id) || HOLD;
const FCOLORS = ['#0a84ff', '#bf5af2', '#30c4a8', '#ff9f0a', '#ff375f', '#64d2ff'];
const MODES = [['auto', 'Auto'], ['ask', 'Ask first'], ['off', 'Off']];
/* a folder on an unplugged drive or share stays in settings, marked offline */
const modeName = s => s.online === false ? 'Offline' : MODES.find(m => m[0] === s.mode)[1];

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svg = (d, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const lineVars = id => `--lc:${L(id).c};--ld:${L(id).d}`;
const icon = (id, cls = '') => `<span class="ic ${cls}" style="${lineVars(id)}">${svg(P[id] || P.holding)}</span>`;
const parts = p => p.split(/[\\/]/);
const base = p => parts(p).filter(Boolean).pop();
const size = n => n < 1e3 ? n + ' B' : n < 1e6 ? Math.round(n / 1e3) + ' KB' : n < 1e9 ? (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + ' MB' : (n / 1e9).toFixed(1) + ' GB';
const ago = ts => { const s = Math.max(0, Date.now() / 1e3 - ts); return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd'; };
const norm = p => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const within = (file, folder) => norm(file).startsWith(norm(folder) + '/');

/* ---------- bridge ---------- */
const T = window.__TAURI__;
const OS = /Windows/i.test(navigator.userAgent) ? 'win' : /Mac/i.test(navigator.userAgent) ? 'mac' : 'linux';
if (OS === 'win') document.documentElement.classList.add('os-win');
/* the OS's own words for its trash and file manager */
const BIN = OS === 'win' ? 'Recycle Bin' : 'Trash';
const FILES = OS === 'win' ? 'File Explorer' : OS === 'mac' ? 'Finder' : 'Files';
if (T) document.documentElement.classList.add('native'), document.body.classList.add('native');
const api = T ? {
  state: () => T.core.invoke('get_state').then(JSON.parse),
  plan: source => T.core.invoke('plan', { source }).then(JSON.parse),
  apply: source => T.core.invoke('apply', { source }).then(JSON.parse),
  undo: id => T.core.invoke('undo', { id }).then(JSON.parse),
  correct: (id, line) => T.core.invoke('correct', { id, line }).then(JSON.parse),
  route: (path, line) => T.core.invoke('route', { path, line }).then(JSON.parse),
  trash: paths => T.core.invoke('trash', { paths }),
  saveSettings: s => T.core.invoke('save_settings', { settings: s }),
  pickFolder: () => T.core.invoke('pick_folder'),
  openPath: path => T.core.invoke('open_path', { path }),
  reveal: path => T.core.invoke('reveal', { path }),
  moveTo: (path, line) => T.core.invoke('move_to', { path, line }).then(JSON.parse),
  search: query => T.core.invoke('search', { query }).then(JSON.parse),
  duplicates: () => T.core.invoke('duplicates').then(JSON.parse),
  trashFiles: paths => T.core.invoke('trash_files', { paths }),
  on: (ev, cb) => T.event.listen(ev, e => cb(e.payload)),
} : demoApi();

/* ---------- state ---------- */
let S = null, folder = null, query = '', openHeld = 0, openMove = null, trashAsk = false, shown = 0;
const fresh = new Set();
const TABS = [['home', 'Home'], ['review', 'Review'], ['history', 'History'], ['settings', 'Settings']];
let modeUI = 'bar'; /* prototype: 'bar' | 'chip' | 'sheet' */
const cur = () => { const h = location.hash.slice(1); return TABS.some(t => t[0] === h) ? h : 'home'; };
let lastTab = cur();
const sources = () => S.settings.sources;
const src = () => sources().find(s => s.path === folder) || null;
const colorOf = s => s.color || FCOLORS[sources().indexOf(s) % FCOLORS.length];
const inScope = path => !folder || within(path, folder);

/* ---------- theme ---------- */
const mq = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const pref = (S && S.settings.theme) || 'system';
  document.documentElement.dataset.theme = pref === 'system' ? (mq.matches ? 'dark' : 'light') : pref;
}
mq.addEventListener('change', applyTheme);

/* ---------- liquid motion ----------
   Modeled on Liquid Glass: damped springs (no wobble), a selection "lens" whose
   leading edge is stiffer than its trailing edge so it stretches toward where
   it's going, and thins while stretched so its area stays the same. */
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
class Spring {
  constructor(x, k, z) { this.x = x; this.v = 0; this.to = x; this.set(k, z); }
  set(k, z) { this.k = k; this.c = 2 * z * Math.sqrt(k); }
  step(dt) { const a = -this.k * (this.x - this.to) - this.c * this.v; this.v += a * dt; this.x += this.v * dt; }
  get done() { return Math.abs(this.x - this.to) < 0.15 && Math.abs(this.v) < 1; }
}
const LEAD = [900, 0.82], TRAIL = [380, 0.92], SETTLE = [700, 0.9];
function moveInd(nav, target, animate = true) {
  let ind = nav.querySelector('.ind');
  if (!ind) { ind = document.createElement('span'); ind.className = 'ind'; nav.prepend(ind); }
  if (!target) { ind.style.width = '0'; ind._L = null; return; }
  const nb = nav.getBoundingClientRect(), tb = target.getBoundingClientRect();
  const left = tb.left - nb.left + nav.scrollLeft, right = left + tb.width;
  if (!ind._L || !animate || reduce.matches) {
    ind._L = new Spring(left, ...SETTLE); ind._R = new Spring(right, ...SETTLE); ind._w = tb.width;
    ind.style.left = left + 'px'; ind.style.width = tb.width + 'px'; ind.style.transform = ''; return;
  }
  const goingRight = left > ind._L.to;
  (goingRight ? ind._R : ind._L).set(...LEAD);
  (goingRight ? ind._L : ind._R).set(...TRAIL);
  ind._L.to = left; ind._R.to = right; ind._w = tb.width;
  if (ind._raf) return;
  let last = performance.now();
  const tick = now => {
    let dt = Math.min(0.032, (now - last) / 1000); last = now;
    for (let i = 0; i < 4; i++) { ind._L.step(dt / 4); ind._R.step(dt / 4); }
    const w = Math.max(8, ind._R.x - ind._L.x);
    const stretch = Math.min(1.6, w / ind._w);
    // volume-preserving: wider -> thinner (sqrt keeps it subtle)
    const sy = stretch > 1 ? Math.max(0.82, 1 / Math.sqrt(stretch)) : 1;
    ind.style.left = ind._L.x + 'px'; ind.style.width = w + 'px'; ind.style.transform = `scaleY(${sy.toFixed(3)})`;
    if (ind._L.done && ind._R.done) { ind._raf = 0; ind.style.left = ind._L.to + 'px'; ind.style.width = (ind._R.to - ind._L.to) + 'px'; ind.style.transform = ''; return; }
    ind._raf = requestAnimationFrame(tick);
  };
  ind._raf = requestAnimationFrame(tick);
}

/* glass swells a few px under the finger and lights up where it's touched */
addEventListener('pointerdown', e => {
  const el = e.target.closest('.press'); if (!el || el.disabled) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', (e.clientX - r.left) + 'px'); el.style.setProperty('--my', (e.clientY - r.top) + 'px');
  const grow = Math.min(1.08, (r.width + 8) / r.width);
  el.classList.add('down'); if (!reduce.matches) el.style.transform = `scale(${grow.toFixed(3)})`;
  const up = () => { el.classList.remove('down'); el.style.transform = ''; removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
  addEventListener('pointerup', up); addEventListener('pointercancel', up);
});
addEventListener('pointermove', e => {
  const el = e.target.closest('.press.down'); if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', (e.clientX - r.left) + 'px'); el.style.setProperty('--my', (e.clientY - r.top) + 'px');
});

/* gel: a small droplet arrives with each axis on its own spring, so it squeezes then settles */
function gel(el) {
  if (reduce.matches) return;
  const sx = new Spring(0.9, 520, 1), sy = new Spring(0.7, 380, 1), y = new Spring(18, 420, 1);
  sx.to = sy.to = 1; y.to = 0;
  let last = performance.now(), o = 0;
  const tick = now => {
    const dt = Math.min(0.032, (now - last) / 1000); last = now;
    for (let i = 0; i < 4; i++) { sx.step(dt / 4); sy.step(dt / 4); y.step(dt / 4); }
    o = Math.min(1, o + dt * 7);
    el.style.opacity = o; el.style.transform = `translateY(${y.x.toFixed(2)}px) scale(${sx.x.toFixed(3)},${sy.x.toFixed(3)})`;
    if (sx.done && sy.done && y.done && o >= 1) { el.style.transform = ''; return; }
    requestAnimationFrame(tick);
  };
  el.style.opacity = 0; requestAnimationFrame(tick);
}

/* ---------- chrome ---------- */
function chrome(animateInd = true) {
  const win = $('win');
  win.style.setProperty('--acc', folder && src() ? colorOf(src()) : '#8e8cf5');
  // folders bar
  const s0 = src();
  $('bSweep').hidden = !(cur() === 'home' && !(s0 && s0.mode === 'off'));
  const f = $('folders');
  const hideBar = cur() === 'settings';
  f.classList.toggle('hidden', hideBar); f.toggleAttribute('inert', hideBar); f.setAttribute('aria-hidden', hideBar);
  const fInd = f.querySelector('.ind');
  f.innerHTML = `<button class="press" data-f="" ${!folder ? 'aria-pressed="true"' : 'aria-pressed="false"'}>All</button>` +
    sources().map(s => `<button class="press" data-f="${esc(s.path)}" aria-pressed="${s.path === folder}" style="--c:${colorOf(s)}" title="${esc(s.path)}">
      <span class="dot" style="opacity:${s.mode === 'off' || s.online === false ? .35 : 1}"></span>${esc(base(s.path))}</button>`).join('') +
    `<button class="add press" id="bAdd" aria-label="Add a folder">${svg(P.plus)}</button>`;
  if (fInd) f.prepend(fInd);
  moveInd(f, f.querySelector('[aria-pressed=true]'), animateInd);
  f.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { if ((b.dataset.f || null) === folder) return; folder = b.dataset.f || null; openHeld = 0; trashAsk = false; go('f'); });
  $('bAdd').onclick = addFolder;
  // tabs
  const held = S.held.filter(h => inScope(h.path)).length;
  const t = $('tabs');
  const tInd = t.querySelector('.ind');
  t.innerHTML = TABS.map(([id, label]) => `<a class="press" href="#${id}" aria-label="${label}${id === 'review' && held ? `, ${held} waiting` : ''}" ${cur() === id ? 'aria-current="page"' : ''}>${svg(P[id], 1.8)}<span>${label}</span>${id === 'review' && held ? `<span class="badge">${held}</span>` : ''}</a>`).join('');
  if (tInd) t.prepend(tInd);
  moveInd(t, t.querySelector('[aria-current=page]'), animateInd);
  // live chip
  const p = S.settings.paused;
  $('bLive').className = 'glass live press' + (p ? ' off' : '');
  $('bLive').querySelector('span').textContent = p ? 'Paused' : 'Live';
  $('bLive').setAttribute('aria-label', p ? 'Resume sorting' : 'Pause sorting');
}

/* ---------- screens ---------- */
function go(dir) {
  const v = $('view');
  const scr = document.createElement('section');
  scr.className = 'screen ' + (dir === 'r' ? 'in-r' : dir === 'l' ? 'in-l' : dir === 'f' ? 'in-f' : '');
  v.innerHTML = ''; v.appendChild(scr);
  shown++;
  ({ home, review, history, settings })[cur()](scr, true);
  chrome();
}
function redraw() { const scr = $('view').firstElementChild; if (!scr) return go(); scr.className = 'screen'; scr.innerHTML = ''; ({ home, review, history, settings })[cur()](scr, false); chrome(); }
addEventListener('hashchange', () => {
  const order = TABS.map(t => t[0]); const now = cur();
  const dir = order.indexOf(now) > order.indexOf(lastTab) ? 'r' : 'l'; lastTab = now;
  openMove = null; trashAsk = false; go(dir);
});
async function load(dir) { S = await api.state(); applyTheme(); dir === undefined ? redraw() : go(dir); }

const row = (e, i, enter) => `<div class="row file ${enter ? 'enter' : ''} ${fresh.has(e.id) ? 'fresh' : ''}" style="--i:${i}" data-row="${e.id}" data-path="${esc(e.undone ? e.from : e.to)}" data-line="${e.line}" ${e.undone ? '' : 'draggable="true"'} title="Click to open · right-click for more">
  ${icon(e.line)}
  <div class="txt"><b title="${esc(e.from)}">${esc(e.name)}</b><span>${esc(base(parts(e.from).slice(0, -1).join('/')))} › ${esc(L(e.line).name)}</span></div>
  <span class="when">${ago(e.ts)}</span>
  ${e.undone ? '' : `<button class="pill solid undo press" data-undo="${e.id}">Undo</button>`}</div>`;

/* folder tiles: the sorted folders inside a watched folder, with real counts */
function tilesHtml(s) {
  const ts = S.tiles[s.path] || [];
  if (!ts.length) return '';
  return `<div class="tiles">${ts.map((t, i) => { const off = !s.lines.includes(t.line);
    return `<button class="tile glass press ${t.count ? '' : 'empty-tile'} ${off ? 'off-tile' : ''}" style="${lineVars(t.line)};--i:${i}" data-folder="${esc(t.path)}" data-drop="${t.line}"
    title="${off ? `This folder doesn't sort ${esc(L(t.line).name)}. ` : ''}Open ${esc(L(t.line).name)} in ${FILES} · drop a file here to move it">${icon(t.line, 'sm')}<span class="tn">${L(t.line).name}</span><b>${off && !t.count ? 'off' : t.count}</b></button>`; }).join('')}</div>`;
}

/* Home */
const hourLabel = ts => {
  const d = new Date(ts * 1e3), n = new Date(), y = new Date(n); y.setDate(n.getDate() - 1);
  if (d.toDateString() === n.toDateString()) return 'Today, ' + d.toLocaleTimeString([], { hour: 'numeric' });
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
};
/* everything that needs you, in one place: review queue, ask-first folders, old installers */
function attention() {
  const rows = [];
  const held = S.held.filter(h => inScope(h.path)).length;
  if (held) rows.push(`<button class="set press" data-go="review"><span class="dotn">${held}</span><span class="grow txt"><b>${held === 1 ? '1 file to review' : held + ' files to review'}</b><small>Transfer wasn't sure where they go</small></span><span style="color:var(--fg3)">${svg(P.chevR)}</span></button>`);
  sources().filter(x => x.mode === 'ask' && x.online !== false && (!folder || x.path === folder)).forEach(x => {
    const n = S.pending[x.path] || 0;
    if (n) rows.push(`<button class="set press" data-sweep="${esc(x.path)}"><span class="dotn">${n}</span><span class="grow txt"><b>${n} ${n === 1 ? 'file' : 'files'} ready in ${esc(base(x.path))}</b><small>Sweep to sort them</small></span><span style="color:var(--fg3)">${svg(P.chevR)}</span></button>`);
  });
  const stale = S.stale.filter(x => inScope(x.path));
  if (stale.length) {
    const sz = stale.reduce((a, x) => a + x.size, 0);
    rows.push(`<div class="set"><span class="dotn" style="${lineVars('installers')};background:color-mix(in srgb,var(--lc) 22%,transparent)">${stale.length}</span><span class="grow txt"><b>${stale.length === 1 ? '1 old installer' : stale.length + ' old installers'}</b><small>${size(sz)} you can free</small></span>
      <button class="pill ${trashAsk ? 'acc' : 'ghost'} press" id="bTrash">${trashAsk ? `Move to ${BIN}` : 'Clear'}</button></div>`);
  }
  return rows.length ? `<div class="group glass attn">${rows.join('')}</div>` : '';
}
const MODE_HELP = { auto: 'Sorts files a few seconds after they land.', ask: 'Waits until you press Sweep.', off: 'Transfer ignores this folder.' };
const modeToast = s => s.mode === 'auto' ? `${base(s.path)} sorts itself as files arrive` : s.mode === 'ask' ? `${base(s.path)} waits for you to sweep` : `${base(s.path)} is left alone`;
async function setMode(s, m) { s.mode = m; await api.saveSettings(S.settings); toast(modeToast(s)); setTimeout(() => load(), 350); }
function modeMenu(anchor, s) {
  closeMenu();
  const m = document.createElement('div'); m.className = 'menu'; m.style.width = '250px'; m.setAttribute('role', 'menu');
  m.innerHTML = `<div class="mname">When files arrive in ${esc(base(s.path))}</div>` + MODES.map(([k, n]) =>
    `<button class="mi" role="menuitemradio" aria-checked="${s.mode === k}" data-mm="${k}"><span class="mt"><b style="font-weight:600">${n}</b><small>${MODE_HELP[k]}</small></span></button>`).join('') +
    `<div class="msep"></div><button class="mi" data-mm="more"><span class="mt"><b style="font-weight:600">Choose file types…</b><small>${s.lines.length} of 8 types sorted here</small></span></button>`;
  $('win').appendChild(m);
  const wb = $('win').getBoundingClientRect(), ab = anchor.getBoundingClientRect(), mb = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(ab.left - wb.left, wb.width - mb.width - 8)) + 'px'; m.style.top = (ab.bottom - wb.top + 6) + 'px';
  gel(m);
  m.onclick = e => { const b = e.target.closest('[data-mm]'); if (!b) return; closeMenu(); if (b.dataset.mm === 'more') editFolder(s.path); else setMode(s, b.dataset.mm); };
}
function home(el, enter) {
  const s = src();
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const live = S.history.filter(e => !e.undone && inScope(e.from));
  const today = live.filter(e => e.ts * 1e3 >= today0).length;
  let html = '', feed = '';
  if (!s) {
    html += `<div class="head"><div style="display:flex;flex-direction:column;gap:2px"><span class="sub">Today, across ${sources().filter(x => x.mode !== 'off').length} folders</span>
      <div class="big"><b data-count="${today}">${today}</b><span>files sorted</span></div></div></div>
      <div class="cards">${sources().map(x => {
        const n = S.history.filter(e => !e.undone && within(e.from, x.path) && e.ts * 1e3 >= today0).length;
        return `<button class="fcard glass press" data-pick="${esc(x.path)}" style="--c:${colorOf(x)}"><span class="top2"><span class="dot"></span>${esc(base(x.path))}</span>
          <b>${n}</b><span class="mode">${modeName(x)}</span></button>`;
      }).join('')}</div>${attention()}`;
    /* one feed across every folder, grouped by hour */
    const groups = []; let i = 0;
    live.slice(0, 12).forEach(e => { const k = hourLabel(e.ts); let g = groups[groups.length - 1]; if (!g || g.k !== k) groups.push(g = { k, rows: [] }); g.rows.push(e); });
    feed = groups.length ? groups.map(g => `<div class="list"><span class="hour">${esc(g.k)}</span>${g.rows.map(e => row(e, i++, enter)).join('')}</div>`).join('') +
      (live.length > 12 ? `<a class="more press ghost glass" href="#history">All activity</a>` : '')
      : `<div class="empty">${svg(P.check, 1.6)}<span>Nothing moved yet. New files show up here.</span></div>`;
  } else {
    const off = s.mode === 'off', offline = s.online === false;
    const sub = offline ? 'This folder is offline. Plug the drive back in.' : off ? 'Not watched' : `${today} sorted today`;
    const chip = modeUI === 'chip' ? `<button class="glass press chipmode ${s.mode}" id="bChip" aria-haspopup="menu"><i></i>${MODES.find(m => m[0] === s.mode)[1]}${svg(P.chevD, 2.2)}</button>`
      : modeUI === 'sheet' ? `<button class="glass press live icon-btn" id="bGear" aria-label="Folder settings" title="Folder settings">${svg(P.settings, 1.8)}</button>` : '';
    html += `<div class="head"><div style="display:flex;flex-direction:column;gap:2px;min-width:0"><span class="h1">${esc(base(s.path))}</span>
      <span class="sub">${sub}${modeUI === 'sheet' ? ` · ${MODES.find(m => m[0] === s.mode)[1]}` : ''}</span></div>${chip ? `<div class="tools">${chip}</div>` : ''}</div>
      ${modeUI === 'bar' ? `<div class="seg glass small" id="modeSeg" role="group" aria-label="Mode">${MODES.map(([m, n]) => `<button class="press" data-mode="${m}" aria-pressed="${s.mode === m}">${n}</button>`).join('')}</div>
      <span class="sub" style="padding:0 6px;margin-top:-6px">${MODE_HELP[s.mode]}</span>` : ''}
      ${tilesHtml(s)}${attention()}`;
    const recent = live.slice(0, 6);
    feed = recent.length ? `<div class="list"><span class="hour">Recent</span>${recent.map((e, i) => row(e, i, enter)).join('')}</div>` + (live.length > 6 ? `<a class="more press ghost glass" href="#history">All activity</a>` : '')
      : `<div class="empty">${svg(P.check, 1.6)}<span>${off ? 'Turn on Auto or Ask first to start sorting this folder.' : 'Nothing moved yet. New files show up here.'}</span></div>`;
  }
  el.innerHTML = html + feed;
  el.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { folder = b.dataset.pick; go('f'); });
  el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { location.hash = b.dataset.go; });
  el.querySelectorAll('[data-sweep]').forEach(b => b.onclick = () => { if (!folder) { folder = b.dataset.sweep; } sweep(); });
  const ms = el.querySelector('#modeSeg');
  if (ms) {
    requestAnimationFrame(() => moveInd(ms, ms.querySelector('[aria-pressed=true]'), false));
    ms.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
      ms.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', x === b)); moveInd(ms, b); setMode(s, b.dataset.mode);
    });
  }
  const chip = el.querySelector('#bChip'); if (chip) chip.onclick = e => { e.stopPropagation(); modeMenu(chip, s); };
  const gear = el.querySelector('#bGear'); if (gear) gear.onclick = () => editFolder(s.path);
  const t = el.querySelector('#bTrash');
  if (t) t.onclick = async () => {
    if (!trashAsk) { trashAsk = true; return redraw(); }
    const stale = S.stale.filter(x => inScope(x.path));
    await api.trash(stale.map(x => x.path)); trashAsk = false; toast(`Moved ${stale.length} installers to the ${BIN}`); load();
  };
  tweenCounts(el);
}
let lastCount = null;
function tweenCounts(el) {
  const b = el.querySelector('[data-count]'); if (!b) return;
  const to = +b.dataset.count, from = lastCount === null ? to : lastCount; lastCount = to;
  if (from === to) return;
  const t0 = performance.now();
  const step = t => { const k = Math.min(1, (t - t0) / 600), e = 1 - Math.pow(1 - k, 3); b.textContent = Math.round(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

/* Review */
function review(el, enter) {
  const H = S.held.filter(h => inScope(h.path));
  if (!H.length) { el.innerHTML = `<span class="h1" style="padding:0 4px">Review</span><div class="empty">${svg(P.check, 1.6)}<span>All clear. Files Transfer isn't sure about wait here instead of moving.</span></div>`; return; }
  openHeld = Math.min(openHeld, H.length - 1);
  const h = H[openHeld];
  if (h._pick === undefined) h._pick = h.guess !== 'holding' ? h.guess : null;
  el.innerHTML = `<div class="head"><div style="display:flex;flex-direction:column;gap:2px"><span class="h1">Review</span><span class="sub">${H.length} file${H.length > 1 ? 's' : ''} Transfer wasn't sure about</span></div></div>
    <div class="card glass ${enter ? '' : ''}">
      <div style="display:flex;align-items:center;gap:11px">${icon(h._pick || 'holding')}
        <div class="txt"><b>${esc(h.name)}</b><span>${esc(base(parts(h.path).slice(0, -1).join('/')))} · ${size(h.size)} · ${h.guess === 'holding' ? 'no guess' : Math.round(h.confidence * 100) + '% sure it\'s ' + L(h.guess).name}</span></div></div>
      ${picker(h._pick)}
      <div style="display:flex;gap:8px"><button class="btn ghost press" style="flex:1" id="bLeave">Leave it</button>
        <button class="btn acc press" style="flex:1.6" id="bGo" ${h._pick ? '' : 'disabled'}>${h._pick ? 'Move to ' + L(h._pick).name : 'Pick where it goes'}</button></div>
    </div>
    <div class="list">${H.map((x, i) => i === openHeld ? '' : `<button class="row press ${enter ? 'enter' : ''}" style="--i:${i}" data-open="${i}">${icon('holding')}
      <div class="txt"><b>${esc(x.name)}</b><span>${x.guess === 'holding' ? 'no guess' : 'maybe ' + L(x.guess).name}</span></div><span style="color:var(--fg3)">${svg(P.chevR)}</span></button>`).join('')}</div>`;
  el.querySelectorAll('[data-line]').forEach(b => b.onclick = () => { h._pick = b.dataset.line; redraw(); });
  el.querySelector('#bLeave').onclick = () => { S.held.splice(S.held.indexOf(h), 1); redraw(); };
  el.querySelector('#bGo').onclick = async () => { const e = await api.route(h.path, h._pick); fresh.add(e.id); toast(`${h.name} › ${L(h._pick).name}`, e.id); load(); };
  el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { openHeld = +b.dataset.open; redraw(); });
}
const picker = (sel, allowed) => `<div class="grid" role="group" aria-label="Move to">${LINES.filter(l => !allowed || allowed.includes(l.id)).map(l =>
  `<button class="press" data-line="${l.id}" aria-pressed="${l.id === sel}" style="${lineVars(l.id)}">${svg(P[l.id])}${l.name}</button>`).join('')}</div>`;

/* History */
function history(el, enter) {
  const q = query.toLowerCase();
  const rows = S.history.filter(e => inScope(e.from) && (!q || e.name.toLowerCase().includes(q)));
  const groups = {};
  rows.forEach(e => { const d = new Date(e.ts * 1e3); const k = d.toDateString() === new Date().toDateString() ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }); (groups[k] = groups[k] || []).push(e); });
  let i = 0;
  const list = () => Object.entries(groups).map(([k, es]) => `<div class="list"><span class="label" style="padding:4px 6px">${esc(k)}</span>${es.map(e => {
      return row(e, i++, enter).replace('class="row file', e.undone ? 'style="opacity:.45" class="row file' : 'class="row file');
    }).join('')}</div>`).join('') || `<div class="empty">${svg(P.search, 1.6)}<span>No moves match.</span></div>`;
  if (el.querySelector('#hlist') && !enter) { el.querySelector('#hlist').innerHTML = list(); return; }
  el.innerHTML = `<div class="head"><span class="h1">History</span><span class="sub">Click to open · right-click for more</span></div>
    <label class="search glass">${svg(P.search)}<input id="q" placeholder="Search moves" aria-label="Search moves" value="${esc(query)}"></label>
    <div id="hlist" style="display:contents">${list()}</div>`;
  const qi = el.querySelector('#q');
  // only the list re-renders while typing; the box keeps focus and caret
  qi.oninput = () => { query = qi.value; history(el, false); };
}

/* Settings */
function settings(el) {
  const s = S.settings;
  el.innerHTML = `<span class="h1" style="padding:0 4px">Settings</span>
    <div style="display:flex;flex-direction:column;gap:6px"><span class="label">Appearance</span>
      <div class="seg glass small" id="themeSeg" role="group" aria-label="Appearance">${[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([k, n]) => `<button class="press" data-theme-pick="${k}" aria-pressed="${(s.theme || 'system') === k}">${n}</button>`).join('')}</div></div>
    <div style="display:flex;flex-direction:column;gap:6px"><span class="label">Folders</span>
      <div class="group glass">${sources().map(x => `<button class="set press" data-edit="${esc(x.path)}" style="--c:${colorOf(x)}"><span class="dot"></span><span class="grow">${esc(base(x.path))}</span>
        <span class="val">${modeName(x)}</span><span style="color:var(--fg3)">${svg(P.chevR)}</span></button>`).join('')}
        <button class="set press" id="bAdd2" style="color:var(--fg2)">${svg(P.plus)}<span class="grow">Add a folder</span></button></div></div>
    <div style="display:flex;flex-direction:column;gap:6px"><span class="label">Sorting</span>
      <div class="group glass">
        <label class="set"><span class="grow">Move when sure<span class="hint">Below this, a file waits in Review</span></span><input type="range" id="conf" min="40" max="95" step="5" value="${Math.round(s.confidence * 100)}"><output id="confO">${Math.round(s.confidence * 100)}%</output></label>
        <label class="set"><span class="grow">Wait before moving<span class="hint">Lets downloads finish first</span></span><input type="range" id="settle" min="2" max="60" value="${s.settle_secs}"><output id="settleO">${s.settle_secs} s</output></label>
        <label class="set"><span class="grow">Flag old installers<span class="hint">Offer to clear ones older than this</span></span><input type="range" id="stale" min="7" max="120" value="${s.stale_installer_days}"><output id="staleO">${s.stale_installer_days} d</output></label>
      </div></div>
    <div style="display:flex;flex-direction:column;gap:6px"><span class="label">Tidy up</span>
      <div class="group glass"><button class="set press" id="bDupes">${icon('archives', 'sm').replace(P.archives, P.dupes)}<span class="grow">Find duplicate files</span><span style="color:var(--fg3)">${svg(P.chevR)}</span></button></div></div>
    <div class="group glass"><label class="set"><span class="grow">Open at login</span><input type="checkbox" class="sw" id="login" ${s.launch_at_login ? 'checked' : ''}></label></div>
    <div class="note">${svg(P.lock)}<span>Runs only on this computer. Nothing is uploaded.</span></div>`;
  const save = () => api.saveSettings(s);
  const ts = el.querySelector('#themeSeg');
  requestAnimationFrame(() => moveInd(ts, ts.querySelector('[aria-pressed=true]'), false));
  ts.querySelectorAll('[data-theme-pick]').forEach(b => b.onclick = () => {
    s.theme = b.dataset.themePick; ts.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); moveInd(ts, b); applyTheme(); save();
  });
  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editFolder(b.dataset.edit));
  el.querySelector('#bAdd2').onclick = addFolder;
  el.querySelector('#bDupes').onclick = findDupes;
  const rng = (id, set, fmt) => { const i = el.querySelector('#' + id); i.oninput = () => { set(+i.value); el.querySelector('#' + id + 'O').textContent = fmt(+i.value); }; i.onchange = save; };
  rng('conf', v => s.confidence = v / 100, v => v + '%');
  rng('settle', v => s.settle_secs = v, v => v + ' s');
  rng('stale', v => s.stale_installer_days = v, v => v + ' d');
  el.querySelector('#login').onchange = e => { s.launch_at_login = e.target.checked; save(); };
}

/* ---------- sheets ---------- */
function sheet(html, bind, acc) {
  $('layer').innerHTML = `<div class="scrim" id="scrim"></div><div class="sheet" role="dialog" aria-modal="true" ${acc ? `style="--acc:${acc}"` : ''}><span class="grip" aria-hidden="true"></span>${html}</div>`;
  $('scrim').onclick = closeSheet;
  $('layer').querySelectorAll('[data-close]').forEach(b => b.onclick = closeSheet);
  bind && bind($('layer').querySelector('.sheet'));
}
function closeSheet() {
  const sh = $('layer').querySelector('.sheet'); if (!sh) return;
  sh.classList.add('out'); $('scrim').classList.add('out');
  setTimeout(() => { $('layer').innerHTML = ''; }, 210);
}
addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

async function sweep() {
  const plans = await api.plan(folder);
  const moves = plans.flatMap(p => p.moves);
  const by = {}; moves.forEach(m => (by[m.line] = by[m.line] || []).push(m));
  const order = LINES.filter(l => by[l.id]);
  let open = order[0] && order[0].id;
  const where = folder ? base(folder) : 'all folders';
  const draw = sh => {
    sh.innerHTML = `<span class="grip" aria-hidden="true"></span>
      <div style="display:flex;flex-direction:column;gap:2px;padding:0 4px"><span class="h1">Sweep ${esc(where)}</span>
        <span class="sub">${moves.length ? `${moves.length} file${moves.length > 1 ? 's' : ''} ready. Nothing has moved yet.` : 'Everything here is already sorted.'}</span></div>
      <div class="scroll">${order.length ? `<div class="group glass">${order.map(l => `<div>
        <button class="set press" data-g="${l.id}">${icon(l.id, 'sm')}<span class="grow">${l.name}</span><span class="val">${by[l.id].length}</span><span style="color:var(--fg3)">${svg(open === l.id ? P.chevD : P.chevR)}</span></button>
        ${open === l.id ? `<div style="display:flex;flex-direction:column;gap:4px;padding:0 12px 11px 48px;animation:inF .3s var(--out)">${by[l.id].map(m => `<div style="display:flex;gap:8px;font-size:12px"><span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.name)}</span><span style="color:var(--fg3)">${esc(base(parts(m.from).slice(0, -1).join('/')))}</span></div>`).join('')}</div>` : ''}
      </div>`).join('')}</div>` : `<div class="empty">${svg(P.check, 1.6)}</div>`}</div>
      <div style="display:flex;gap:8px"><button class="btn ghost press" style="flex:1" data-close>${moves.length ? 'Cancel' : 'Close'}</button>
        ${moves.length ? `<button class="btn acc press" style="flex:1.5" id="sYes">Move ${moves.length} file${moves.length > 1 ? 's' : ''}</button>` : ''}</div>`;
    sh.querySelectorAll('[data-close]').forEach(b => b.onclick = closeSheet);
    sh.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { open = open === b.dataset.g ? null : b.dataset.g; draw(sh); });
    const y = sh.querySelector('#sYes');
    if (y) y.onclick = async () => { y.disabled = true; const done = await api.apply(folder); done.forEach(e => fresh.add(e.id)); closeSheet(); toast(`Moved ${done.length} file${done.length === 1 ? '' : 's'}`); load(); };
  };
  sheet('', draw);
}

function editFolder(path, isNew) {
  const s = sources().find(x => x.path === path); if (!s) return;
  const draw = sh => {
    sh.innerHTML = `<span class="grip" aria-hidden="true"></span>
      <div style="display:flex;align-items:center;gap:10px;padding:0 4px;--c:${colorOf(s)}"><span class="dot" style="width:12px;height:12px"></span>
        <div style="display:flex;flex-direction:column;min-width:0;flex:1"><span class="h1">${esc(base(s.path))}</span><span class="path">${esc(s.path)}</span></div></div>
      <div class="scroll">
        <div style="display:flex;flex-direction:column;gap:6px"><span class="label">Mode</span>
          <div class="seg glass small" id="fMode">${MODES.map(([m, n]) => `<button class="press" data-m="${m}" aria-pressed="${s.mode === m}">${n}</button>`).join('')}</div>
          <span class="sub" style="padding:0 6px">${s.mode === 'auto' ? 'New files are sorted a few seconds after they land.' : s.mode === 'ask' ? 'Nothing moves until you open Sweep and confirm.' : 'Transfer ignores this folder.'}</span></div>
        <div style="display:flex;flex-direction:column;gap:6px"><span class="label">Sorts into</span>
          <div class="grid off" id="fLines">${LINES.map(l => `<button class="press" data-l="${l.id}" aria-pressed="${s.lines.includes(l.id)}" style="${lineVars(l.id)}">${svg(P[l.id])}${l.name}</button>`).join('')}</div>
          <span class="sub" style="padding:0 6px">Files of a type you turn off stay put here.</span></div>
        ${s.custom ? `<button class="set group glass press" id="fRemove" style="color:#ff6b61;justify-content:center">Stop watching ${esc(base(s.path))}</button>` : ''}
      </div>
      <button class="btn acc press" data-close>${isNew ? 'Start watching' : 'Done'}</button>`;
    sh.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { closeSheet(); load(); });
    const fm = sh.querySelector('#fMode');
    requestAnimationFrame(() => moveInd(fm, fm.querySelector('[aria-pressed=true]'), false));
    fm.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { s.mode = b.dataset.m; moveInd(fm, b); api.saveSettings(S.settings); setTimeout(() => draw(sh), 300); });
    sh.querySelectorAll('[data-l]').forEach(b => b.onclick = () => {
      const id = b.dataset.l; s.lines = s.lines.includes(id) ? s.lines.filter(x => x !== id) : [...s.lines, id];
      b.setAttribute('aria-pressed', s.lines.includes(id)); api.saveSettings(S.settings);
    });
    const rm = sh.querySelector('#fRemove');
    if (rm) rm.onclick = async () => { S.settings.sources = sources().filter(x => x !== s); if (folder === s.path) folder = null; await api.saveSettings(S.settings); closeSheet(); toast(`Stopped watching ${base(s.path)}`); load('f'); };
  };
  sheet('', draw, colorOf(s));
}

async function addFolder() {
  const path = await api.pickFolder(); if (!path) return;
  if (sources().some(x => norm(x.path) === norm(path))) { toast(`${base(path)} is already watched`); return; }
  sources().push({ path, mode: 'ask', lines: LINES.map(l => l.id), custom: true, color: FCOLORS[sources().length % FCOLORS.length] });
  await api.saveSettings(S.settings);
  folder = path; await load('f'); editFolder(path, true);
}

/* ---------- shared ---------- */
$('bLive').onclick = async () => { S.settings.paused = !S.settings.paused; await api.saveSettings(S.settings); chrome(); toast(S.settings.paused ? 'Paused. Nothing will move.' : 'Sorting again'); };
$('bSweep').onclick = sweep;
$('view').addEventListener('click', async ev => {
  const u = ev.target.closest('[data-undo]'); if (!u) return;
  ev.stopPropagation();
  const r = u.closest('.row'); r.style.height = r.offsetHeight + 'px'; r.offsetHeight; r.classList.add('gone');
  const e = await api.undo(+u.dataset.undo); toast(`Put ${e.name} back`);
  setTimeout(() => load(), 300);
});
let tt;
function toast(msg, undoId) {
  const old = document.querySelector('.toast'); if (old) old.remove(); clearTimeout(tt);
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status');
  t.innerHTML = `<i class="td" aria-hidden="true"></i><span>${esc(msg)}</span>${undoId ? '<button class="press">Undo</button>' : ''}`;
  $('win').appendChild(t); gel(t);
  if (undoId) t.querySelector('button').onclick = async () => { await api.undo(undoId); t.remove(); load(); };
  tt = setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 200); }, 3800);
}

/* ---------- files: open, right-click menu, drag to re-sort ---------- */
const where = p => { const a = parts(p); const parent = a[a.length - 2] || ''; const line = LINES.find(l => l.name === parent);
  return line ? `${a[a.length - 3]} › ${line.name}` : parent; };
async function openFile(path) { try { await api.openPath(path); } catch (e) { toast(String(e)); } }
$('win').addEventListener('click', ev => {
  if (ev.target.closest('[data-undo]')) return;
  const f = ev.target.closest('[data-path]'); if (f && !f.closest('.menu')) { openFile(f.dataset.path); return; }
  const t = ev.target.closest('[data-folder]'); if (t) openFile(t.dataset.folder);
});
function closeMenu() { const m = document.querySelector('.menu'); if (m) { m.classList.add('out'); setTimeout(() => m.remove(), 140); } }
$('win').addEventListener('contextmenu', ev => {
  const f = ev.target.closest('[data-path]'); ev.preventDefault(); closeMenu(); if (!f) return;
  const path = f.dataset.path, undoId = f.querySelector('[data-undo]')?.dataset.undo, cur = f.dataset.line;
  const m = document.createElement('div'); m.className = 'menu'; m.setAttribute('role', 'menu');
  m.innerHTML = `<div class="mname">${esc(base(path))}</div>
    <button class="mi" data-a="open">${svg(P.open)}Open</button>
    <button class="mi" data-a="reveal">${svg(P.reveal)}Show in folder</button>
    <button class="mi" data-a="copy">${svg(P.copy)}Copy path</button>
    ${undoId ? `<button class="mi" data-a="undo">${svg(P.undo)}Undo this move</button>` : ''}
    <div class="msep"></div><div class="mlabel">Move to</div>
    <div class="mgrid">${LINES.filter(l => l.id !== cur).map(l => `<button class="mline" data-to="${l.id}" style="${lineVars(l.id)}" title="${l.name}">${svg(P[l.id])}<span>${l.name}</span></button>`).join('')}</div>`;
  $('win').appendChild(m);
  const wb = $('win').getBoundingClientRect(), mb = m.getBoundingClientRect();
  m.style.left = Math.min(ev.clientX - wb.left, wb.width - mb.width - 8) + 'px';
  m.style.top = Math.min(ev.clientY - wb.top, wb.height - mb.height - 8) + 'px';
  gel(m);
  m.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return; closeMenu();
    if (b.dataset.a === 'open') openFile(path);
    if (b.dataset.a === 'reveal') api.reveal(path).catch(x => toast(String(x)));
    if (b.dataset.a === 'copy') { try { await navigator.clipboard.writeText(path); toast('Path copied'); } catch { toast(path); } }
    if (b.dataset.a === 'undo') { const r = await api.undo(+undoId); toast(`Put ${r.name} back`); load(); }
    if (b.dataset.to) moveFile(path, b.dataset.to);
  };
});
addEventListener('pointerdown', e => { if (!e.target.closest('.menu')) closeMenu(); }, true);
addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
$('view').addEventListener('scroll', closeMenu, true);
async function moveFile(path, line) {
  try { const e = await api.moveTo(path, line); fresh.add(e.id); toast(`${e.name} › ${L(line).name}. Noted for next time.`, e.id); load(); }
  catch (x) { toast(String(x)); }
}
// drag a file row onto a folder tile
$('win').addEventListener('dragstart', e => {
  const f = e.target.closest('[data-path]'); if (!f) return;
  e.dataTransfer.setData('text/x-transfer', f.dataset.path); e.dataTransfer.effectAllowed = 'move';
  f.classList.add('dragging'); document.body.classList.add('is-dragging');
});
$('win').addEventListener('dragend', e => { e.target.closest?.('[data-path]')?.classList.remove('dragging'); document.body.classList.remove('is-dragging'); });
$('win').addEventListener('dragover', e => { const t = e.target.closest('[data-drop]'); if (!t) return; e.preventDefault(); t.classList.add('over'); });
$('win').addEventListener('dragleave', e => { const t = e.target.closest('[data-drop]'); if (t && !t.contains(e.relatedTarget)) t.classList.remove('over'); });
$('win').addEventListener('drop', e => {
  const t = e.target.closest('[data-drop]'); if (!t) return; e.preventDefault(); t.classList.remove('over');
  const path = e.dataTransfer.getData('text/x-transfer'); if (path) moveFile(path, t.dataset.drop);
});

/* ---------- search everything ---------- */
function openSearch() {
  sheet(`<div class="search glass" style="height:42px">${svg(P.search)}<input id="sq" placeholder="Search every watched folder" aria-label="Search files" autocomplete="off"></div>
    <div class="scroll" id="sres"><div class="empty">${svg(P.search, 1.6)}<span>Type part of a file name. Click a result to open it.</span></div></div>`, sh => {
    const q = sh.querySelector('#sq'); setTimeout(() => q.focus(), 60);
    let tmr;
    q.oninput = () => { clearTimeout(tmr); tmr = setTimeout(async () => {
      const v = q.value.trim(), out = sh.querySelector('#sres');
      if (!v) { out.innerHTML = ''; return; }
      const hits = await api.search(v);
      out.innerHTML = hits.length ? `<div class="list">${hits.map((f, i) => `<div class="row file enter" style="--i:${Math.min(i, 10)}" data-path="${esc(f.path)}" data-line="${f.line || ''}" draggable="true" title="Click to open · right-click for more">
          ${icon(f.line || 'holding')}<div class="txt"><b>${esc(f.name)}</b><span>${esc(where(f.path))} · ${size(f.size)}</span></div><span class="when">${ago(f.modified)}</span></div>`).join('')}</div>`
        : `<div class="empty">${svg(P.search, 1.6)}<span>No files named like "${esc(v)}".</span></div>`;
    }, 140); };
  });
}
$('bSearch').onclick = openSearch;
addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); openSearch(); } });

/* ---------- duplicates ---------- */
async function findDupes() {
  sheet(`<div style="display:flex;flex-direction:column;gap:2px;padding:0 4px"><span class="h1">Duplicates</span><span class="sub" id="dsub">Comparing files byte by byte…</span></div>
    <div class="scroll" id="dres"><div class="empty"><span class="spin" aria-hidden="true"></span></div></div>
    <div style="display:flex;gap:8px"><button class="btn ghost press" style="flex:1" data-close>Close</button><button class="btn acc press" style="flex:1.6" id="dGo" disabled>Pick copies to remove</button></div>`, async sh => {
    const groups = await api.duplicates();
    const out = sh.querySelector('#dres'), go = sh.querySelector('#dGo'), sub = sh.querySelector('#dsub');
    if (!groups.length) { sub.textContent = 'No exact copies found.'; out.innerHTML = `<div class="empty">${svg(P.check, 1.6)}<span>Every file is unique.</span></div>`; return; }
    const waste = groups.reduce((a, g) => a + g[0].size * (g.length - 1), 0);
    sub.textContent = `${groups.length} set${groups.length > 1 ? 's' : ''} of identical files · ${size(waste)} could be freed. The newest copy is kept unless you change it.`;
    out.innerHTML = groups.map((g, gi) => `<div class="group glass">${g.map((f, i) => `<label class="set dup">
        <input type="checkbox" class="ck" data-p="${esc(f.path)}" ${i ? 'checked' : ''} aria-label="Remove ${esc(f.name)}">
        ${icon(f.line || 'holding', 'sm')}<span class="grow txt"><b>${esc(f.name)}</b><span>${esc(where(f.path))} · ${ago(f.modified)}${i ? '' : ' · newest'}</span></span><span class="val">${size(f.size)}</span></label>`).join('')}</div>`).join('');
    const sync = () => {
      const picked = [...out.querySelectorAll('.ck:checked')];
      // never let a whole set be removed
      out.querySelectorAll('.group').forEach(gEl => { const cks = [...gEl.querySelectorAll('.ck')]; if (cks.every(c => c.checked)) cks[0].checked = false; });
      const n = out.querySelectorAll('.ck:checked').length;
      go.disabled = !n; go.textContent = n ? `Move ${n} to ${BIN}` : 'Pick copies to remove';
      return picked;
    };
    out.onchange = sync; sync();
    go.onclick = async () => {
      const paths = [...out.querySelectorAll('.ck:checked')].map(c => c.dataset.p);
      go.disabled = true;
      try { await api.trashFiles(paths); closeSheet(); toast(`Moved ${paths.length} duplicate${paths.length > 1 ? 's' : ''} to the ${BIN}`); load(); }
      catch (x) { toast(String(x)); go.disabled = false; }
    };
  });
}

/* window controls */
const W = T && T.window && T.window.getCurrentWindow ? T.window.getCurrentWindow() : null;
let onTop = false;
$('bClose').onclick = () => W && W.close();
$('bMin').onclick = () => W && W.minimize();
$('bTop').onclick = async () => { if (!W) return; onTop = !onTop; await W.setAlwaysOnTop(onTop); toast(onTop ? 'Staying on top' : 'Back to normal'); };

/* engine events */
if (T) {
  // a burst of downloads becomes one refresh and one toast, not one per file
  let burst = [], burstT = 0;
  api.on('transfer://moved', payload => {
    const e = JSON.parse(payload); fresh.add(e.id); burst.push(e);
    clearTimeout(burstT);
    burstT = setTimeout(async () => {
      const b = burst; burst = [];
      await load();
      if (b.length === 1) toast(`${b[0].name} › ${L(b[0].line).name}`, b[0].id); else toast(`Sorted ${b.length} new files`);
    }, 300);
  });
  api.on('transfer://state', () => load());
  api.on('transfer://sweep', () => { location.hash = 'home'; sweep(); });
}
addEventListener('resize', () => chrome(false));
load('f');

/* prototype-only controls */
$('dMode').onclick = () => { modeUI = { bar: 'chip', chip: 'sheet', sheet: 'bar' }[modeUI]; $('dMode').textContent = 'Mode control: ' + { bar: 'Bar', chip: 'Chip', sheet: 'Sheet' }[modeUI]; closeMenu(); redraw(); };
/* tray popover: the left-click view of the tray icon (prototype of the real mini window) */
$('dTray').onclick = () => {
  const old = document.querySelector('.pop'); if (old) { old.remove(); return; }
  const live = S.history.filter(e => !e.undone).slice(0, 5);
  const p = document.createElement('div'); p.className = 'pop'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Transfer tray');
  p.innerHTML = `<div class="ph"><b style="font-size:15px">Transfer</b><label class="live glass" style="cursor:pointer"><i></i><span>${S.settings.paused ? 'Paused' : 'Live'}</span><input type="checkbox" class="sw" style="width:34px;height:20px" ${S.settings.paused ? '' : 'checked'} aria-label="Sorting on"></label></div>
    <div class="list">${live.map(e => `<div class="row">${icon(e.line)}<div class="txt"><b>${esc(e.name)}</b><span>${esc(base(parts(e.from).slice(0, -1).join('/')))} › ${esc(L(e.line).name)}</span></div><span class="when">${ago(e.ts)}</span></div>`).join('')}</div>
    <div class="pb"><button class="btn ghost press">Sweep now</button><button class="btn acc press">Open Transfer</button></div>`;
  document.body.appendChild(p); gel(p);
  p.querySelector('input').onchange = e => { S.settings.paused = !e.target.checked; p.querySelector('.live span').textContent = S.settings.paused ? 'Paused' : 'Live'; api.saveSettings(S.settings); chrome(); };
  p.querySelector('.ghost').onclick = () => { p.remove(); sweep(); };
  p.querySelector('.acc').onclick = () => p.remove();
};
$('dWall').onclick = () => $('wall').classList.toggle('blue');
$('dFile').onclick = () => api._simulate && api._simulate();

/* ---------- demo data (browser only) ---------- */
function demoApi() {
  const now = Date.now() / 1e3, H = 'C:/Users/nathan/';
  let id = 0; const hist = [];
  const mv = (src, name, line, mins, via = 'auto') => { hist.unshift({ id: ++id, ts: now - mins * 60, name, from: H + src + '/' + name, to: H + src + '/' + L(line).name + '/' + name, line, confidence: .95, reasons: [], undone: false, via }); return hist[0]; };
  [['Downloads', 'hyperpop_ref.mp3', 'audio', 64], ['Documents', 'Transfer essay draft.docx', 'docs', 40], ['Downloads', 'APBio_Lab7_rubric.pdf', 'docs', 21], ['Desktop', 'Minecraft Launcher.lnk', 'shortcuts', 15],
   ['Desktop', 'Screenshot 2026-11-01 142233.png', 'images', 9], ['Downloads', 'BlenderSetup-4.2.1-x64.msi', 'installers', 2], ['Downloads', 'IMG_4417.MOV', 'videos', 0]].forEach(a => mv(...a));
  let held = [
    { name: 'ffmpeg-7.1-win64.zip', path: H + 'Downloads/ffmpeg-7.1-win64.zip', guess: 'installers', confidence: .55, size: 78e6 },
    { name: 'sunflowers_puresky_4k.hdr', path: H + 'Downloads/sunflowers_puresky_4k.hdr', guess: 'holding', confidence: 0, size: 24e6 },
    { name: 'Infill_parcels_export', path: H + 'Documents/Infill_parcels_export', guess: 'docs', confidence: .48, size: 2.3e6 },
  ];
  let stale = [{ name: 'DiscordSetup.exe', path: H + 'Downloads/Installers/DiscordSetup.exe', age_days: 60, size: 96e6 }, { name: 'vlc-3.0.20-win64.exe', path: H + 'Downloads/Installers/vlc-3.0.20-win64.exe', age_days: 45, size: 42e6 }];
  const all = LINES.map(l => l.id);
  const settings = {
    theme: 'system',
    sources: [
      { path: H + 'Desktop', mode: 'auto', lines: all.slice() },
      { path: H + 'Downloads', mode: 'auto', lines: all.slice() },
      { path: H + 'Documents', mode: 'ask', lines: all.filter(x => x !== 'installers' && x !== 'shortcuts') },
    ],
    confidence: .6, stale_installer_days: 30, settle_secs: 8, paused: false, launch_at_login: true,
  };
  let pend = [['Downloads', 'edit_v3_final.mkv', 'videos'], ['Downloads', 'xc_meet_finish.mp4', 'videos'], ['Desktop', 'IMG_4420.MOV', 'videos'], ['Downloads', 'GoogleChrome.pkg', 'installers'],
    ['Desktop', 'untitled', 'images'], ['Desktop', 'ideas.txt', 'docs'], ['Documents', 'Spanish vocab unit 4.txt', 'docs'], ['Documents', 'renovated_render.png', 'images'], ['Documents', 'track_pr_tracker.csv', 'docs'], ['Documents', 'infill_grid.py', 'code']]
    .map(([s, n, l]) => ({ name: n, from: H + s + '/' + n, line: l, confidence: .9, reasons: [], size: 1000 }));
  const R = x => Promise.resolve(JSON.parse(JSON.stringify(x)));
  // what's already in each sorted folder (Shortcuts, Installers, Videos, Images, Audio, Docs, Archives, Code)
  const BASE = { Desktop: [39, 0, 2, 11, 0, 4, 1, 3], Downloads: [0, 84, 144, 63, 20, 16, 20, 19], Documents: [3, 0, 0, 6, 0, 41, 2, 7] };
  const EXTRA = [['xc_meet_finish.mp4', 'Downloads', 'videos', 3], ['IMG_4380.MOV', 'Downloads', 'videos', 6], ['DiscordSetup.exe', 'Downloads', 'installers', 60],
    ['Infill parcels v2.pdf', 'Documents', 'docs', 9], ['IMG_2201.HEIC', 'Desktop', 'images', 14], ['cover_art_final.png', 'Downloads', 'images', 21]];
  let dupes = [
    [{ name: 'IMG_4417.MOV', path: H + 'Downloads/Videos/IMG_4417.MOV', size: 412e6, modified: now - 60, line: 'videos' },
     { name: 'IMG_4417 (2).MOV', path: H + 'Downloads/Videos/IMG_4417 (2).MOV', size: 412e6, modified: now - 86400 * 3, line: 'videos' }],
    [{ name: 'APBio_Lab7_rubric.pdf', path: H + 'Downloads/Docs/APBio_Lab7_rubric.pdf', size: 1.2e6, modified: now - 1300, line: 'docs' },
     { name: 'APBio_Lab7_rubric.pdf', path: H + 'Documents/Docs/APBio_Lab7_rubric.pdf', size: 1.2e6, modified: now - 86400 * 2, line: 'docs' },
     { name: 'APBio_Lab7_rubric (1).pdf', path: H + 'Downloads/APBio_Lab7_rubric (1).pdf', size: 1.2e6, modified: now - 86400 * 4, line: null }],
  ];
  const scoped = src => pend.filter(m => {
    const s = settings.sources.find(x => within(m.from, x.path));
    return s && s.mode !== 'off' && s.lines.includes(m.line) && (!src || within(m.from, src));
  });
  let listener = null;
  const files = [['Downloads', 'Spotify Installer.exe', 'installers'], ['Downloads', 'track_meet_photos.zip', 'archives'], ['Desktop', 'Screenshot 2026-11-01 151002.png', 'images'], ['Downloads', 'lofi_loop.wav', 'audio']];
  let fi = 0;
  const api = {
    state: () => {
      const pending = {}; settings.sources.forEach(s => pending[s.path] = scoped(s.path).length);
      const tiles = {};
      settings.sources.forEach((s, si) => tiles[s.path] = LINES.map((l, li) => {
        const moved = hist.filter(e => !e.undone && within(e.to, s.path + '/' + l.name)).length;
        const base0 = BASE[base(s.path)] ? BASE[base(s.path)][li] : 0;
        return { line: l.id, path: s.path + '/' + l.name, count: base0 + moved, bytes: 0, exists: base0 + moved > 0 };
      }));
      return R({ stats: {}, history: hist, settings, held, stale, pending, tiles });
    },
    openPath: p => { toast(`Opens ${base(p)}${/\.[a-z0-9]+$/i.test(p) ? ' with its app' : ` in ${FILES}`}`); return R(null); },
    reveal: p => { toast(`Shows ${base(p)} in ${FILES}`); return R(null); },
    moveTo: (path, line) => {
      const e = hist.find(x => !x.undone && x.to === path); if (e) e.undone = true;
      const src = settings.sources.find(s => within(path, s.path));
      return R(mv(base(src.path), base(path), line, 0, 'correction'));
    },
    search: q => {
      const w = q.toLowerCase().split(/\s+/).filter(Boolean);
      const all = [...hist.filter(e => !e.undone).map(e => ({ name: e.name, path: e.to, size: 3.2e6, modified: e.ts, line: e.line })),
        ...EXTRA.map(([n, s, l, d]) => ({ name: n, path: H + s + '/' + L(l).name + '/' + n, size: 1.4e6 * (n.length % 7 + 1), modified: now - d * 86400, line: l }))];
      return R(all.filter(f => w.every(x => f.name.toLowerCase().includes(x))).slice(0, 60));
    },
    duplicates: () => new Promise(r => setTimeout(() => r(JSON.parse(JSON.stringify(dupes))), 700)),
    trashFiles: paths => { dupes = dupes.map(g => g.filter(f => !paths.includes(f.path))).filter(g => g.length > 1); return R(paths.length); },
    plan: src => R([{ source: src || H, moves: scoped(src), held: [], stale: [] }]),
    apply: src => { const m = scoped(src); pend = pend.filter(x => !m.includes(x)); return R(m.map(x => mv(parts(x.from).slice(-2)[0], x.name, x.line, 0, 'sweep'))); },
    undo: i => { const e = hist.find(x => x.id === i); e.undone = true; return R(e); },
    correct: (i, line) => { const e = hist.find(x => x.id === i); e.undone = true; return R(mv(parts(e.from).slice(-2)[0], e.name, line, 0, 'correction')); },
    route: (path, line) => { const h = held.find(x => x.path === path); held = held.filter(x => x !== h); return R(mv(parts(path).slice(-2)[0], h.name, line, 0, 'correction')); },
    trash: paths => { stale = stale.filter(s => !paths.includes(s.path)); return R(paths.length); },
    saveSettings: s => { Object.assign(settings, JSON.parse(JSON.stringify(s))); return R(true); },
    pickFolder: () => R(H + (fi % 2 ? 'Projects' : 'Pictures/Screenshots')),
    on: () => {},
    _simulate: async () => {
      const [s, n, l] = files[fi++ % files.length];
      const e = mv(s, n, l, 0); fresh.add(e.id); await load(); toast(`${n} › ${L(l).name}`, e.id);
    },
  };
  return api;
}
