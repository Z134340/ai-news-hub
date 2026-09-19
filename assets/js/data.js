/* AI News Hub — data.js  資料載入、自動更新偵測 */

/* ======== AUTO-UPDATE (15 min) ======== */
let autoCheckTimer = null;
function startAutoCheck(){
  if (autoCheckTimer) return;
  autoCheckTimer = setInterval(async()=>{
    if(autoLock||HIST_VIEWING)return;autoLock=true;
    try{const j=await fetchJSON('data/latest.json?v='+Date.now(),8000);
      if(j.time&&j.time!==updateTime){const b=$('banners');if(!b.querySelector('.upd'))b.innerHTML=`<div class="banner upd" onclick="location.reload()"><span>📰 新資料已到，點擊重新載入</span></div>`+b.innerHTML;}
    }catch{}finally{autoLock=false}
  },15*60*1000);
}

/* ======== FETCH WITH TIMEOUT ======== */
async function fetchJSON(url, ms=10000, options={}) {
  const ctrl = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { ctrl.abort(); reject(new DOMException('載入逾時', 'AbortError')); }, ms); });
  try {
    return await Promise.race([timeout, (async () => {
      const r = await fetch(url, {...options, signal:ctrl.signal});
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    })()]);
  } finally { clearTimeout(timer); }
}

/* ======== LOAD DATA ======== */
async function loadData(){
  showSkeleton();
  try{
    const [dr,hr,sr]=await Promise.all([
      fetchJSON('data/latest.json?v='+Date.now(),10000),
      fetchJSON('data/health.json?v='+Date.now(),8000).catch(()=>null),
      fetchJSON('data/skills.json?v='+Date.now(),8000).catch(()=>null)
    ]);
    if (!dr || !dr.data || typeof dr.data !== 'object' || Array.isArray(dr.data)) throw new Error('invalid_news_data');
    // 舊封存早於企業生態系上線，缺少新 key 時以空陣列向後相容。
    if (!Array.isArray(dr.data.official_info)) dr.data.official_info = [];
    // AH-02 latest already contains the gate-selected skills; a side file cannot override it.
    if (!dr._update_outcome && sr && Array.isArray(sr.items)) {
      dr.data.skills = sr.items;
      dr.stats = {...(dr.stats||{}),skills:sr.items.length};
      dr._updated_at = {...(dr._updated_at||{}),skills:sr._updated_at||dr.time};
    }
    DATA=dr; HEALTH=hr; updateTime=DATA.time;
    renderAll(); updateHeader(); startAutoCheck();
    return true;
  }catch(e){
    const msg=e.name==='AbortError'?'載入逾時，請重新整理':'載入失敗，請重新整理';
    console.error(e);
    if ($('hPillText')) $('hPillText').textContent = '資料載入失敗';
    ['panel-papers','panel-skills',...NEWS_SUBS.map(s=>'sub-'+s.id),...ECOSYSTEM_SUBS.map(s=>'sub-'+s.id)].forEach(id => { const el = $(id); if (el) el.innerHTML=`<div class="empty">⚠️ ${msg}</div>`; });
    return false;
  }
}
