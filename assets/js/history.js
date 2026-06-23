/* AI News Hub — history.js  歷史紀錄載入（冷熱分層：近 7 天 static / 逾期 Firestore 冷封存） */

async function loadHistDate(date){
  try{
    // 先讀 static（熱層，近 7 天）
    const r = await fetch(`data/${date}.json?v=`+Date.now());
    let day = null;
    if(r.ok){ day = await r.json(); }
    else if(typeof archiveGet === 'function'){ day = await archiveGet(date); } // fallback：Firestore 冷封存
    if(!day){ console.warn('找不到該日資料：'+date); return; }
    if(!HIST_VIEWING) DATA_LATEST = DATA;
    DATA = day;
    HIST_VIEWING = date;
    renderAll(); updateHeader(); switchSec('papers');
    window.scrollTo({top:0,behavior:'smooth'});
  }catch(e){console.error(e)}
}

function backToLatest(){
  if(!DATA_LATEST) return;
  DATA = DATA_LATEST;
  DATA_LATEST = null;
  HIST_VIEWING = null;
  renderAll(); updateHeader(); switchSec('papers');
  window.scrollTo({top:0,behavior:'smooth'});
}

async function loadHistoryPanel(){
  const el=$('panel-history');
  el.innerHTML='<div class="empty">載入中...</div>';
  try{
    // 熱層：近 7 天 static index.json
    let hot = [];
    try{
      const r=await fetch('data/index.json?v='+Date.now());
      if(r.ok) hot = await r.json();
    }catch{}
    // 冷層：Firestore 封存（逾期）。未啟用 Firebase 時回傳 []，自動退回 static-only。
    let cold = [];
    if(typeof archiveList === 'function') cold = await archiveList();

    // 合併去重（同日以 static 熱層為準），日期新到舊
    const byDate = {};
    cold.forEach(e=>{ if(e.date) byDate[e.date] = {...e, _cold:true}; });
    hot.forEach(e=>{ if(e.date) byDate[e.date] = {...e, _cold:false}; });
    const entries = Object.values(byDate).sort((a,b)=>(b.date||'').localeCompare(a.date||''));

    if(!entries.length){el.innerHTML='<div class="empty">📅 無歷史資料</div>';return;}
    el.innerHTML=entries.map((e,i)=>{
      const cnt = e.item_count || (e.stats ? Object.values(e.stats).reduce((a,b)=>a+(typeof b==='number'?b:0),0) : 0);
      const pr  = e.validation_pass_rate ?? e.pass_rate ?? e.validation?.pass_rate ?? 0;
      return `<div class="card" style="cursor:pointer" onclick="loadHistDate('${e.date}')">
        <div class="card-row">
          ${rank(i+1,'#64748b')}
          <div class="card-body">
            <div class="card-head"><div class="card-title">${fmtDate(e.date)}</div></div>
            <div class="card-badges">
              ${badge('#34d399', cnt+' 筆新聞')}
              ${badge('#818cf8','驗證 '+pr+'%')}
              ${badge(e._cold?'#a78bfa':'#64748b', e._cold?'封存':(e.source||'自動'))}
            </div>
          </div>
          <div style="color:var(--ac);font-size:12px;font-weight:600;white-space:nowrap">載入 →</div>
        </div>
      </div>`;
    }).join('');
  }catch(err){console.error(err);el.innerHTML='<div class="empty">載入失敗</div>';}
}
