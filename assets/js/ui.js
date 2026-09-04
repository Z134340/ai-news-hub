/* AI News Hub — ui.js  tabs、header、title、sticky offsets */

/* ======== BUILD TABS / SWITCH SEC / SWITCH SUB ======== */
function buildTabs() {
  $('secTabs').innerHTML = SECS.map(s => `
    <button class="sec-tab${s.id===curSec?' on':''}" data-sec="${s.id}">
      <div class="ico-wrap" style="${s.id===curSec?`background:${s.grad}`:''}">${svg(s.ico, 14, s.id===curSec?'#fff':'var(--tx3)')}</div>
      <div class="s-label">${s.label}${s.id==='bookmarks'?`<span id="bm-tab-cnt" class="bm-cnt" style="display:none"></span>`:''}</div>
      <div class="s-desc">${s.desc}</div>
    </button>
  `).join('');
  $('secTabs').querySelectorAll('.sec-tab').forEach(b => b.addEventListener('click', () => switchSec(b.dataset.sec)));

  $('subTabs').innerHTML = SUBS.map(s => `
    <button class="sub-tab${s.id===curSub?' on':''}" data-sub="${s.id}" style="color:${s.id===curSub?s.color:'var(--tx3)'}">
      ${svg(s.ico, 14, s.id===curSub?s.color:'var(--tx3)')}
      <span class="st-label">${s.label}</span>
      <span class="sub-cnt" id="cnt-${s.id}" style="background:${s.color}20;color:${s.color}">0</span>
    </button>
  `).join('');
  $('subTabs').querySelectorAll('.sub-tab').forEach(b => b.addEventListener('click', () => switchSub(b.dataset.sub)));
}

function switchSec(id) {
  // Clear search state when switching sections
  if(srchActive) { srchActive=false; $('srchBar').style.display='none'; $('srchToggleBtn').classList.remove('on'); $('srchField').value=''; srchQuery=''; clearTimeout(srchTimer); updateStickyOffsets(); }
  curSec = id;
  document.querySelectorAll('.sec-tab').forEach(t => {
    const on = t.dataset.sec === id;
    t.classList.toggle('on', on);
    const s = SECS.find(x=>x.id===t.dataset.sec);
    t.querySelector('.ico-wrap').style.background = on ? s.grad : 'rgba(148,163,184,0.08)';
    t.querySelector('.ico-wrap').style.boxShadow = on ? '0 4px 14px rgba(99,102,241,0.25)' : 'none';
    t.querySelector('svg').setAttribute('stroke', on ? '#fff' : 'var(--tx3)');
  });
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('on', p.id === 'panel-'+id));
  $('subTabs').classList.toggle('vis', id==='news');
  if(id==='news') switchSub(curSub);
  if(id==='dashboard') loadDashboard();
  if(id==='history') loadHistoryPanel();
  if(id==='bookmarks') renderBookmarks();
  updateTitle();
}

function switchSub(id) {
  curSub = id;
  document.querySelectorAll('.sub-tab').forEach(t => {
    const on = t.dataset.sub===id;
    const s = SUBS.find(x=>x.id===t.dataset.sub);
    t.classList.toggle('on', on);
    t.style.color = on ? s.color : 'var(--tx3)';
    t.querySelector('svg').setAttribute('stroke', on?s.color:'var(--tx3)');
    if(on) requestAnimationFrame(()=>t.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'}));
  });
  document.querySelectorAll('.sub-panel').forEach(p => p.classList.toggle('on', p.id==='sub-'+id));
  updateTitle();
}

/* ======== UPDATE TITLE ======== */
function updateTitle() {
  const catId = curSec==='news'?curSub:curSec;
  if(curSec==='history'){$('secTitle').textContent=TITLES.history;$('secCount').textContent='';$('secUpdated').innerHTML='';return;}
  // 儀表板的資料不在 DATA.data 底下（它自己去抓 index.json 與 data/agent/*.json），
  // 落到下面的 DATA.data[catId] 只會拿到 undefined 並把筆數印成 0。
  if(curSec==='dashboard'){$('secTitle').textContent=TITLES.dashboard;$('secCount').textContent='';$('secUpdated').innerHTML='';return;}
  if(curSec==='bookmarks'||curSec==='search') return; // managed by their own render functions
  const items = DATA?.data?.[catId] || [];
  $('secTitle').textContent = TITLES[catId] || '';
  $('secCount').textContent = `共 ${items.length} 筆`;
  // Per-category update time
  const ts = DATA?._updated_at?.[catId] || DATA?.time || '';
  const timeStr = fmtCatTime(ts);
  const isWeekly = WEEKLY_SET.has(catId);
  const today = new Date().toISOString().slice(0,10);
  const tsDate = ts ? ts.slice(0,10) : '';
  const isOld = isWeekly && tsDate && tsDate !== today;
  $('secUpdated').innerHTML = timeStr
    ? `${svg('clock',11,'var(--tx3)')} 更新 ${timeStr}${isOld ? '（每週一更新）' : ''}`
    : '';
}

/* ======== UPDATE HEADER ======== */
function updateHeader() {
  if(!DATA) return;
  $('hDate').textContent = fmtDate(DATA.date);
  const vp = HEALTH?.validation_pass_rate ?? DATA?.validation?.pass_rate ?? 0;
  const today = new Date().toISOString().slice(0,10);
  const isToday = DATA.date === today;

  $('hPillText').textContent = isToday ? '資料就緒' : '非今日資料';
  const pill = $('hPill');
  if(isToday&&vp>=90){pill.className='hdr-pill ok';}
  else if(isToday){pill.className='hdr-pill ok';pill.style.background='rgba(251,191,36,0.12)';pill.style.color='#fbbf24';pill.style.borderColor='rgba(251,191,36,0.2)';}
  else{pill.className='hdr-pill ok';pill.style.background='rgba(248,113,113,0.12)';pill.style.color='#f87171';pill.style.borderColor='rgba(248,113,113,0.2)';}

  if(vp>0) $('hValidation').innerHTML = `${svg('shield',12,'#34d399')} 驗證 ${Math.round(vp)}%`;
  else $('hValidation').innerHTML = `${svg('shield',12,'#fbbf24')} 待驗證`;
  $('hTime').innerHTML = `${svg('clock',12)} 更新 ${fmtTime(DATA.time)}`;

  // Banners
  const b = $('banners'); b.innerHTML='';
  if(HIST_VIEWING) b.innerHTML += `<div class="banner info"><span>📅 正在檢視歷史資料：${esc(HIST_VIEWING)}</span><button class="banner-x" onclick="backToLatest()">返回今日</button></div>`;
  else if(!isToday) b.innerHTML += `<div class="banner warn"><span>⚠️ 今日資料尚未更新（上次：${esc(DATA.date)}），電腦上線後將自動補跑。</span><button class="banner-x" onclick="this.parentElement.remove()">×</button></div>`;
  if(HEALTH?.status==='missed') b.innerHTML += `<div class="banner err"><span>🔴 排程未執行，請確認電腦是否有開機。</span><button class="banner-x" onclick="this.parentElement.remove()">×</button></div>`;
  // S-PWR P-3：health.errors[0]（配額耗盡／電池模式回退）純文字一行，icon 用 svg
  const herr = Array.isArray(HEALTH?.errors) && HEALTH.errors.length ? String(HEALTH.errors[0]) : '';
  if(herr) b.innerHTML += `<div class="banner warn"><span>${svg('alert',14,'#fbbf24')} 上次擷取：${esc(herr)}</span><button class="banner-x" onclick="this.parentElement.remove()">×</button></div>`;
}

/* ======== STICKY OFFSETS ======== */
function updateStickyOffsets(){
  const hdr=document.querySelector('.hdr');
  const subT=$('subTabs');
  if(!hdr) return;
  const hH=hdr.offsetHeight;
  if(subT) subT.style.top=hH+'px';
}
window.addEventListener('resize',()=>{updateStickyOffsets();});
