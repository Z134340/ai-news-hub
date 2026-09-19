/* AI News Hub — render.js  卡片渲染、排序、過濾、展開 */

/* ======== SKELETON ======== */
function showSkeleton() {
  const sk = Array(4).fill(`<div class="sk"><div class="sk-line h18 w70"></div><div class="sk-line w40"></div><div class="sk-line w70"></div></div>`).join('');
  ['panel-papers','sub-topnews','sub-taiwan','sub-china','sub-usa','sub-techtrends','sub-governance','sub-tutorials','sub-courses','sub-official_info','sub-models','panel-skills','panel-history'].forEach(id => $(id).innerHTML = sk);
}

/* ======== TOGGLE CARD ======== */
function toggleCard(key) {
  openCards[key] = !openCards[key];
  const el = document.querySelector(`[data-key="${key}"]`);
  if(!el) return;
  const det = el.querySelector('.card-detail');
  const chev = el.querySelector('.chev');
  if(det) det.style.display = openCards[key] ? 'block' : 'none';
  if(chev) chev.classList.toggle('open', openCards[key]);
}

/* ======== SORT / FILTER ======== */
function buildPriorityRegex(k) {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
  const latin = (k.latin || []).map(w => esc(w).replace(/ /g, '[\\s._-]'));
  const cjk = (k.cjk || []).map(esc).concat(k.cjkPatterns || []);
  return new RegExp('\\b(' + latin.join('|') + ')\\b|' + cjk.join('|'), 'i');
}
const PRIORITY_KW = buildPriorityRegex(PRIORITY_KEYWORDS);
function hasPriority(item) {
  const txt = [item.title,item.summary,item.model_name,item.field,item.domain,...(item.highlights||[]),...(item.advantages||[])].filter(Boolean).join(' ');
  return PRIORITY_KW.test(txt);
}
function filterRecent3M(arr) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 3);
  return arr.filter(item => {
    const d = item.date || item.release_date || '';
    if(!d) return true;
    return new Date(d.replace(/-XX/g,'-01')) >= cutoff;
  });
}

function sortByDate(arr, prioritize) {
  return [...arr].sort((a,b) => {
    if(prioritize) {
      const pa = hasPriority(a), pb = hasPriority(b);
      if(pa && !pb) return -1;
      if(!pa && pb) return 1;
    }
    const da = (a.date||a.release_date||'').replace(/-ongoing|ongoing/,'').replace(/-XX/g,'-01');
    const db = (b.date||b.release_date||'').replace(/-ongoing|ongoing/,'').replace(/-XX/g,'-01');
    return db.localeCompare(da);
  });
}

/* ======== RENDER ALL ======== */
function renderAll() {
  if(!DATA?.data) return;
  const d = DATA.data;
  renderPapers(sortByDate(d.papers||[], true));
  renderNewsPanel(sortByDate(d.topnews||[], true),'topnews','var(--ac)');
  renderNewsPanel(sortByDate(d.taiwan||[], true),'taiwan','var(--ac)');
  renderNewsPanel(sortByDate(d.china||[], true),'china','var(--ac)');
  renderNewsPanel(sortByDate(d.usa||[], true),'usa','var(--ac)');
  renderNewsPanel(sortByDate(d.techtrends||[], true),'techtrends','var(--ac)');

  renderNewsPanel(sortByDate(d.governance||[], true),'governance','var(--ac)');
  renderTutorials(sortByDate(filterRecent3M(d.tutorials||[])));
  renderCourses(sortByDate(filterRecent3M(d.courses||[])));
  renderOfficialInfo(sortByDate(d.official_info||[], true));
  renderModels(sortByDate(filterRecent3M(d.models||[]), true));
  renderSkills(d.skills||[]);

  // Counts
  SUBS.forEach(s => { const el=$('cnt-'+s.id); if(el) el.textContent=(d[s.id]||[]).length; });
  ECOSYSTEM_SUBS.forEach(s => { const el=$('cnt-'+s.id); if(el) el.textContent=(d[s.id]||[]).length; });
  updateTitle();
}

/* ═══════ PAPERS ═══════ */
function renderPapers(items) {
  if(!items.length){$('panel-papers').innerHTML='<div class="empty">📄 暫無論文</div>';return;}
  $('panel-papers').innerHTML = items.map((p,i) => {
    const k=`papers-${i}`, open=openCards[k]!==undefined?openCards[k]:i<3;
    if(openCards[k]===undefined) openCards[k]=i<3;
    const bid=itemKey(p); REGISTRY[bid]={cat:'papers',catLabel:'📄 論文',catColor:'var(--ac)',item:p};
    return `<div class="card" data-key="${k}" onclick="toggleCard('${k}')">
      <div class="card-row">
        ${rank(i+1)}
        <div class="card-body">
          <div class="card-head"><div><div class="card-title">${esc(p.title)}</div>${p.title_zh?`<div class="card-title-zh">${esc(p.title_zh)}</div>`:''}</div><div style="display:flex;align-items:center;gap:3px;flex-shrink:0">${p.verified === true?svg('check',14,'var(--green)'):p.verified === 'needs_review'?badge('var(--tx3)','待複核'):''}${cardActions(bid)}</div></div>
          <div class="card-badges">
            ${p.institution?badge('var(--ac)',svg('building',10)+' '+esc(p.institution)):''}
            ${p.venue?badge('var(--ac)',esc(p.venue)):''}
            ${p.field?badge('var(--green)',esc(p.field)):''}
            ${p.impact==='high'?badge('var(--amber)',svg('sparkles',10)+' 高影響力'):''}
            ${p.date?badge('var(--tx3)',esc(p.date)):''}
          </div>
        </div>
        <div class="chev${open?' open':''}">${svg('chev',16,'var(--tx3)')}</div>
      </div>
      <div class="card-detail" style="display:${open?'block':'none'}">
        ${p.authors?`<p class="authors">${svg('users',12)} ${esc(p.authors)}</p>`:''}
        <p class="summary">${esc(p.summary)}</p>
        ${linkOut(p.url,'查看論文')}
      </div>
    </div>`;
  }).join('');
}

/* ======== NEWS PANEL ======== */
function renderNewsPanel(items, key, color) {
  const el = $('sub-'+key);
  if(!items.length){el.innerHTML=`<div class="empty">📰 暫無新聞</div>`;return;}
  const catLabel = NEWS_LABELS[key]||key;
  el.innerHTML = items.map((n,i) => {
    const k=`${key}-${i}`, open=openCards[k]!==undefined?openCards[k]:i<3;
    if(openCards[k]===undefined) openCards[k]=i<3;
    const bid=itemKey(n); REGISTRY[bid]={cat:key,catLabel:catLabel,catColor:color,item:n};
    let tags = '';
    if(n.source) tags += badge('var(--tx2)', esc(n.source));
    if(n.category) tags += badge('var(--ac)', esc(n.category));
    if(n.domain) tags += badge('var(--ac)', esc(n.domain));
    if(n.model_area) tags += badge('var(--ac)', esc(n.model_area));
    if(n.topic) tags += badge('var(--ac)', svg('tag',10)+' '+esc(n.topic));
    if(n.company) tags += badge('var(--amber)', svg('building',10)+' '+esc(n.company));
    if(n.date) tags += badge('var(--tx3)', esc(n.date));

    return `<div class="card" data-key="${k}" onclick="toggleCard('${k}')">
      <div class="card-row">
        ${rank(i+1)}
        <div class="card-body">
          <div class="card-head"><div><div class="card-title">${esc(n.display_title||n.title)}</div>${n.title_zh?`<div class="card-title-zh">${esc(n.title_zh)}</div>`:''}</div><div style="display:flex;align-items:center;gap:3px;flex-shrink:0">${n.verified === true?svg('check',14,'var(--green)'):n.verified === 'needs_review'?badge('var(--tx3)','待複核'):''}${cardActions(bid)}</div></div>
          <div class="card-badges">${tags}</div>
        </div>
        <div class="chev${open?' open':''}">${svg('chev',16,'var(--tx3)')}</div>
      </div>
      <div class="card-detail" style="display:${open?'block':'none'}">
        <p class="summary">${esc(n.summary)}</p>
        ${infoBlock('sparkles', '關鍵亮點', n.highlights)}
        ${infoBlock('search', '關注原因', n.relevance)}
        ${infoBlock('globe', '討論焦點', n.discussion)}
        ${linkOut(n.url,'閱讀全文')}
      </div>
    </div>`;
  }).join('');
}

/* ======== TUTORIALS / COURSES / ENTERPRISE ECOSYSTEM ======== */
/* ═══════ TUTORIALS ═══════ */
function renderTutorials(items) {
  const el = $('sub-tutorials');
  if(!items.length){el.innerHTML='<div class="empty">🛠️ 暫無教學</div>';return;}
  el.innerHTML = items.map((t,i) => {
    const k=`tutorials-${i}`, open=openCards[k]!==undefined?openCards[k]:false;
    if(openCards[k]===undefined) openCards[k]=false;
    const bid=itemKey(t); REGISTRY[bid]={cat:'tutorials',catLabel:'🛠️ 工具教學',catColor:'var(--ac)',item:t};
    let tags = '';
    if(t.source) tags += badge('var(--tx2)', esc(t.source));
    if(t.tool_name) tags += badge('var(--ac)', svg('cpu',10)+' '+esc(t.tool_name));
    if(t.difficulty) tags += badge(t.difficulty==='beginner'?'var(--green)':t.difficulty==='intermediate'?'var(--amber)':'var(--red)', esc(t.difficulty==='beginner'?'入門':t.difficulty==='intermediate'?'進階':'高階'));
    if(t.category) tags += badge('var(--ac)', esc(t.category));
    if(t.date) tags += badge('var(--tx3)', esc(t.date));
    return `<div class="card" data-key="${k}" onclick="toggleCard('${k}')">
      <div class="card-row">
        ${rank(i+1)}
        <div class="card-body">
          <div class="card-head"><div><div class="card-title">${esc(t.display_title||t.title)}</div></div><div style="display:flex;align-items:center;gap:3px;flex-shrink:0">${t.verified === true?svg('check',14,'var(--green)'):t.verified === 'needs_review'?badge('var(--tx3)','待複核'):''}${cardActions(bid)}</div></div>
          <div class="card-badges">${tags}</div>
        </div>
        <div class="chev${open?' open':''}">${svg('chev',16,'var(--tx3)')}</div>
      </div>
      <div class="card-detail" style="display:${open?'block':'none'}">
        <p class="summary">${esc(t.summary)}</p>
        ${infoBlock('sparkles', '學習重點', t.highlights)}
        ${linkOut(t.url,'前往教學')}
      </div>
    </div>`;
  }).join('');
}

/* ═══════ COURSES ═══════ */
function renderCourses(items) {
  const el = $('sub-courses');
  if(!items.length){el.innerHTML='<div class="empty">🎓 暫無課程</div>';return;}
  el.innerHTML = items.map((c,i) => {
    const k=`courses-${i}`, open=openCards[k]!==undefined?openCards[k]:false;
    if(openCards[k]===undefined) openCards[k]=false;
    const bid=itemKey(c); REGISTRY[bid]={cat:'courses',catLabel:'🎓 課程',catColor:'var(--ac)',item:c};
    let tags = '';
    if(c.provider||c.source) tags += badge('var(--tx2)', esc(c.provider||c.source));
    if(c.is_free) tags += badge('var(--green)', '✓ 免費');
    if(c.cert_included) tags += badge('var(--amber)', svg('check',10)+' 含證書');
    if(c.level) tags += badge('var(--ac)', esc(c.level));
    if(c.duration) tags += badge('var(--tx3)', svg('clock',10)+' '+esc(c.duration));
    return `<div class="card" data-key="${k}" onclick="toggleCard('${k}')">
      <div class="card-row">
        ${rank(i+1)}
        <div class="card-body">
          <div class="card-head"><div><div class="card-title">${esc(c.display_title||c.title)}</div></div><div style="display:flex;align-items:center;gap:3px;flex-shrink:0">${c.verified === true?svg('check',14,'var(--green)'):c.verified === 'needs_review'?badge('var(--tx3)','待複核'):''}${cardActions(bid)}</div></div>
          <div class="card-badges">${tags}</div>
        </div>
        <div class="chev${open?' open':''}">${svg('chev',16,'var(--tx3)')}</div>
      </div>
      <div class="card-detail" style="display:${open?'block':'none'}">
        <p class="summary">${esc(c.summary)}</p>
        ${c.topics?infoBlock('tag', '課程主題', c.topics):''}
        ${infoBlock('sparkles', '課程亮點', c.highlights)}
        ${linkOut(c.url,'前往報名')}
      </div>
    </div>`;
  }).join('');
}

/* ═══════ OFFICIAL INFO ═══════ */
function renderOfficialInfo(items) {
  const el = $('sub-official_info');
  if(!items.length){el.innerHTML='<div class="empty">🏢 暫無企業官方資訊</div>';return;}
  el.innerHTML = items.map((n,i) => {
    const k=`official_info-${i}`, open=openCards[k]!==undefined?openCards[k]:i<3;
    if(openCards[k]===undefined) openCards[k]=i<3;
    const bid=itemKey(n); REGISTRY[bid]={cat:'official_info',catLabel:'🏢 官方資訊',catColor:'var(--ac)',item:n};
    return `<div class="card" data-key="${k}" onclick="toggleCard('${k}')">
      <div class="card-row">
        ${rank(i+1)}
        <div class="card-body">
          <div class="card-head"><div><div class="card-title">${esc(n.display_title||n.title)}</div></div><div style="display:flex;align-items:center;gap:3px;flex-shrink:0">${n.verified === true?svg('check',14,'var(--green)'):n.verified === 'needs_review'?badge('var(--tx3)','待複核'):''}${cardActions(bid)}</div></div>
          <div class="card-badges">
            ${n.company?badge('var(--ac)',svg('building',10)+' '+esc(n.company)):''}
            ${n.event_type?badge('var(--green)',esc(n.event_type)):''}
            ${n.official_source?badge('var(--tx2)','官方來源'):''}
            ${n.date?badge('var(--tx3)',esc(n.date)):''}
          </div>
        </div>
        <div class="chev${open?' open':''}">${svg('chev',16,'var(--tx3)')}</div>
      </div>
      <div class="card-detail" style="display:${open?'block':'none'}">
        <p class="summary">${esc(n.summary)}</p>
        ${infoBlock('sparkles', '關鍵亮點', n.highlights)}
        ${infoBlock('search', '影響分析', n.analysis)}
        ${linkOut(n.url||n.source_url,'查看官方資訊')}
      </div>
    </div>`;
  }).join('');
}

/* ═══════ MODELS ═══════ */
function renderModels(items) {
  if(!items.length){$('sub-models').innerHTML='<div class="empty">🚀 暫無模型發布</div>';return;}
  $('sub-models').innerHTML = items.map((m,i) => {
    const k=`models-${i}`, open=openCards[k]!==undefined?openCards[k]:i<3;
    if(openCards[k]===undefined) openCards[k]=i<3;
    const bid=itemKey(m); REGISTRY[bid]={cat:'models',catLabel:'🚀 模型',catColor:'var(--ac)',item:m};
    const name = m.model_name||m.title||'未命名模型';
    return `<div class="card" data-key="${k}" onclick="toggleCard('${k}')">
      <div class="card-row">
        ${rank(i+1)}
        <div class="card-body">
          <div class="card-head"><div><div class="card-title">${esc(name)} ${m.version?`<span style="font-size:12px;color:var(--tx3);font-weight:500">v${esc(m.version)}</span>`:''}</div></div><div style="display:flex;align-items:center;gap:3px;flex-shrink:0">${m.verified === true?svg('check',14,'var(--green)'):m.verified === 'needs_review'?badge('var(--tx3)','待複核'):''}${cardActions(bid)}</div></div>
          <div class="card-badges">
            ${m.institution?badge('var(--ac)',svg('building',10)+' '+esc(m.institution)):''}
            ${m.domain?badge('var(--ac)',svg('cpu',10)+' '+esc(m.domain)):''}
            ${m.release_status?badge('var(--green)',esc(m.release_status)):''}
            ${m.official_source?badge('var(--tx2)','官方來源'):''}
            ${m.release_date?badge('var(--tx3)',esc(m.release_date)):''}
          </div>
        </div>
        <div class="chev${open?' open':''}">${svg('chev',16,'var(--tx3)')}</div>
      </div>
      <div class="card-detail" style="display:${open?'block':'none'}">
        <p class="summary">${esc(m.summary)}</p>
        ${infoBlock('trophy', '核心優勢', m.advantages)}
        ${infoBlock('chart', '基準測試', m.benchmarks)}
        ${infoBlock('sparkles', '關鍵亮點', m.highlights)}
        ${infoBlock('alert', '限制與注意事項', m.limitations)}
        ${infoBlock('search', '影響分析', m.analysis)}
        ${linkOut(m.url||m.source_url,m.official_source?'查看官方發布':'查看詳情')}
      </div>
    </div>`;
  }).join('');
}

/* ═══════ HOT AGENT SKILLS ═══════ */
function renderSkills(items) {
  const el = $('panel-skills');
  const sorted = [...items].sort((a,b)=>(Number(b.stars)||0)-(Number(a.stars)||0) || String(a.title||'').localeCompare(String(b.title||'')));
  if(!sorted.length){el.innerHTML='<div class="empty">✨ 暫無熱門 Skills 資料</div>';return;}
  el.innerHTML = `<div class="skills-note">GitHub 星數為專案層級的人氣指標；本站先確認跨工具相容性、維護狀態與內容型態，再依星數排序。</div>` + sorted.map((s,i)=>{
    const k=`skills-${i}`, open=openCards[k]!==undefined?openCards[k]:i<3;
    if(openCards[k]===undefined) openCards[k]=i<3;
    const bid=itemKey(s); REGISTRY[bid]={cat:'skills',catLabel:'✨ Skills',catColor:'var(--ac)',item:s};
    const stars = Number.isFinite(Number(s.stars)) ? Number(s.stars).toLocaleString('en-US') : '—';
    return `<div class="card" data-key="${k}" onclick="toggleCard('${k}')">
      <div class="card-row">
        ${rank(i+1)}
        <div class="card-body">
          <div class="card-head"><div><div class="card-title">${esc(s.title||'未命名 Skill')}</div></div><div style="display:flex;align-items:center;gap:3px;flex-shrink:0">${cardActions(bid)}</div></div>
          <div class="card-badges">
            ${badge('var(--amber)',svg('sparkles',10)+' '+stars)}
            ${s.type?badge('var(--ac)',esc(s.type)):''}
            ${s.focus?badge('var(--green)',esc(s.focus)):''}
            ${s.license?badge('var(--tx3)',esc(s.license)):''}
          </div>
        </div>
        <div class="chev${open?' open':''}">${svg('chev',16,'var(--tx3)')}</div>
      </div>
      <div class="card-detail" style="display:${open?'block':'none'}">
        <p class="summary">${esc(s.summary)}</p>
        ${infoBlock('cpu','支援工具',s.tools)}
        ${s.date?`<p class="authors">最近維護：${esc(s.date)} · Forks ${esc(Number(s.forks||0).toLocaleString('en-US'))}</p>`:''}
        ${linkOut(s.url,'前往 GitHub')}
      </div>
    </div>`;
  }).join('');
}
