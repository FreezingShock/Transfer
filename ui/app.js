/* Transfer UI: liquid glass, small window. Talks to the Rust engine through
   Tauri commands; in a plain browser it runs on demo data. */

/* ---------- lines (mirrors core/src/lines.rs) ---------- */
const P = {
  shortcuts: 'M7 17L17 7M9 7h8v8',
  installers: 'M12 3v12M8 11l4 4 4-4M5 20h14',
  videos: 'M4 6h11a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2zM17 10l5-3v10l-5-3',
  images: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9h.01',
  audio: 'M9 18V6l11-2v12M9 18a3 3 0 11-6 0 3 3 0 016 0zM20 16a3 3 0 11-6 0 3 3 0 016 0z',
  docs: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5M9 13h6M9 17h4',
  archives: 'M3 4h18v4H3zM5 8v11a1 1 0 001 1h12a1 1 0 001-1V8M10 12h4',
  code: 'M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14',
  holding: 'M9.5 9a2.5 2.5 0 115 .5c0 1.5-2.5 2-2.5 3.5M12 17h.01',
  home: 'M3 11l9-7 9 7M5 10v10h14V10',
  review: 'M4 13l2-8h12l2 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5',
  history: 'M12 7v5l3 2M21 12a9 9 0 11-9-9 9 9 0 019 9z',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 018 0v4',
  chevR: 'M9 6l6 6-6 6', chevD: 'M6 9l6 6 6-6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
};
const LINES = [
  { id: 'shortcuts', name: 'Shortcuts', tint: 'rgba(10,132,255,.85)', color: '#64a8ff' },
  { id: 'installers', name: 'Installers', tint: 'rgba(255,69,58,.85)', color: '#ff6b61' },
  { id: 'videos', name: 'Videos', tint: 'rgba(255,159,10,.85)', color: '#ffb340' },
  { id: 'images', name: 'Images', tint: 'rgba(255,204,0,.85)', color: '#ffd84d' },
  { id: 'audio', name: 'Audio', tint: 'rgba(191,90,242,.85)', color: '#d08cff' },
  { id: 'docs', name: 'Docs', tint: 'rgba(48,209,88,.8)', color: '#5be37d' },
  { id: 'archives', name: 'Archives', tint: 'rgba(172,142,104,.85)', color: '#d6b98f' },
  { id: 'code', name: 'Code', tint: 'rgba(100,210,255,.75)', color: '#7ee0ff' },
];
const HOLD = { id: 'holding', name: 'Review', tint: 'rgba(255,255,255,.16)', color: '#fff' };
const L = id => LINES.find(l => l.id === id) || HOLD;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svg = (d, stroke = '#fff', w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const icon = (id, cls = '') => `<span class="ic ${cls}" style="--t:${L(id).tint}">${svg(P[id] || P.holding)}</span>`;
const parts = p => p.split(/[\\/]/);
const base = p => parts(p).pop();
const srcOf = p => { const a = parts(p); let i = a.length - 2; if (i > 0 && LINES.some(l => l.name === a[i])) i--; return a[i] || p; };
const size = n => n < 1e3 ? n + ' B' : n < 1e6 ? Math.round(n / 1e3) + ' KB' : n < 1e9 ? (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + ' MB' : (n / 1e9).toFixed(1) + ' GB';
const ago = ts => { const s = Math.max(0, Date.now() / 1e3 - ts); return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd'; };

/* ---------- bridge ---------- */
const T = window.__TAURI__;
if (T) document.documentElement.classList.add('native'), document.body.classList.add('native');
const api = T ? {
  state: () => T.core.invoke('get_state').then(JSON.parse),
  plan: () => T.core.invoke('plan').then(JSON.parse),
  applyAll: () => T.core.invoke('apply_all').then(JSON.parse),
  undo: id => T.core.invoke('undo', { id }).then(JSON.parse),
  correct: (id, line) => T.core.invoke('correct', { id, line }).then(JSON.parse),
  route: (path, line) => T.core.invoke('route', { path, line }).then(JSON.parse),
  trash: paths => T.core.invoke('trash', { paths }),
  saveSettings: s => T.core.invoke('save_settings', { settings: s }),
  on: (ev, cb) => T.event.listen(ev, e => cb(e.payload)),
} : demoApi();

/* ---------- state ---------- */
let S = null, fresh = new Set(), query = '', openHeld = 0, openMove = null, trashAsk = false;
const TABS = [['home', 'Home'], ['review', 'Review'], ['history', 'History'], ['settings', 'Settings']];
const cur = () => { const h = location.hash.slice(1); return TABS.some(t => t[0] === h) ? h : 'home'; };
const $ = id => document.getElementById(id);

async function load() { S = await api.state(); render(); }
function render() {
  const p = S.settings.paused;
  $('topRight').innerHTML = cur() === 'home'
    ? `<button class="chip live ${p ? 'off' : ''}" id="bLive" aria-label="${p ? 'Resume sorting' : 'Pause sorting'}"><i></i>${p ? 'Paused' : 'Live'}</button>`
    : cur() === 'review' && S.held.length ? `<button class="chip live" id="bLeaveAll">Leave all</button>` : '';
  ({ home, review, history, settings })[cur()]();
  foot();
  const lv = $('bLive'); if (lv) lv.onclick = togglePause;
  const la = $('bLeaveAll'); if (la) la.onclick = () => { S.held = []; render(); };
}
addEventListener('hashchange', () => { openMove = null; trashAsk = false; render(); $('view').scrollTop = 0; });

function foot() {
  const n = S.held.length;
  $('foot').innerHTML = `<nav class="tabs chip" aria-label="Sections">${TABS.map(([id, label]) =>
    `<a href="#${id}" aria-label="${label}${id === 'review' && n ? `, ${n} waiting` : ''}" ${cur() === id ? 'aria-current="page"' : ''}>${svg(P[id], '#fff', 1.8)}${id === 'review' && n ? `<span class="badge">${n}</span>` : ''}</a>`).join('')}</nav>
    ${cur() === 'home' ? '<button class="btn solid" id="bSweep" style="padding:0 16px;height:38px;border-radius:19px">Sweep</button>' : ''}`;
  const sw = $('bSweep'); if (sw) sw.onclick = sweep;
}

/* ---------- Home ---------- */
function home() {
  const recent = S.history.filter(e => !e.undone).slice(0, 6);
  const stale = S.stale, staleSize = stale.reduce((a, s) => a + s.size, 0);
  $('view').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:2px">
      <span class="sub">Today</span>
      <div class="big"><b>${S.stats.today}</b><span>file${S.stats.today === 1 ? '' : 's'} sorted</span></div>
    </div>
    <div class="list">${recent.map(row).join('') || '<div class="empty">Nothing yet. New downloads and loose files will show up here.</div>'}</div>
    ${stale.length ? `<div class="group"><div class="set">${icon('installers', 'sm')}<span>${stale.length} old installer${stale.length > 1 ? 's' : ''} · ${size(staleSize)}</span>
      <button class="pill ${trashAsk ? 'solid' : 'ghost'}" id="bTrash">${trashAsk ? 'Move to Trash' : 'Clear'}</button></div></div>` : ''}`;
  const t = $('bTrash');
  if (t) t.onclick = async () => {
    if (!trashAsk) { trashAsk = true; return home(); }
    await api.trash(S.stale.map(s => s.path)); trashAsk = false;
    toast(`Moved ${S.stale.length} installers to the Recycle Bin`); load();
  };
}
function row(e) {
  return `<div class="row ${fresh.has(e.id) ? 'fresh' : ''} ${e.undone ? 'undone' : ''}">
    ${icon(e.line)}
    <div class="txt"><b title="${esc(e.from)}">${esc(e.name)}</b><span>${esc(srcOf(e.from))} › ${esc(L(e.line).name)}</span></div>
    <span class="when">${ago(e.ts)}</span>
    ${e.undone ? '' : `<button class="pill solid undo" data-undo="${e.id}">Undo</button>`}
  </div>`;
}

/* ---------- Review ---------- */
function review() {
  const H = S.held;
  if (!H.length) { $('view').innerHTML = `<span class="h1">Review</span><div class="empty">All clear. Files Transfer isn't sure about wait here instead of moving.</div>`; return; }
  openHeld = Math.min(openHeld, H.length - 1);
  const h = H[openHeld];
  if (!h._pick) h._pick = h.guess !== 'holding' ? h.guess : null;
  $('view').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:2px"><span class="h1">Review</span><span class="sub">Not sure enough to move these on its own.</span></div>
    <div class="card">
      <div style="display:flex;align-items:center;gap:11px">${icon(h._pick || 'holding')}
        <div class="txt"><b>${esc(h.name)}</b><span>${esc(srcOf(h.path))} · ${size(h.size)} · ${h.guess === 'holding' ? 'no guess' : Math.round(h.confidence * 100) + '% sure'}</span></div></div>
      ${picker(h._pick)}
      <div style="display:flex;gap:8px">
        <button class="btn ghost" style="flex:1" id="bLeave">Leave it</button>
        <button class="btn solid" style="flex:1.6" id="bGo" ${h._pick ? '' : 'disabled'}>${h._pick ? 'Move to ' + L(h._pick).name : 'Pick a folder'}</button>
      </div>
    </div>
    <div class="list">${H.map((x, i) => i === openHeld ? '' : `<button class="row" data-open="${i}">${icon('holding')}
      <div class="txt"><b>${esc(x.name)}</b><span>${esc(srcOf(x.path))} · ${x.guess === 'holding' ? 'no guess' : 'maybe ' + L(x.guess).name}</span></div>${svg(P.chevR, 'rgba(255,255,255,.6)', 2)}</button>`).join('')}</div>`;
  bindPicker(l => { h._pick = l; review(); });
  $('bLeave').onclick = () => { H.splice(openHeld, 1); render(); };
  $('bGo').onclick = async () => { const e = await api.route(h.path, h._pick); fresh.add(e.id); H.splice(openHeld, 1); toast(`${h.name} › ${L(h._pick).name}`, e.id); load(); };
  document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { openHeld = +b.dataset.open; review(); });
}
function picker(sel) {
  return `<div class="grid" role="group" aria-label="Move to">${LINES.map(l =>
    `<button data-line="${l.id}" aria-pressed="${l.id === sel}">${svg(P[l.id], l.color)}${l.name}</button>`).join('')}</div>`;
}
function bindPicker(fn) { document.querySelectorAll('[data-line]').forEach(b => b.onclick = () => fn(b.dataset.line)); }

/* ---------- History ---------- */
function history() {
  const q = query.toLowerCase();
  const rows = S.history.filter(e => !q || e.name.toLowerCase().includes(q));
  const groups = {};
  rows.forEach(e => { const d = new Date(e.ts * 1e3); const k = d.toDateString() === new Date().toDateString() ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }); (groups[k] = groups[k] || []).push(e); });
  $('view').innerHTML = `
    <div style="display:flex;align-items:baseline;justify-content:space-between"><span class="h1">History</span><span class="sub">Every move can be undone</span></div>
    <label class="search chip">${svg(P.search, 'rgba(255,255,255,.7)')}<input id="q" placeholder="Search moves" aria-label="Search moves" value="${esc(query)}"></label>
    ${Object.entries(groups).map(([k, es]) => `<div class="list"><span class="label" style="padding:4px 6px">${esc(k)}</span>${es.map(e =>
      openMove === e.id ? `<div class="card">${row(e)}${picker(e.line)}</div>` : row(e).replace('<div class="row', `<div data-move="${e.id}" class="row`)).join('')}</div>`).join('')
    || '<div class="empty">No moves match.</div>'}`;
  const qi = $('q'); qi.oninput = () => { query = qi.value; const pos = qi.selectionStart; history(); const n = $('q'); n.focus(); n.setSelectionRange(pos, pos); };
  document.querySelectorAll('[data-move]').forEach(r => r.onclick = ev => { if (ev.target.closest('[data-undo]')) return; openMove = +r.dataset.move; history(); });
  bindPicker(async l => { const id = openMove; openMove = null; const e = await api.correct(id, l); fresh.add(e.id); toast(`Moved to ${L(l).name}. Noted for next time.`); load(); });
}

/* ---------- Settings ---------- */
function settings() {
  const s = S.settings;
  $('view').innerHTML = `
    <span class="h1">Settings</span>
    <div style="display:flex;flex-direction:column;gap:6px"><span class="label">Watching</span>
      <div class="group">${s.sources.map((x, i) => `<label class="set"><span>${esc(base(x.path))}</span><input type="checkbox" class="sw" id="src${i}" ${x.enabled ? 'checked' : ''}></label>`).join('')}</div></div>
    <div style="display:flex;flex-direction:column;gap:6px"><span class="label">Sorting</span>
      <div class="group">
        <label class="set"><span>Move when sure</span><input type="range" id="conf" min="40" max="95" step="5" value="${Math.round(s.confidence * 100)}"><output id="confO">${Math.round(s.confidence * 100)}%</output></label>
        <label class="set"><span>Wait before moving</span><input type="range" id="settle" min="2" max="60" value="${s.settle_secs}"><output id="settleO">${s.settle_secs} s</output></label>
        <label class="set"><span>Flag old installers</span><input type="range" id="stale" min="7" max="120" value="${s.stale_installer_days}"><output id="staleO">${s.stale_installer_days} d</output></label>
      </div></div>
    <div class="group"><label class="set"><span>Open at login</span><input type="checkbox" class="sw" id="login" ${s.launch_at_login ? 'checked' : ''}></label></div>
    <div class="note">${svg(P.lock, 'currentColor')}<span>Runs only on this computer. Nothing is uploaded.</span></div>`;
  const save = () => api.saveSettings(s);
  s.sources.forEach((x, i) => $('src' + i).onchange = e => { x.enabled = e.target.checked; save(); });
  const rng = (id, set, fmt) => { const el = $(id); el.oninput = () => { set(+el.value); $(id + 'O').textContent = fmt(+el.value); }; el.onchange = save; };
  rng('conf', v => s.confidence = v / 100, v => v + '%');
  rng('settle', v => s.settle_secs = v, v => v + ' s');
  rng('stale', v => s.stale_installer_days = v, v => v + ' d');
  $('login').onchange = e => { s.launch_at_login = e.target.checked; save(); };
}

/* ---------- Sweep (dry run first) ---------- */
async function sweep() {
  const plans = await api.plan();
  const moves = plans.flatMap(p => p.moves);
  const by = {}; moves.forEach(m => (by[m.line] = by[m.line] || []).push(m));
  const order = LINES.filter(l => by[l.id]);
  let open = order[0] && order[0].id;
  $('view').style.visibility = $('foot').style.visibility = $('topRight').style.visibility = 'hidden';
  const draw = () => {
    $('layer').innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Sweep">
      <div style="display:flex;flex-direction:column;gap:2px"><span class="h1">Sweep</span>
        <span class="sub">${moves.length ? `${moves.length} loose file${moves.length > 1 ? 's are' : ' is'} ready. Nothing has moved yet.` : 'Everything is already sorted.'}</span></div>
      <div class="body">${order.length ? `<div class="group">${order.map(l => `<div>
        <button class="set" style="width:100%" data-g="${l.id}">${icon(l.id, 'sm')}<span style="text-align:left">${l.name}</span><output>${by[l.id].length}</output>${svg(open === l.id ? P.chevD : P.chevR, 'rgba(255,255,255,.6)', 2.4).replace('<svg', '<svg style="width:12px;height:12px"')}</button>
        ${open === l.id ? `<div style="display:flex;flex-direction:column;gap:3px;padding:0 12px 10px 48px">${by[l.id].map(m => `<div style="display:flex;gap:8px;font-size:12px"><span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.name)}</span><span style="color:var(--fg-3)">${esc(srcOf(m.from))}</span></div>`).join('')}</div>` : ''}
      </div>`).join('')}</div>` : ''}</div>
      <div style="display:flex;gap:8px"><button class="btn ghost" style="flex:1" id="sNo">${moves.length ? 'Cancel' : 'Close'}</button>
        ${moves.length ? `<button class="btn solid" style="flex:1.4" id="sYes">Move ${moves.length} file${moves.length > 1 ? 's' : ''}</button>` : ''}</div></div>`;
    document.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { open = open === b.dataset.g ? null : b.dataset.g; draw(); });
    $('sNo').onclick = closeSheet;
    const y = $('sYes'); if (y) y.onclick = async () => { y.disabled = true; const done = await api.applyAll(); done.forEach(e => fresh.add(e.id)); closeSheet(); toast(`Moved ${done.length} file${done.length === 1 ? '' : 's'}`); load(); };
  };
  draw();
}
function closeSheet() { $('layer').innerHTML = ''; $('view').style.visibility = $('foot').style.visibility = $('topRight').style.visibility = ''; }
addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

/* ---------- shared actions ---------- */
async function togglePause() { S.settings.paused = !S.settings.paused; await api.saveSettings(S.settings); render(); }
$('view').addEventListener('click', async ev => {
  const u = ev.target.closest('[data-undo]'); if (!u) return;
  ev.stopPropagation(); const e = await api.undo(+u.dataset.undo); toast(`Put ${e.name} back`); load();
});
let tt;
function toast(msg, undoId) {
  document.querySelector('.toast')?.remove(); clearTimeout(tt);
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status');
  t.innerHTML = `<span>${esc(msg)}</span>${undoId ? '<button class="pill ghost">Undo</button>' : ''}`;
  $('win').appendChild(t);
  if (undoId) t.querySelector('button').onclick = async () => { await api.undo(undoId); t.remove(); load(); };
  tt = setTimeout(() => t.remove(), 4000);
}

/* ---------- window controls ---------- */
const W = T && T.window && T.window.getCurrentWindow ? T.window.getCurrentWindow() : null;
let onTop = false;
$('bClose').onclick = () => W ? W.close() : null;
$('bMin').onclick = () => W ? W.minimize() : null;
$('bTop').onclick = async () => { if (!W) return; onTop = !onTop; await W.setAlwaysOnTop(onTop); toast(onTop ? 'Staying on top' : 'Back to normal'); };

/* ---------- live events from the engine ---------- */
if (T) {
  api.on('transfer://moved', async payload => { const e = JSON.parse(payload); fresh.add(e.id); await load(); toast(`${e.name} › ${L(e.line).name}`, e.id); });
  api.on('transfer://state', () => load());
  api.on('transfer://sweep', () => { location.hash = 'home'; sweep(); });
}
load();

/* ---------- demo data (browser only) ---------- */
function demoApi() {
  const now = Date.now() / 1e3, H = 'C:/Users/nathan/';
  let id = 0; const hist = [];
  const mv = (src, name, line, mins, via = 'auto') => hist.unshift({ id: ++id, ts: now - mins * 60, name, from: H + src + '/' + name, to: H + src + '/' + L(line).name + '/' + name, line, confidence: .95, reasons: [], undone: false, via });
  mv('Downloads', 'hyperpop_ref.mp3', 'audio', 64); mv('Downloads', 'APBio_Lab7_rubric.pdf', 'docs', 21);
  mv('Desktop', 'Screenshot 2026-11-01 142233.png', 'images', 9); mv('Downloads', 'BlenderSetup-4.2.1-x64.msi', 'installers', 2);
  mv('Downloads', 'IMG_4417.MOV', 'videos', 0);
  let held = [
    { name: 'ffmpeg-7.1-win64.zip', path: H + 'Downloads/ffmpeg-7.1-win64.zip', guess: 'installers', confidence: .55, size: 78e6 },
    { name: 'dataset.bin', path: H + 'Downloads/dataset.bin', guess: 'holding', confidence: 0, size: 5e6 },
    { name: 'Infill_parcels_export', path: H + 'Documents/Infill_parcels_export', guess: 'docs', confidence: .48, size: 2.3e6 },
  ];
  let stale = [{ name: 'DiscordSetup.exe', path: H + 'Downloads/Installers/DiscordSetup.exe', age_days: 60, size: 96e6 }, { name: 'vlc-3.0.20-win64.exe', path: H + 'Downloads/Installers/vlc-3.0.20-win64.exe', age_days: 45, size: 42e6 }];
  const settings = { sources: ['Desktop', 'Downloads', 'Documents'].map(n => ({ path: H + n, enabled: n !== 'Documents' })), confidence: .6, stale_installer_days: 30, settle_secs: 8, paused: false, launch_at_login: true };
  const pending = [['Downloads', 'edit_v3_final.mkv', 'videos'], ['Downloads', 'xc_meet_finish.mp4', 'videos'], ['Desktop', 'IMG_4420.MOV', 'videos'], ['Downloads', 'GoogleChrome.pkg', 'installers'], ['Desktop', 'untitled', 'images'], ['Desktop', 'ideas.txt', 'docs'], ['Desktop', 'SMC Portal.url', 'shortcuts']]
    .map(([s, n, l]) => ({ name: n, from: H + s + '/' + n, to: '', line: l, confidence: .9, reasons: [], size: 1000 }));
  let swept = false;
  const R = x => Promise.resolve(JSON.parse(JSON.stringify(x)));
  return {
    state: () => R({ stats: { today: hist.filter(e => !e.undone).length + 406, total: 0, learned_examples: 0 }, history: hist, settings, held, stale }),
    plan: () => R([{ source: H, moves: swept ? [] : pending, held: [], stale: [] }]),
    applyAll: () => { const out = []; if (!swept) { pending.forEach(m => { mv(srcOf(m.from), m.name, m.line, 0, 'sweep'); out.push(hist[0]); }); swept = true; } return R(out); },
    undo: i => { const e = hist.find(x => x.id === i); e.undone = true; return R(e); },
    correct: (i, line) => { const e = hist.find(x => x.id === i); e.undone = true; mv(srcOf(e.from), e.name, line, 0, 'correction'); return R(hist[0]); },
    route: (path, line) => { const h = held.find(x => x.path === path); held = held.filter(x => x !== h); mv(srcOf(path), h.name, line, 0, 'correction'); return R(hist[0]); },
    trash: paths => { stale = stale.filter(s => !paths.includes(s.path)); return R(paths.length); },
    saveSettings: s => { Object.assign(settings, s); return R(true); },
    on: () => {},
  };
}
