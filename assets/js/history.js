/* Paginated summary reads; daily payload is fetched only when selected. */
let HISTORY = {request:0, entries:{}, next:null, loading:false, message:''};
async function loadHistDate(date) {
  if (!archiveDate(date)) return;
  try {
    let day = await fetchJSON(`data/${date}.json?v=${Date.now()}`,8000).catch(()=>null);
    if (!day) day = await archiveGet(date);
    if (!day || !plainRecord(day.data)) { personalNotice('該日資料暫時無法載入，請稍後重試。'); return; }
    if (!HIST_VIEWING) DATA_LATEST = DATA;
    DATA = day; HIST_VIEWING = date;
    renderAll(); updateHeader(); switchSec('papers'); window.scrollTo({top:0,behavior:'smooth'});
  } catch(e) { console.error(e); personalNotice('歷史資料載入失敗，請稍後重試。'); }
}
async function backToLatest() {
  if (!DATA_LATEST) {
    const previous = DATA, date = HIST_VIEWING;
    HIST_VIEWING = null;
    if (!await loadData()) {
      DATA = previous; HIST_VIEWING = date; renderAll(); updateHeader();
      personalNotice('最新資料暫時無法載入，保留目前歷史內容。');
    }
    return;
  }
  DATA = DATA_LATEST; DATA_LATEST = null; HIST_VIEWING = null;
  renderAll(); updateHeader(); switchSec('papers'); window.scrollTo({top:0,behavior:'smooth'});
}
async function loadHistoryPanel() {
  const request = HISTORY.request + 1;
  HISTORY = {request, entries:{}, next:null, loading:false, message:'封存清單載入中…'};
  $('panel-history').innerHTML = '<div class="empty">載入中…</div>';
  const hot = await fetchJSON('data/index.json?v='+Date.now(),8000).catch(()=>[]);
  if (request !== HISTORY.request) return;
  (Array.isArray(hot) ? hot : []).forEach(e => { if (e && archiveDate(e.date)) HISTORY.entries[e.date] = {...e,_cold:false}; });
  renderHistory(); await loadMoreHistory();
}
async function loadMoreHistory() {
  if (HISTORY.loading) return;
  const request = HISTORY.request;
  HISTORY.loading = true; HISTORY.message = '封存清單載入中…'; renderHistory();
  try {
    const page = await archivePage(HISTORY.next);
    if (request !== HISTORY.request) return;
    page.entries.forEach(e => { if (!HISTORY.entries[e.date]) HISTORY.entries[e.date] = {...e,_cold:true}; });
    HISTORY.next = page.next;
    HISTORY.message = page.available ? '' : '封存服務未啟用，目前僅顯示本機歷史。';
  } catch { if (request === HISTORY.request) HISTORY.message = '封存清單暫時無法取得，可重試。'; }
  finally { if (request === HISTORY.request) { HISTORY.loading = false; renderHistory(); } }
}
function renderHistory() {
  const entries = Object.values(HISTORY.entries).sort((a,b)=>b.date.localeCompare(a.date));
  $('panel-history').innerHTML = entries.map((e,i)=> {
    const cnt = Number(e.item_count) || (plainRecord(e.stats) ? Object.values(e.stats).reduce((a,b)=>a+(typeof b==='number'?b:0),0) : 0);
    const pr = e.validation_pass_rate ?? e.pass_rate ?? e.validation?.pass_rate;
    return `<div class="card" style="cursor:pointer" onclick="loadHistDate('${e.date}')"><div class="card-row">${rank(i+1)}<div class="card-body"><div class="card-title">${fmtDate(e.date)}</div><div class="card-badges">${badge('var(--green)',cnt+' 筆新聞')}${badge('var(--ac)',pr == null ? '驗證 —' : '驗證 '+esc(pr)+'%')}${badge(e._cold?'var(--purple)':'var(--tx3)',e._cold?'封存':esc(e.source||'自動'))}</div></div><span>載入 →</span></div></div>`;
  }).join('') + (!entries.length && !HISTORY.message ? '<div class="empty">📅 無歷史資料</div>' : '')
  + `<p role="status">${esc(HISTORY.message)}</p>`
  + ((HISTORY.next || HISTORY.message.includes('重試')) ? `<button class="bm-exp" onclick="loadMoreHistory()" ${HISTORY.loading?'disabled':''}>${HISTORY.message.includes('重試')?'重試':'載入更早紀錄'}</button>` : '');
}
