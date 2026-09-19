/* AI News Hub — data.js  資料載入、自動更新偵測 */

/* ======== AUTO-UPDATE (15 min) ======== */
let autoCheckTimer = null;
function startAutoCheck(){
  if (autoCheckTimer) return;
  autoCheckTimer = setInterval(checkLatestRelease,15*60*1000);
}

/* ======== FETCH WITH TIMEOUT ======== */
async function fetchJSON(url, ms=10000, options={}, bodyType='json') {
  const ctrl = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { ctrl.abort(); reject(new DOMException('載入逾時', 'AbortError')); }, ms); });
  try {
    return await Promise.race([timeout, (async () => {
      const r = await fetch(url, {...options, signal:ctrl.signal});
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if(bodyType==='text') return new TextDecoder('utf-8',{fatal:true}).decode(await r.arrayBuffer());
      return await r.json();
    })()]);
  } finally { clearTimeout(timer); }
}

/* AH-03: raw bytes are cached separately from mutable UI/history data. */
const RELEASE_CACHE = 'ainews-release-v1:';
const RELEASE_POINTER = RELEASE_CACHE + 'current';
let releaseMemory = null, releaseFlight = null, displayedReleaseId = null;
let releaseReadStatus = 'idle';
function validReleaseTime(value) {
  if(typeof value!=='string')return false;
  const p=/^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/.exec(value);
  if(!p)return false;
  const [year,month,day,hour,minute,second,zoneHour,zoneMinute]=p.slice(1).map(v=>Number(v||0));
  const days=[31,(year%4===0&&(year%100!==0||year%400===0))?29:28,31,30,31,30,31,31,30,31,30,31];
  return year>=1 && month>=1 && month<=12 && day>=1 && day<=days[month-1] && hour<24 && minute<60 && second<60 &&
    zoneHour<24 && zoneMinute<60 && Number.isFinite(Date.parse(value));
}
function validateReleaseManifest(m) {
  const keys=['schema_version','data_schema_version','release_id','data_sha256','data_path','data_bytes','snapshot_time','scope'];
  if (!m || typeof m!=='object' || Array.isArray(m) || Object.keys(m).length!==keys.length || !keys.every(k=>Object.hasOwn(m,k)) ||
      m.schema_version!==1 || m.data_schema_version!==2 || m.scope!=='local_snapshot' ||
      !/^[0-9a-f]{64}$/.test(m.data_sha256) || m.release_id!=='ahn-release-v1-'+m.data_sha256 ||
      m.data_path!=='data/releases/'+m.data_sha256+'.json' || !Number.isSafeInteger(m.data_bytes) || m.data_bytes<1 ||
      !validReleaseTime(m.snapshot_time)) throw new Error('invalid_release_manifest');
  return m;
}
async function verifiedRelease(record) {
  const m=validateReleaseManifest(record.manifest);
  if (typeof record.text!=='string') throw new Error('invalid_release_cache');
  const bytes=new TextEncoder().encode(record.text);
  if (bytes.length!==m.data_bytes) throw new Error('release_size_mismatch');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if (hash!==m.data_sha256) throw new Error('release_hash_mismatch');
  const document=JSON.parse(record.text);
  if (document.schema_version!==2 || document.time!==m.snapshot_time || !document.data || typeof document.data!=='object' || Array.isArray(document.data) ||
      !document._update_outcome || !Object.values(document.data).every(Array.isArray)) throw new Error('invalid_release_data');
  return {document,manifest:m};
}
async function readReleaseCache(id) {
  // In-memory payload is also rechecked; UI mutation never touches this raw copy.
  try { if(releaseMemory && (!id || releaseMemory.manifest.release_id===id)) return {...await verifiedRelease(releaseMemory),record:releaseMemory}; } catch { releaseMemory=null; }
  try {
    const key=id || localStorage.getItem(RELEASE_POINTER);
    if (!/^ahn-release-v1-[0-9a-f]{64}$/.test(key)) return null;
    const record=JSON.parse(localStorage.getItem(RELEASE_CACHE+key));
    const result=await verifiedRelease(record);
    if (result.manifest.release_id!==key) throw new Error('cache_key_mismatch');
    releaseMemory=record;
    return {...result,record};
  } catch { return null; }
}
function saveReleaseCache(record) {
  releaseMemory=record;
  try {
    const previous=localStorage.getItem(RELEASE_POINTER);
    localStorage.setItem(RELEASE_CACHE+record.manifest.release_id,JSON.stringify(record));
    // Switch only after the complete record is stored; failed quota keeps prior pointer.
    localStorage.setItem(RELEASE_POINTER,record.manifest.release_id);
    if(previous && previous!==record.manifest.release_id) localStorage.removeItem(RELEASE_CACHE+previous);
  } catch { /* Memory remains usable when storage is disabled/full. */ }
}
async function fetchReleaseText(url) {
  return fetchJSON(url,10000,{cache:'no-store'},'text');
}
async function readLatestRelease() {
  if (releaseFlight) return releaseFlight;
  releaseFlight=(async()=>{
    let manifest;
    try {
      manifest=await fetchJSON('data/release-manifest.json?v='+Date.now(),8000,{cache:'no-store'});
    } catch(e) {
      const cached=await readReleaseCache();
      if(cached){releaseReadStatus='cached';return {...cached,status:'cached'};}
      if(e.name==='SyntaxError'){releaseReadStatus='failed';throw e;}
      // Old sites have no manifest. Transport failure may use old protocol, visibly unverified.
      const document=await fetchJSON('data/latest.json?v='+Date.now(),10000,{cache:'no-store'});
      releaseReadStatus='legacy';return {document,manifest:null,status:'legacy'};
    }
    try {
      validateReleaseManifest(manifest);
      const cached=await readReleaseCache(manifest.release_id);
      if(cached && Object.keys(manifest).every(k=>cached.manifest[k]===manifest[k])) {
        releaseReadStatus='verified';return {...cached,status:'verified'};
      }
      if(cached) throw new Error('same_release_metadata_mismatch');
      const text=await fetchReleaseText(manifest.data_path);
      const record={manifest,text};
      const result=await verifiedRelease(record);
      saveReleaseCache(record);releaseReadStatus='verified';
      return {...result,status:'verified'};
    } catch(e) {
      const cached=await readReleaseCache();
      if(cached){releaseReadStatus='cached';return {...cached,status:'cached'};}
      releaseReadStatus='failed';throw e; // Never bypass a present manifest/hash failure via latest.
    }
  })();
  try{return await releaseFlight;}finally{releaseFlight=null;}
}
function releaseNotice() {
  const old=$('banners')?.querySelector('.release-status');
  if(old?.remove)old.remove();
  const message=releaseReadStatus==='cached'?'版本檢查失敗，目前顯示先前已驗證的快取。':releaseReadStatus==='legacy'?'目前使用相容讀取，未驗證發布版本。':releaseReadStatus==='failed'?'發布版本驗證失敗，保留目前畫面。':'';
  if(message && $('banners'))$('banners').innerHTML='<div class="banner release-status" role="status">'+message+'</div>'+$('banners').innerHTML;
}
async function checkLatestRelease() {
  if(autoLock||HIST_VIEWING)return;autoLock=true;
  try {
    const result=await readLatestRelease();
    const changed=result.status==='verified' ? result.manifest.release_id!==displayedReleaseId : result.status==='legacy' && result.document.time && result.document.time!==updateTime;
    releaseNotice();
    if(changed){const b=$('banners');if(!b.querySelector('.upd'))b.innerHTML='<div class="banner upd" onclick="location.reload()"><span>📰 新資料已到，點擊重新載入</span></div>'+b.innerHTML;}
  } catch {releaseReadStatus='failed';releaseNotice();} finally{autoLock=false;}
}

/* ======== LOAD DATA ======== */
async function loadData(){
  showSkeleton();
  try{
    const [release,hr]=await Promise.all([
      readLatestRelease(),
      fetchJSON('data/health.json?v='+Date.now(),8000).catch(()=>null)
    ]);
    const dr=release.document;
    const sr=!dr?._update_outcome ? await fetchJSON('data/skills.json?v='+Date.now(),8000).catch(()=>null) : null;
    if (!dr || !dr.data || typeof dr.data !== 'object' || Array.isArray(dr.data)) throw new Error('invalid_news_data');
    // 舊封存早於企業生態系上線，缺少新 key 時以空陣列向後相容。
    if (!Array.isArray(dr.data.official_info)) dr.data.official_info = [];
    // AH-02 latest already contains the gate-selected skills; a side file cannot override it.
    if (!dr._update_outcome && sr && Array.isArray(sr.items)) {
      dr.data.skills = sr.items;
      dr.stats = {...(dr.stats||{}),skills:sr.items.length};
      dr._updated_at = {...(dr._updated_at||{}),skills:sr._updated_at||dr.time};
    }
    DATA=dr; HEALTH=hr; updateTime=DATA.time; displayedReleaseId=release.manifest?.release_id||null;
    renderAll(); updateHeader(); releaseNotice(); startAutoCheck();
    return true;
  }catch(e){
    const msg=e.name==='AbortError'?'載入逾時，請重新整理':'載入失敗，請重新整理';
    console.error(e);
    if ($('hPillText')) $('hPillText').textContent = '資料載入失敗';
    ['panel-papers','panel-skills',...NEWS_SUBS.map(s=>'sub-'+s.id),...ECOSYSTEM_SUBS.map(s=>'sub-'+s.id)].forEach(id => { const el = $(id); if (el) el.innerHTML=`<div class="empty">⚠️ ${msg}</div>`; });
    return false;
  }
}
