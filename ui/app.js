/* ---------- line table (mirrors core/src/lines.rs) ---------- */
const LINES=[
 {id:'shortcuts',folder:'Shortcuts',letter:'S',color:'#0039A6'},
 {id:'installers',folder:'Installers',letter:'I',color:'#EE352E'},
 {id:'videos',folder:'Videos',letter:'V',color:'#FF6319'},
 {id:'images',folder:'Images',letter:'P',color:'#FCCC0A',ink:'#000'},
 {id:'audio',folder:'Audio',letter:'A',color:'#B933AD'},
 {id:'docs',folder:'Docs',letter:'D',color:'#00933C'},
 {id:'archives',folder:'Archives',letter:'Z',color:'#996633'},
 {id:'code',folder:'Code',letter:'C',color:'#6CBE45'},
];
const HOLD={id:'holding',folder:'Review',letter:'?',color:'#A7A9AC',ink:'#000'};
const L=id=>LINES.find(l=>l.id===id)||HOLD;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bullet=(id,cls='')=>{const l=L(id);return `<span class="bullet ${cls}" style="--c:${l.color};--ink:${l.ink||'#fff'}" aria-label="${l.folder}">${l.letter}</span>`};
const base=p=>p.split(/[\\/]/).pop();
const dirOf=p=>{const a=p.split(/[\\/]/);a.pop();return a.join('/')};
const srcName=p=>{const a=p.split(/[\\/]/);let i=a.length-2;if(i>0&&LINES.some(l=>l.folder===a[i]))i--;return a[i]||p};
const fmtSize=n=>n<1e3?n+' B':n<1e6?(n/1e3).toFixed(0)+' KB':n<1e9?(n/1e6).toFixed(1)+' MB':(n/1e9).toFixed(2)+' GB';
const ago=ts=>{const s=Math.max(0,Date.now()/1e3-ts);return s<60?'just now':s<3600?Math.floor(s/60)+' min ago':s<86400?Math.floor(s/3600)+' hr ago':Math.floor(s/86400)+' d ago'};
const pct=c=>Math.round(c*100)+'%';

/* ---------- bridge: Tauri when inside the app, demo engine otherwise ---------- */
const T=window.__TAURI__;
const api=T?{
  state:()=>T.core.invoke('get_state').then(JSON.parse),
  plan:()=>T.core.invoke('plan').then(JSON.parse),
  applyAll:()=>T.core.invoke('apply_all').then(JSON.parse),
  undo:id=>T.core.invoke('undo',{id}).then(JSON.parse),
  correct:(id,line)=>T.core.invoke('correct',{id,line}).then(JSON.parse),
  route:(path,line)=>T.core.invoke('route',{path,line}).then(JSON.parse),
  trash:paths=>T.core.invoke('trash',{paths}),
  saveSettings:s=>T.core.invoke('save_settings',{settings:s}),
  onMoved:cb=>T.event.listen('transfer://moved',e=>cb(JSON.parse(e.payload))),
}:demoApi();

function demoApi(){
  const now=Date.now()/1e3, H='/Users/nathan/';
  let id=0;const hist=[];
  const mv=(src,name,line,conf,why,minsAgo,via='auto')=>hist.unshift({id:++id,ts:now-minsAgo*60,name,from:H+src+'/'+name,to:H+src+'/'+L(line).folder+'/'+name,line,confidence:conf,reasons:why,undone:false,via});
  mv('Downloads','APBio_Lab7_rubric.pdf','docs',.90,['content: PDF','downloaded from canvas.instructure.com'],410);
  mv('Desktop','Minecraft Launcher.lnk','shortcuts',.99,['content: link/alias record'],400,'sweep');
  mv('Desktop','Steam.lnk','shortcuts',.99,['content: link/alias record'],400,'sweep');
  mv('Desktop','Roblox Studio.lnk','shortcuts',.99,['content: link/alias record'],400,'sweep');
  mv('Downloads','BlenderSetup-4.2.1-x64.msi','installers',.97,['content: Windows installer database','downloaded from blender.org'],260);
  mv('Downloads','Obsidian-1.7.4.dmg','installers',.97,['content: macOS disk image','downloaded from github.com'],190);
  mv('Downloads','hyperpop_ref.mp3','audio',.95,['content: audio stream'],150);
  mv('Downloads','kick_808.wav','audio',.95,['content: audio stream','matches your past sorting → Audio'],149);
  mv('Downloads','nexus-main.zip','code',.72,['content: compressed archive','looks like a source download','downloaded from codeload.github.com'],95);
  mv('Desktop','Screenshot 2026-11-01 at 12.40.12 PM.png','images',.95,['content: image data'],70);
  mv('Downloads','Cal Poly Pomona checklist.docx','docs',.95,['content: office document'],52);
  mv('Downloads','ZoomInstallerFull.exe','installers',.94,['content: program binary','name looks like a setup/version build','downloaded from zoom.us'],31);
  mv('Downloads','lecture_week6','videos',.96,['content: video stream'],18);
  mv('Downloads','IMG_4417.MOV','videos',.96,['content: video stream','downloaded from icloud.com'],9);
  mv('Downloads','xc_meet_finish.mp4','videos',.96,['content: video stream','downloaded from drive.google.com'],4);
  let held=[
    {name:'dataset.bin',path:H+'Downloads/dataset.bin',guess:'holding',confidence:0,reasons:['no readable signature','no extension hint'],size:5_000_000},
    {name:'ffmpeg-7.1-macos-arm64.tar.gz',path:H+'Downloads/ffmpeg-7.1-macos-arm64.tar.gz',guess:'installers',confidence:.55,reasons:['content: compressed archive','name looks like a release build','only 55% sure, holding for review'],size:78_400_000},
    {name:'Infill_parcels_export',path:H+'Documents/Infill_parcels_export',guess:'docs',confidence:.48,reasons:['unreadable content','downloaded from data.lacity.org','only 48% sure, holding for review'],size:2_300_000},
  ];
  let stale=[
    {name:'DiscordSetup.exe',path:H+'Downloads/Installers/DiscordSetup.exe',age_days:60,size:96_200_000},
    {name:'vlc-3.0.20-win64.exe',path:H+'Downloads/Installers/vlc-3.0.20-win64.exe',age_days:45,size:42_100_000},
    {name:'Unity Hub Setup.exe',path:H+'Downloads/Installers/Unity Hub Setup.exe',age_days:88,size:118_000_000},
    {name:'RobloxStudioInstaller.exe',path:H+'Downloads/Installers/RobloxStudioInstaller.exe',age_days:34,size:4_600_000},
  ];
  const settings={sources:[{path:H+'Desktop',enabled:true},{path:H+'Downloads',enabled:true},{path:H+'Documents',enabled:true}],confidence:.6,stale_installer_days:30,settle_secs:8,paused:false,launch_at_login:true};
  let learned=14;
  const stats=()=>{const per={};LINES.forEach(l=>per[l.id]=0);let today=0;const d0=new Date();d0.setHours(0,0,0,0);
    hist.filter(e=>!e.undone).forEach(e=>{per[e.line]++;if(e.ts*1e3>=d0)today++});return{per_line:per,today,total:hist.filter(e=>!e.undone).length+212,learned_examples:learned}};
  const pending=[
    {source:H+'Desktop',moves:[
      {name:'SMC Portal.url',from:H+'Desktop/SMC Portal.url',to:H+'Desktop/Shortcuts/SMC Portal.url',line:'shortcuts',confidence:.99,reasons:['content: link/alias record'],size:62},
      {name:'infill_grid.py',from:H+'Desktop/infill_grid.py',to:H+'Desktop/Code/infill_grid.py',line:'code',confidence:.91,reasons:['content: source code (86% code-like)'],size:1240},
      {name:'untitled',from:H+'Desktop/untitled',to:H+'Desktop/Images/untitled',line:'images',confidence:.95,reasons:['content: image data'],size:6010},
      {name:'ideas.txt',from:H+'Desktop/ideas.txt',to:H+'Desktop/Docs/ideas.txt',line:'docs',confidence:.82,reasons:['content: plain text / notes'],size:144}]},
    {source:H+'Downloads',moves:[
      {name:'edit_v3_final.mkv',from:H+'Downloads/edit_v3_final.mkv',to:H+'Downloads/Videos/edit_v3_final.mkv',line:'videos',confidence:.96,reasons:['content: video stream'],size:412_000_000},
      {name:'receipt.pdf',from:H+'Downloads/receipt.pdf',to:H+'Downloads/Images/receipt.pdf',line:'images',confidence:.95,reasons:['content: image data (named .pdf, actually a photo)'],size:4100},
      {name:'GoogleChrome.pkg',from:H+'Downloads/GoogleChrome.pkg',to:H+'Downloads/Installers/GoogleChrome.pkg',line:'installers',confidence:.97,reasons:['content: macOS installer package'],size:240_000_000},
      {name:'photos_from_coach.zip',from:H+'Downloads/photos_from_coach.zip',to:H+'Downloads/Archives/photos_from_coach.zip',line:'archives',confidence:.70,reasons:['content: compressed archive'],size:58_000_000}]},
    {source:H+'Documents',moves:[
      {name:'track_pr_tracker.csv',from:H+'Documents/track_pr_tracker.csv',to:H+'Documents/Docs/track_pr_tracker.csv',line:'docs',confidence:.82,reasons:['content: plain text / notes'],size:89},
      {name:'Topanga Tycoon.lnk',from:H+'Documents/Topanga Tycoon.lnk',to:H+'Documents/Shortcuts/Topanga Tycoon.lnk',line:'shortcuts',confidence:.99,reasons:['content: link/alias record'],size:320}]},
  ];
  let swept=false;
  const R=x=>Promise.resolve(JSON.parse(JSON.stringify(x)));
  let movedCb=null;
  // a new download "arrives" shortly after load, like the watcher would report
  setTimeout(()=>{mv('Downloads','Spotify Installer.exe','installers',.94,['content: program binary','name looks like a setup/version build','downloaded from spotify.com'],0);movedCb&&movedCb(hist[0])},6500);
  return{
    demo:true,
    state:()=>R({stats:stats(),history:hist,settings,held,stale,lines:LINES}),
    plan:()=>R(swept?pending.map(p=>({...p,moves:[]})):pending).then(p=>p.map((x,i)=>({...x,held:i===1?held:[],stale:i===1?stale:[],skipped:i===1?3:1}))),
    applyAll:()=>{const out=[];if(!swept){pending.forEach(p=>p.moves.forEach(m=>{mv(srcName(m.from),m.name,m.line,m.confidence,m.reasons,0,'sweep');out.push(hist[0])}));swept=true}return R(out)},
    undo:i=>{const e=hist.find(x=>x.id===i);e.undone=true;return R(e)},
    correct:(i,line)=>{const e=hist.find(x=>x.id===i);e.undone=true;mv(srcName(e.from),e.name,line,1,['you re-routed this'],0,'correction');learned++;return R(hist[0])},
    route:(path,line)=>{const h=held.find(x=>x.path===path);held=held.filter(x=>x!==h);mv(srcName(path),h.name,line,1,['you routed this'],0,'correction');learned++;return R(hist[0])},
    trash:paths=>{stale=stale.filter(s=>!paths.includes(s.path));return R(paths.length)},
    saveSettings:s=>{Object.assign(settings,s);return R(true)},
    onMoved:cb=>{movedCb=cb},
  };
}

/* ---------- state + routing ---------- */
let S=null, fresh=new Set(), histFilter='all';
const SCREENS=[
  {id:'service',label:'Service',small:'Live',c:'#6CBE45',b:'L'},
  {id:'review',label:'Review',small:'Held',c:'#A7A9AC',b:'?'},
  {id:'history',label:'History',small:'Moves',c:'#0039A6',b:'H'},
  {id:'cleanup',label:'Cleanup',small:'Installers',c:'#EE352E',b:'I'},
  {id:'prefs',label:'Settings',small:'Local only',c:'#8c8a84',b:'⚙'},
];
const cur=()=>{const h=location.hash.slice(1);return SCREENS.some(s=>s.id===h)?h:'service'};

async function load(){S=await api.state();render()}
function nav(){
  const counts={review:S.held.length,cleanup:S.stale.length,history:S.stats.total,service:S.stats.today};
  const val={service:`${counts.service} today`,review:counts.review?`${counts.review} waiting`:'Clear',history:`${counts.history}`,cleanup:counts.cleanup?`${counts.cleanup} stale`:'Clear',prefs:'Private'};
  document.getElementById('nav').innerHTML=SCREENS.map(s=>`<a class="chip" href="#${s.id}" style="--c:${s.c}" ${cur()===s.id?'aria-current="page"':''}>
    <span class="bullet" style="--c:${s.c};--ink:${s.c==='#A7A9AC'?'#000':'#fff'}">${s.b}</span><small>${s.label}</small><b>${val[s.id]}</b></a>`).join('');
  const p=S.settings.paused, n=S.settings.sources.filter(x=>x.enabled).length;
  document.getElementById('dot').classList.toggle('off',p);
  document.getElementById('ebtxt').textContent=p?'Paused · nothing will move':`Live · watching ${n} folder${n===1?'':'s'}`;
  document.getElementById('demoTag').hidden=!api.demo;
  const titles={service:'Everything is <em>on the line</em>',review:'A few files need <em>a stop</em>',history:'Every move, <em>reversible</em>',cleanup:'Old installers, <em>end of line</em>',prefs:'Runs here, <em>stays here</em>'};
  document.getElementById('hello').innerHTML=titles[cur()];
}
function render(){nav();({service,review,history,cleanup,prefs})[cur()]();}
addEventListener('hashchange',()=>{render();scrollTo(0,0)});
const tick=()=>{const d=new Date();let h=d.getHours()%12||12;document.getElementById('clock').innerHTML=`${h}:${String(d.getMinutes()).padStart(2,'0')}<small>${d.getHours()<12?'AM':'PM'}</small>`};tick();setInterval(tick,1000);

const V=()=>document.getElementById('view');
const panel=(c,title,sub,actions,body)=>`<section class="panel"><div class="ph" style="--c:${c}">${title[0]}<h2>${title[1]}</h2><span class="sub">${sub}</span><span class="sp"></span>${actions||''}</div><div class="pb">${body}</div></section>`;

/* ---------- Service ---------- */
function depRow(e,withActs=true){
  return `<div class="dep ${e.undone?'undone':''} ${fresh.has(e.id)?'fresh':''}" data-id="${e.id}">${bullet(e.line)}
   <div class="nm"><b title="${esc(e.from)}">${esc(e.name)}</b><span>→ ${esc(srcName(e.from))}/${esc(L(e.line).folder)} · ${esc(e.reasons[0]||'')}</span></div>
   <div class="meta">${pct(e.confidence)}<i>${ago(e.ts)}</i></div>
   ${withActs?`<div class="acts">${e.undone?'<span class="note">Undone</span>':`<button class="btn sm" data-undo="${e.id}">Undo</button><button class="btn sm" data-fix="${e.id}" aria-label="Re-route ${esc(e.name)}">Re-route</button>`}</div>`:''}</div>`;
}
function service(){
  const st=S.stats, max=Math.max(1,...Object.values(st.per_line));
  const srcs=S.settings.sources.map(s=>{
    const name=base(s.path), counts={};LINES.forEach(l=>counts[l.id]=0);
    S.history.filter(e=>!e.undone&&srcName(e.from)===name).forEach(e=>counts[e.line]++);
    return `<div class="station"><h3><small>${s.enabled?'Station':'Skipped'}</small>${esc(name)}</h3><div class="track">${LINES.map(l=>`<div class="stop ${counts[l.id]?'':'zero'}">${bullet(l.id,'sm')}<em>${counts[l.id]||'·'}</em></div>`).join('')}</div></div>`}).join('');
  V().innerHTML=`
   <div class="stats">
     <div class="stat"><small>Moved today</small><b>${st.today}</b></div>
     <div class="stat"><small>All time</small><b>${st.total}</b></div>
     <div class="stat"><small>Waiting for you</small><b>${S.held.length}</b></div>
     <div class="stat"><small>Learned from you</small><b>${st.learned_examples}</b></div>
   </div>
   <div class="grid2">
    ${panel('#6CBE45',[`<span class="bullet" style="--c:#6CBE45">L</span>`,'Arrivals'],'Newest first',`<button class="btn go" id="sweep">Sweep now</button>`,
      `<div class="board" id="board">${S.history.slice(0,9).map(e=>depRow(e)).join('')||'<div class="empty">Nothing has moved yet. New downloads will show up here.</div>'}</div>
       ${S.history.length>9?'<a class="btn" href="#history" style="align-self:flex-start">All moves →</a>':''}`)}
    ${panel('#0039A6',[`<span class="bullet" style="--c:#0039A6">M</span>`,'Route map'],'',`<button class="btn sm" id="pause">${S.settings.paused?'Resume':'Pause'}</button>`,
      `<div class="route">${srcs}</div>
       <div class="legend">${LINES.map(l=>`<div class="lg">${bullet(l.id,'sm')}<span>${l.folder}</span><em>${st.per_line[l.id]||0}</em></div>`).join('')}</div>
       <p class="note">Folders are made inside each source, so Downloads/Videos, Desktop/Shortcuts and so on. Files you already put in subfolders are never touched.</p>`)}
   </div>`;
  document.getElementById('sweep').onclick=sweep;
  document.getElementById('pause').onclick=async()=>{S.settings.paused=!S.settings.paused;await api.saveSettings(S.settings);toast(S.settings.paused?'Paused. Nothing will move.':'Live again.');render()};
}
V().addEventListener('click',async ev=>{
  const u=ev.target.closest('[data-undo]'),f=ev.target.closest('[data-fix]');
  if(u){const e=await api.undo(+u.dataset.undo);toast(`Put ${e.name} back`);await load()}
  if(f){reroute(+f.dataset.fix)}
});

/* sweep = dry run preview, then apply */
async function sweep(){
  const plans=await api.plan();const n=plans.reduce((a,p)=>a+p.moves.length,0);
  sheet(`<div class="ph" style="--c:#6CBE45"><span class="bullet" style="--c:#6CBE45">L</span><h2>Sweep preview</h2><span class="sub">Dry run · nothing has moved yet</span><span class="sp"></span><button class="btn" data-close>Cancel</button><button class="btn go" id="doit" ${n?'':'disabled'}>Move ${n} file${n===1?'':'s'}</button></div>
   <div class="pb">${plans.map(p=>`<div class="grp"><h4>${esc(base(p.source))} · ${p.moves.length} to move${p.held.length?` · ${p.held.length} held`:''}${p.stale.length?` · ${p.stale.length} stale installers`:''}</h4>
     ${p.moves.map(m=>`<div class="dep">${bullet(m.line)}<div class="nm"><b>${esc(m.name)}</b><span>→ ${esc(base(p.source))}/${esc(L(m.line).folder)} · ${esc(m.reasons[0])}</span></div><div class="meta">${pct(m.confidence)}<i>${fmtSize(m.size)}</i></div></div>`).join('')||'<p class="note">Already tidy.</p>'}</div>`).join('')}</div>`);
  document.getElementById('doit').onclick=async()=>{const moved=await api.applyAll();moved.forEach(e=>fresh.add(e.id));close_();toast(`Moved ${moved.length} files`);await load()};
}

/* re-route sheet */
function reroute(id){
  const e=S.history.find(x=>x.id===id);
  sheet(`<div class="ph" style="--c:${L(e.line).color}">${bullet(e.line)}<h2>Re-route</h2><span class="sub">${esc(e.name)}</span><span class="sp"></span><button class="btn" data-close>Cancel</button></div>
   <div class="pb"><p class="note">Pick the line it belongs on. Transfer moves it and learns from the choice, on this computer only.</p>
   <div class="picker">${LINES.filter(l=>l.id!==e.line).map(l=>`<button class="pick" style="--c:${l.color}" data-to="${l.id}">${bullet(l.id,'sm')}${l.folder}</button>`).join('')}</div></div>`);
  document.querySelectorAll('[data-to]').forEach(b=>b.onclick=async()=>{const n=await api.correct(id,b.dataset.to);fresh.add(n.id);close_();toast(`Moved to ${L(b.dataset.to).folder}. Noted for next time.`);await load()});
}

/* ---------- Review ---------- */
function review(){
  V().innerHTML=panel('#A7A9AC',[bullet('holding'),'Review'],'Not sure enough to move these on its own',
   '',S.held.length?`<div class="cards">${S.held.map((h,i)=>`<article class="card">
     <div style="display:flex;gap:10px;align-items:center">${bullet(h.guess)}<h3>${esc(h.name)}</h3></div>
     <div class="note">${esc(srcName(h.path))} · ${fmtSize(h.size)} · ${h.guess==='holding'?'no guess':'best guess '+L(h.guess).folder}</div>
     <div class="conf" style="--c:${L(h.guess).color}" title="Confidence ${pct(h.confidence)}"><i style="width:${Math.max(3,h.confidence*100)}%"></i></div>
     <ul class="why">${h.reasons.map(r=>`<li>${esc(r)}</li>`).join('')}</ul>
     <div class="picker" role="group" aria-label="Choose a line">${LINES.map(l=>`<button class="pick" style="--c:${l.color}" aria-pressed="${l.id===h.guess}" data-h="${i}" data-l="${l.id}">${bullet(l.id,'sm')}${l.folder}</button>`).join('')}</div>
     <div style="display:flex;gap:8px"><button class="btn go" data-go="${i}" ${h.guess==='holding'?'disabled':''}>Move to ${h.guess==='holding'?'…':L(h.guess).folder}</button><button class="btn" data-skip="${i}">Leave it</button></div>
   </article>`).join('')}</div><p class="note">Every choice here trains the local model. After about 60 corrections it carries roughly half the weight of the content rules.</p>`
   :'<div class="empty">Nothing waiting. Files Transfer is unsure about will wait here instead of being moved.</div>');
  V().querySelectorAll('[data-h]').forEach(b=>b.onclick=()=>{const h=S.held[+b.dataset.h];h.guess=b.dataset.l;review()});
  V().querySelectorAll('[data-go]').forEach(b=>b.onclick=async()=>{const h=S.held[+b.dataset.go];const e=await api.route(h.path,h.guess);fresh.add(e.id);toast(`${h.name} → ${L(h.guess).folder}`);await load()});
  V().querySelectorAll('[data-skip]').forEach(b=>b.onclick=()=>{S.held.splice(+b.dataset.skip,1);toast('Left in place');render()});
}

/* ---------- History ---------- */
function history(){
  const rows=S.history.filter(e=>histFilter==='all'||e.line===histFilter);
  V().innerHTML=panel('#0039A6',[`<span class="bullet" style="--c:#0039A6">H</span>`,'History'],`${S.history.length} moves logged on this computer`,'',
   `<div class="filters"><button class="pick" style="--c:#fff" aria-pressed="${histFilter==='all'}" data-f="all">All</button>${LINES.map(l=>`<button class="pick" style="--c:${l.color}" aria-pressed="${histFilter===l.id}" data-f="${l.id}">${bullet(l.id,'sm')}${l.folder}</button>`).join('')}</div>
    <div class="scroll"><table class="tbl"><thead><tr><th></th><th>File</th><th>From</th><th>Why</th><th>How</th><th class="num">Sure</th><th class="num">When</th><th></th></tr></thead><tbody>
    ${rows.map(e=>`<tr style="${e.undone?'opacity:.45':''}"><td>${bullet(e.line,'sm')}</td><td><b>${esc(e.name)}</b></td><td>${esc(srcName(e.from))}</td><td class="note">${esc(e.reasons.join(' · '))}</td><td>${esc(e.via)}</td><td class="num">${pct(e.confidence)}</td><td class="num">${ago(e.ts)}</td>
      <td>${e.undone?'<span class="note">Undone</span>':`<div class="acts"><button class="btn sm" data-undo="${e.id}">Undo</button><button class="btn sm" data-fix="${e.id}">Re-route</button></div>`}</td></tr>`).join('')}
    </tbody></table></div>${rows.length?'':'<div class="empty">No moves on this line yet.</div>'}`);
  V().querySelectorAll('[data-f]').forEach(b=>b.onclick=()=>{histFilter=b.dataset.f;history()});
}

/* ---------- Cleanup ---------- */
function cleanup(){
  const tot=S.stale.reduce((a,s)=>a+s.size,0);
  V().innerHTML=panel('#EE352E',[bullet('installers'),'Cleanup'],`Installers older than ${S.settings.stale_installer_days} days`,
   S.stale.length?`<button class="btn warn" id="trashAll">Move all to Trash · ${fmtSize(tot)}</button>`:'',
   S.stale.length?`<p class="note" style="margin:0">You've already installed these. They go to the ${navigator.platform.startsWith('Win')?'Recycle Bin':'Trash'}, so you can still get them back.</p>
    <div class="board">${S.stale.map(s=>`<div class="dep">${bullet('installers')}<div class="nm"><b>${esc(s.name)}</b><span>${esc(srcName(dirOf(s.path)+'/x'))}/Installers · last touched ${s.age_days} days ago</span></div><div class="meta">${fmtSize(s.size)}<i>${s.age_days} d</i></div><div class="acts"><button class="btn sm" data-t="${esc(s.path)}">Trash</button></div></div>`).join('')}</div>`
   :'<div class="empty">No stale installers. Nice.</div>');
  const confirmTrash=(paths,label)=>sheet(`<div class="ph" style="--c:#EE352E">${bullet('installers')}<h2>Move to Trash?</h2><span class="sub">${esc(label)}</span><span class="sp"></span></div>
     <div class="pb"><p style="margin:0">${paths.length} installer${paths.length>1?'s':''} will go to the Trash. Nothing is permanently deleted.</p><div style="display:flex;gap:8px"><button class="btn warn" id="yes">Move to Trash</button><button class="btn" data-close>Keep them</button></div></div>`,
     ()=>{document.getElementById('yes').onclick=async()=>{await api.trash(paths);close_();toast(`Moved ${paths.length} to Trash`);await load()}});
  const all=document.getElementById('trashAll');if(all)all.onclick=()=>confirmTrash(S.stale.map(s=>s.path),fmtSize(tot)+' total');
  V().querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>confirmTrash([b.dataset.t],base(b.dataset.t)));
}

/* ---------- Settings ---------- */
function prefs(){
  const s=S.settings;
  V().innerHTML=`<div class="grid2">
   ${panel('#8c8a84',[`<span class="bullet" style="--c:#3a3d45">⚙</span>`,'Settings'],'Saved on this computer','',
    `<div class="set"><span class="lbl">Folders to watch</span><p>Only loose files at the top level are sorted. Subfolders are yours.</p></div>
     ${s.sources.map((x,i)=>`<div class="src"><input type="checkbox" class="sw" id="src${i}" ${x.enabled?'checked':''} aria-label="Watch ${esc(base(x.path))}"><b>${esc(base(x.path))}</b><code>${esc(x.path)}</code></div>`).join('')}
     <div class="set"><label for="conf">Confidence to move</label><p>Below this, a file waits in Review instead of moving.</p><div class="ctl"><input type="range" id="conf" min="0.4" max="0.95" step="0.05" value="${s.confidence}"><b id="confv">${pct(s.confidence)}</b></div></div>
     <div class="set"><label for="stale">Flag installers after</label><p>Old setup files show up in Cleanup.</p><div class="ctl"><input type="range" id="stale" min="7" max="120" step="1" value="${s.stale_installer_days}"><b id="stalev">${s.stale_installer_days} d</b></div></div>
     <div class="set"><label for="settle">Wait before moving</label><p>A new file must sit still this long, so downloads in progress are never grabbed.</p><div class="ctl"><input type="range" id="settle" min="2" max="60" step="1" value="${s.settle_secs}"><b id="settlev">${s.settle_secs} s</b></div></div>
     <div class="set"><label for="login">Open at login</label><p>Runs quietly from the menu bar / system tray.</p><div class="ctl"><input type="checkbox" class="sw" id="login" ${s.launch_at_login?'checked':''}></div></div>`)}
   ${panel('#00933C',[`<span class="bullet" style="--c:#00933C">✓</span>`,'Privacy'],'What Transfer keeps','',
    `<p style="margin:0">Transfer reads the first 8 KB of a file to see what it is, decides, and forgets. It has no network code and no account. These three files in your app data folder are everything it stores:</p>
     <div class="files">
      <div class="file"><code>settings.txt</code><span>The choices on this screen.</span></div>
      <div class="file"><code>journal.tsv</code><span>Each move: from, to, when, why. Powers Undo.</span></div>
      <div class="file"><code>model.tsv</code><span>What it learned from your corrections, as hashed numbers. No names or words.</span></div>
     </div>
     <p class="note">Delete any of them to reset that part.</p>`)}
  </div>`;
  const save=async()=>{await api.saveSettings(S.settings)};
  s.sources.forEach((x,i)=>document.getElementById('src'+i).onchange=e=>{x.enabled=e.target.checked;save();nav()});
  const rng=(id,key,fmt,num=Number)=>{const el=document.getElementById(id);el.oninput=()=>{s[key]=num(el.value);document.getElementById(id+'v').textContent=fmt(s[key])};el.onchange=save};
  rng('conf','confidence',pct);rng('stale','stale_installer_days',v=>v+' d');rng('settle','settle_secs',v=>v+' s');
  document.getElementById('login').onchange=e=>{s.launch_at_login=e.target.checked;save()};
}

/* ---------- sheet + toast ---------- */
function sheet(html,after){
  const L_=document.getElementById('layer');
  L_.innerHTML=`<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  L_.querySelectorAll('[data-close]').forEach(b=>b.onclick=close_);
  document.getElementById('scrim').onclick=e=>{if(e.target.id==='scrim')close_()};
  after&&after();
  L_.querySelector('button')?.focus();
}
function close_(){document.getElementById('layer').innerHTML=''}
addEventListener('keydown',e=>{if(e.key==='Escape')close_()});
let tt;function toast(msg,undoId){
  document.querySelector('.toast')?.remove();clearTimeout(tt);
  const t=document.createElement('div');t.className='toast';t.setAttribute('role','status');
  t.innerHTML=`<span>${esc(msg)}</span>${undoId?`<button>Undo</button>`:''}`;
  document.body.appendChild(t);
  if(undoId)t.querySelector('button').onclick=async()=>{await api.undo(undoId);t.remove();await load()};
  tt=setTimeout(()=>t.remove(),4200);
}

api.onMoved(async e=>{fresh.add(e.id);await load();toast(`${e.name} → ${L(e.line).folder}`,e.id)});
if(T){T.event.listen('transfer://state',()=>load());T.event.listen('transfer://sweep',()=>{location.hash='service';sweep()})}
load();
