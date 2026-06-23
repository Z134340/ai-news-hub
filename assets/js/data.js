/* AI News Hub — data.js  資料載入、自動更新偵測 */

/* ======== AUTO-UPDATE (15 min) ======== */
function startAutoCheck(){
  setInterval(async()=>{
    if(autoLock||HIST_VIEWING)return;autoLock=true;
    try{const r=await fetchT('data/latest.json?v='+Date.now(),8000);if(!r.ok)return;const j=await r.json();
      if(j.time&&j.time!==updateTime){const b=$('banners');if(!b.querySelector('.upd'))b.innerHTML=`<div class="banner upd" onclick="location.reload()"><span>📰 新資料已到，點擊重新載入</span></div>`+b.innerHTML;}
    }catch{}finally{autoLock=false}
  },15*60*1000);
}

/* ======== FETCH WITH TIMEOUT ======== */
function fetchT(url, ms=10000){
  const ctrl=new AbortController();
  const tid=setTimeout(()=>ctrl.abort(),ms);
  return fetch(url,{signal:ctrl.signal}).finally(()=>clearTimeout(tid));
}

/* ======== LOAD DATA ======== */
async function loadData(){
  showSkeleton();
  try{
    const [dr,hr]=await Promise.all([
      fetchT('data/latest.json?v='+Date.now(),10000),
      fetchT('data/health.json?v='+Date.now(),8000).then(r=>r.ok?r.json():null).catch(()=>null)
    ]);
    if(!dr.ok){$('panel-papers').innerHTML='<div class="empty">🕐 等待首次資料擷取</div>';return;}
    DATA=await dr.json(); HEALTH=hr; updateTime=DATA.time;
    renderAll(); updateHeader(); startAutoCheck();
  }catch(e){
    const msg=e.name==='AbortError'?'載入逾時，請重新整理':'載入失敗，請重新整理';
    console.error(e);$('panel-papers').innerHTML=`<div class="empty">⚠️ ${msg}</div>`;
  }
}
