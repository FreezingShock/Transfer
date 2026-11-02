/* Tray popover: a small read-mostly view of the same engine. Left-click on the tray icon opens it;
   it hides itself when it loses focus. No logic lives here beyond drawing and four commands. */
const T = window.__TAURI__;
const LINES = { shortcuts: ['Shortcuts', '#5aa9ff'], installers: ['Installers', '#ff7a70'], videos: ['Videos', '#ffb340'], images: ['Images', '#ffd84d'],
  audio: ['Audio', '#d394ff'], docs: ['Docs', '#5be37d'], archives: ['Archives', '#d9bd94'], code: ['Code', '#7ee0ff'] };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const base = p => String(p).split(/[\\/]/).filter(Boolean).pop() || '';
const dirName = p => base(String(p).split(/[\\/]/).slice(0, -1).join('/'));
const ago = ts => { const s = Math.max(0, Date.now() / 1e3 - ts); return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd'; };
const mq = matchMedia('(prefers-color-scheme: dark)');
const call = (cmd, args) => T.core.invoke(cmd, args);
let S = null;

function theme() {
  const pref = (S && S.settings.theme) || 'system';
  document.documentElement.dataset.theme = pref === 'system' ? (mq.matches ? 'dark' : 'light') : pref;
}
function draw() {
  if (!S) return;
  theme();
  const paused = !!S.settings.paused;
  const live = S.history.filter(e => !e.undone);
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const today = live.filter(e => e.ts * 1e3 >= t0).length;
  const waiting = (S.held || []).length;
  const rows = live.slice(0, 4).map(e => { const l = LINES[e.line] || ['Review', '#c7c7cc'];
    return `<div class="row"><span class="ic" style="--lc:${l[1]}"><i></i></span><div class="txt"><b>${esc(e.name)}</b><span>${esc(dirName(e.from))} › ${l[0]}</span></div><span class="when">${ago(e.ts)}</span></div>`; }).join('');
  document.getElementById('pop').innerHTML = `
    <div class="ph"><b>Transfer</b><button class="live ${paused ? 'paused' : ''}" id="tPause" aria-pressed="${!paused}" title="${paused ? 'Resume sorting' : 'Pause sorting'}"><i></i><span>${paused ? 'Paused' : 'Live'}</span></button></div>
    <div class="num"><b>${today}</b><span>sorted today${waiting ? ` · ${waiting} to review` : ''}</span></div>
    <span class="label">Recent</span>
    <div class="list">${rows || '<div class="empty">Nothing moved yet. New files show up here.</div>'}</div>
    <div class="pb"><button class="btn ghost" id="tSweep">Sweep now</button><button class="btn acc" id="tOpen">Open Transfer</button></div>`;
  document.getElementById('tPause').onclick = async () => { await call('toggle_pause'); load(); };
  document.getElementById('tSweep').onclick = () => call('tray_action', { action: 'sweep' });
  document.getElementById('tOpen').onclick = () => call('tray_action', { action: 'open' });
}
async function load() { try { S = JSON.parse(await call('get_state')); draw(); } catch (e) { /* window may be mid-hide */ } }
if (T) {
  T.event.listen('transfer://moved', load);
  T.event.listen('transfer://state', load);
  addEventListener('focus', load);
  addEventListener('keydown', e => { if (e.key === 'Escape') call('tray_action', { action: 'close' }); });
  mq.addEventListener('change', theme);
  load();
}
