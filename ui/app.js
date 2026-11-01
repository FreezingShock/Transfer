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
if (/Windows/i.test(navigator.userAgent)) document.documentElement.classList.add('os-win');
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
  on: (ev, cb) => T.event.listen(ev, e => cb(e.payload)),
} : demoApi();

/* ---------- state ---------- */
let S = null, folder = null, query = '', openHeld = 0, openMove = null, trashAsk = false, shown = 0;
const fresh = new Set();
const TABS = [['home', 'Home'], ['review', 'Review'], ['history', 'History'], ['settings', 'Settings']];
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
  const sx = new Spring(0.86, 520, 0.6), sy = new Spring(0.6, 380, 0.78), y = new Spring(18, 420, 1);
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
      <span class="dot" style="opacity:${s.mode === 'off' ? .35 : 1}"></span>${esc(base(s.path))}</button>`).join('') +
    `<button class="add press" id="bAdd" aria-label="Add a folder">${svg(P.plus)}</button>`;
  if (fInd) f.prepend(fInd);
  moveInd(f, f.querySelector('[aria-pressed=true]'), animateInd);
  f.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { if ((b.dataset.f || null) === folder) return; folder = b.dataset.f || null; openHeld = 0; trashAsk = false; go('f'); });
  $('bAdd').onclick = addFolder;
  // tabs
  const held = S.held.filter(h => inScope(h.path)).length;
  const t = $('tabs');
  const tInd = t.querySelector('.ind');
  t.innerHTML = TABS.map(([id, label]) => `<a class="press" href="#${id}" aria-label="${label}${id === 'review' && held ? `, ${held} waiting` : ''}" ${cur() === id ? 'aria-current="page"' : ''}>${svg(P[id], 1.8)}${id === 'review' && held ? `<span class="badge">${held}</span>` : ''}</a>`).join('');
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

const row = (e, i, enter) => `<div class="row ${enter ? 'enter' : ''} ${fresh.has(e.id) ? 'fresh' : ''}" style="--i:${i}" data-row="${e.id}">
  ${icon(e.line)}
  <div class="txt"><b title="${esc(e.from)}">${esc(e.name)}</b><span>${esc(base(parts(e.from).slice(0, -1).join('/')))} › ${esc(L(e.line).name)}</span></div>
  <span class="when">${ago(e.ts)}</span>
  <button class="pill solid undo press" data-undo="${e.id}">Undo</button></div>`;

/* Home */
function home(el, enter) {
  const s = src();
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const live = S.history.filter(e => !e.undone && inScope(e.from));
  const today = live.filter(e => e.ts * 1e3 >= today0).length;
  const recent = live.slice(0, 6);
  const stale = S.stale.filter(x => inScope(x.path));
  let html = '';
  if (!s) {
    html += `<div class="head"><div style="display:flex;flex-direction:column;gap:2px"><span class="sub">Today, across ${sources().filter(x => x.mode !== 'off').length} folders</span>
      <div class="big"><b data-count="${today}">${today}</b><span>files sorted</span></div></div></div>
      <div class="cards">${sources().map(x => {
        const n = S.history.filter(e => !e.undone && within(e.from, x.path) && e.ts * 1e3 >= today0).length;
        return `<button class="fcard glass press" data-pick="${esc(x.path)}" style="--c:${colorOf(x)}"><span class="top2"><span class="dot"></span>${esc(base(x.path))}</span>
          <b>${n}</b><span class="mode">${MODES.find(m => m[0] === x.mode)[1]}</span></button>`;
      }).join('')}</div>`;
  } else {
    const waiting = s.mode === 'ask' ? (S.pending[s.path] || 0) : 0;
    html += `<div class="head"><div style="display:flex;flex-direction:column;gap:2px"><span class="h1">${esc(base(s.path))}</span>
      <span class="sub">${s.mode === 'off' ? 'Not watched' : `${today} sorted today`} · sorts into ${s.lines.length} types</span></div></div>
      <div class="seg glass small" id="modeSeg" role="group" aria-label="Mode">${MODES.map(([m, n]) => `<button class="press" data-mode="${m}" aria-pressed="${s.mode === m}">${n}</button>`).join('')}</div>
      ${waiting ? `<div class="banner">${svg(P.sparkle)}<span><b>${waiting} files</b> are ready to sort here.</span><button class="pill acc press" id="bBanner">Review sweep</button></div>` : ''}`;
  }
  html += recent.length ? `<div class="list">${recent.map((e, i) => row(e, i, enter)).join('')}</div>`
    : `<div class="empty">${svg(P.check, 1.6)}<span>${s && s.mode === 'off' ? 'Turn on Auto or Ask first to start sorting this folder.' : 'Nothing moved yet. New files show up here.'}</span></div>`;
  if (stale.length) {
    const sz = stale.reduce((a, x) => a + x.size, 0);
    html += `<div class="group glass"><div class="set">${icon('installers', 'sm')}<span class="grow">${stale.length} old installer${stale.length > 1 ? 's' : ''} · ${size(sz)}</span>
      <button class="pill ${trashAsk ? 'acc' : 'ghost'} press" id="bTrash">${trashAsk ? 'Move to Recycle Bin' : 'Clear'}</button></div></div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { folder = b.dataset.pick; go('f'); });
  const ms = el.querySelector('#modeSeg');
  if (ms) {
    requestAnimationFrame(() => moveInd(ms, ms.querySelector('[aria-pressed=true]'), false));
    ms.querySelectorAll('[data-mode]').forEach(b => b.onclick = async () => {
      s.mode = b.dataset.mode; ms.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', x === b));
      moveInd(ms, b); await api.saveSettings(S.settings);
      toast(s.mode === 'auto' ? `${base(s.path)} sorts itself as files arrive` : s.mode === 'ask' ? `${base(s.path)} waits for you to sweep` : `${base(s.path)} is left alone`);
      setTimeout(() => load(), 450);
    });
  }
  const bb = el.querySelector('#bBanner'); if (bb) bb.onclick = sweep;
  const t = el.querySelector('#bTrash');
  if (t) t.onclick = async () => {
    if (!trashAsk) { trashAsk = true; return redraw(); }
    await api.trash(stale.map(x => x.path)); trashAsk = false; toast(`Moved ${stale.length} installers to the Recycle Bin`); load();
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
  el.innerHTML = `<div class="head"><span class="h1">History</span><span class="sub">Tap a move to re-route it</span></div>
    <label class="search glass">${svg(P.search)}<input id="q" placeholder="Search moves" aria-label="Search moves" value="${esc(query)}"></label>
    ${Object.entries(groups).map(([k, es]) => `<div class="list"><span class="label" style="padding:4px 6px">${esc(k)}</span>${es.map(e => {
      const r = row(e, i++, enter).replace('<div class="row', `<div data-move="${e.id}" class="row`).replace('class="row', e.undone ? 'class="row" style="opacity:.45"' : 'class="row');
      return openMove === e.id ? `<div class="card glass" style="animation:rise .45s var(--spring)">${r}${picker(e.line)}</div>` : r;
    }).join('')}</div>`).join('') || `<div class="empty">${svg(P.search, 1.6)}<span>No moves match.</span></div>`}`;
  const qi = el.querySelector('#q');
  qi.oninput = () => { query = qi.value; const pos = qi.selectionStart; redraw(); const n = $('q'); n.focus(); n.setSelectionRange(pos, pos); };
  el.querySelectorAll('[data-move]').forEach(r => r.onclick = ev => { if (ev.target.closest('[data-undo]')) return; openMove = openMove === +r.dataset.move ? null : +r.dataset.move; redraw(); });
  el.querySelectorAll('[data-line]').forEach(b => b.onclick = async () => { const id = openMove; openMove = null; const e = await api.correct(id, b.dataset.line); fresh.add(e.id); toast(`Moved to ${L(b.dataset.line).name}. Noted for next time.`); load(); });
}

/* Settings */
function settings(el) {
  const s = S.settings;
  el.innerHTML = `<span class="h1" style="padding:0 4px">Settings</span>
    <div style="display:flex;flex-direction:column;gap:6px"><span class="label">Appearance</span>
      <div class="seg glass small" id="themeSeg" role="group" aria-label="Appearance">${[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([k, n]) => `<button class="press" data-theme-pick="${k}" aria-pressed="${(s.theme || 'system') === k}">${n}</button>`).join('')}</div></div>
    <div style="display:flex;flex-direction:column;gap:6px"><span class="label">Folders</span>
      <div class="group glass">${sources().map(x => `<button class="set press" data-edit="${esc(x.path)}" style="--c:${colorOf(x)}"><span class="dot"></span><span class="grow">${esc(base(x.path))}</span>
        <span class="val">${MODES.find(m => m[0] === x.mode)[1]}</span><span style="color:var(--fg3)">${svg(P.chevR)}</span></button>`).join('')}
        <button class="set press" id="bAdd2" style="color:var(--fg2)">${svg(P.plus)}<span class="grow">Add a folder</span></button></div></div>
    <div style="display:flex;flex-direction:column;gap:6px"><span class="label">Sorting</span>
      <div class="group glass">
        <label class="set"><span class="grow">Move when sure</span><input type="range" id="conf" min="40" max="95" step="5" value="${Math.round(s.confidence * 100)}"><output id="confO">${Math.round(s.confidence * 100)}%</output></label>
        <label class="set"><span class="grow">Wait before moving</span><input type="range" id="settle" min="2" max="60" value="${s.settle_secs}"><output id="settleO">${s.settle_secs} s</output></label>
        <label class="set"><span class="grow">Flag old installers</span><input type="range" id="stale" min="7" max="120" value="${s.stale_installer_days}"><output id="staleO">${s.stale_installer_days} d</output></label>
      </div></div>
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
  t.innerHTML = `<span>${esc(msg)}</span>${undoId ? '<button class="press">Undo</button>' : ''}`;
  $('win').appendChild(t); gel(t);
  if (undoId) t.querySelector('button').onclick = async () => { await api.undo(undoId); t.remove(); load(); };
  tt = setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 200); }, 3800);
}

/* window controls */
const W = T && T.window && T.window.getCurrentWindow ? T.window.getCurrentWindow() : null;
let onTop = false;
$('bClose').onclick = () => W && W.close();
$('bMin').onclick = () => W && W.minimize();
$('bTop').onclick = async () => { if (!W) return; onTop = !onTop; await W.setAlwaysOnTop(onTop); toast(onTop ? 'Staying on top' : 'Back to normal'); };

/* engine events */
if (T) {
  api.on('transfer://moved', async payload => { const e = JSON.parse(payload); fresh.add(e.id); await load(); toast(`${e.name} › ${L(e.line).name}`, e.id); });
  api.on('transfer://state', () => load());
  api.on('transfer://sweep', () => { location.hash = 'home'; sweep(); });
}
addEventListener('resize', () => chrome(false));
load('f');

/* prototype-only controls */
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
      return R({ stats: {}, history: hist, settings, held, stale, pending });
    },
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
