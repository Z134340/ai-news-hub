/* AI News Hub — firebase.js
   可選的 Firebase 雲端書籤同步（仿 NeuroLearn：Firebase v10 compat + Email/Password Auth + Firestore）。
   設計原則：offline-first。未設定 config（保持 YOUR_API_KEY）或未登入時，全部 no-op，
   網站照常以 localStorage 運作；填入真實 config 並登入後，自動跨裝置同步書籤。

   資料模型：users/{uid} 文件，欄位 bookmarks = { bmId: {...} }（版本化 map＋刪除紀錄，完整契約見 docs/specs/personal-data.md）。
   安全：見 firestore.rules（僅本人可讀寫自己 uid 的資料）。 */

let _fb = { app:null, auth:null, db:null, user:null, ready:false };

function isFirebaseEnabled() {
  return !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY');
}

function initFirebase() {
  if (!isFirebaseEnabled()) { updateAuthUI(null); return; }
  if (typeof firebase === 'undefined') { console.warn('Firebase SDK 未載入'); return; }
  try {
    _fb.app  = firebase.initializeApp(FIREBASE_CONFIG);
    _fb.auth = firebase.auth(_fb.app);
    _fb.db   = firebase.firestore(_fb.app);
    _fb.ready = true;
    _fb.auth.onAuthStateChanged(async (user) => {
      _fb.user = user || null;
      if (PERSONAL.uid !== (user?.uid || null)) switchPersonalAccount(user?.uid || null);
      updateAuthUI(_fb.user);
      if (user) await syncPersonalToCloud();
    });
  } catch (e) { console.error('Firebase 初始化失敗', e); }
}

/* A transaction merges versioned records and deletion markers in the owner's document.
   Capture identity before any await. Never move a prior account's cache into a new account. */
function fbDocId(itemId, uid = PERSONAL.uid) { return `${uid}_${itemId}`; }
const personalSyncQueues = new Map();
function syncPersonalToCloud() {
  const session = personalSession(), key = `${session.uid}:${session.epoch}`;
  const previous = personalSyncQueues.get(key) || Promise.resolve();
  const pending = previous.catch(() => {}).then(() => performPersonalSync(session));
  personalSyncQueues.set(key, pending);
  pending.finally(() => { if (personalSyncQueues.get(key) === pending) personalSyncQueues.delete(key); });
  return pending;
}
async function performPersonalSync(session, attempt = 0) {
  if (!currentPersonal(session)) return;
  if (!_fb.ready || !session.uid || _fb.user?.uid !== session.uid) return;
  const localBM = cleanPersonal(BOOKMARKS, 'bookmarks'), localFB = cleanPersonal(FEEDBACK, 'feedback');
  const deleted = {...PERSONAL.deleted}, feedbackDeleted = {...PERSONAL.feedbackDeleted};
  try {
    const ref = _fb.db.collection('users').doc(session.uid);
    // Query allows an empty result under existing rules; reading a nonexistent feedback doc does not.
    const feedbackSnap = await _fb.db.collection('feedback').where('uid', '==', session.uid).get();
    if (!currentPersonal(session)) return;
    const legacy = {}, feedbackDocs = {};
    feedbackSnap.docs.forEach(d => { const x = d.data(); if (personalId(x?.item_id)) { legacy[x.item_id] = x; feedbackDocs[x.item_id] = d.ref; } });
    const result = await _fb.db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!currentPersonal(session)) throw new Error('account_changed');
      const remote = snap.exists ? snap.data() : {};
      const bm = mergePersonal(cleanPersonal(remote.bookmarks, 'bookmarks'), cleanPersonal(remote.bookmark_deleted, 'deleted'), localBM, deleted, 'savedAt');
      const fb = mergePersonal(cleanPersonal(remote.feedback_v2 ? remote.feedback_state : legacy, 'feedback'), cleanPersonal(remote.feedback_deleted, 'deleted'), localFB, feedbackDeleted, 'ts');
      if (remote.feedback_v2 && Object.keys(remote.feedback_state || {}).some(id => !fb.records[id] && !feedbackDocs[id])) throw new Error('feedback_snapshot_changed');
      const fields = {bookmarks:bm.records, bookmark_deleted:bm.deleted, feedback_state:fb.records, feedback_deleted:fb.deleted, feedback_v2:true, updated_at:new Date().toISOString()};
      // update replaces the map field; merge:true alone leaves removed map children behind.
      if (snap.exists) tx.update(ref, fields); else tx.set(ref, fields);
      for (const [id, rec] of Object.entries(fb.records)) {
        if (JSON.stringify(cleanPersonal({[id]:legacy[id]}, 'feedback')[id]) === JSON.stringify(rec)) continue;
        tx.set(_fb.db.collection('feedback').doc(fbDocId(id, session.uid)), {...rec, uid:session.uid, item_id:id});
      }
      for (const id of Object.keys(fb.deleted)) if (!fb.records[id] && feedbackDocs[id]) tx.delete(feedbackDocs[id]);
      return {bm, fb};
    });
    if (!currentPersonal(session)) return;
    // Retain clicks that occurred while the transaction was in flight.
    const bm = mergePersonal(result.bm.records, result.bm.deleted, BOOKMARKS, PERSONAL.deleted, 'savedAt');
    const fb = mergePersonal(result.fb.records, result.fb.deleted, FEEDBACK, PERSONAL.feedbackDeleted, 'ts');
    BOOKMARKS = bm.records; PERSONAL.deleted = bm.deleted;
    FEEDBACK = fb.records; PERSONAL.feedbackDeleted = fb.deleted;
    const savedLocally = persistPersonal(); repaintPersonal();
    if (savedLocally && $('personalStatus')?.textContent.startsWith('雲端同步')) personalNotice('');
  } catch (e) {
    if (!currentPersonal(session)) return;
    if (attempt < 2 && (e.message === 'feedback_snapshot_changed' || e.code === 'permission-denied')) return performPersonalSync(session, attempt + 1);
    console.error('個人資料同步失敗', e);
    personalNotice('雲端同步尚未完成；本機可繼續使用，重新連線後會重試。');
  }
}
function syncBookmarksToCloud() { return syncPersonalToCloud(); }
function syncBookmarksFromCloud() { return syncPersonalToCloud(); }
function syncFeedbackToCloud() { return syncPersonalToCloud(); }
function syncFeedbackFromCloud() { return syncPersonalToCloud(); }
window.addEventListener('online', () => syncPersonalToCloud());
window.addEventListener('storage', event => {
  if (event.key !== personalKey() || !event.newValue) return;
  try {
    const v = JSON.parse(event.newValue);
    if (v.version !== 2) return;
    const bm = mergePersonal(BOOKMARKS, PERSONAL.deleted, cleanPersonal(v.bookmarks, 'bookmarks'), cleanPersonal(v.deleted, 'deleted'), 'savedAt');
    const fb = mergePersonal(FEEDBACK, PERSONAL.feedbackDeleted, cleanPersonal(v.feedback, 'feedback'), cleanPersonal(v.feedbackDeleted, 'deleted'), 'ts');
    BOOKMARKS = bm.records; PERSONAL.deleted = bm.deleted;
    FEEDBACK = fb.records; PERSONAL.feedbackDeleted = fb.deleted;
    persistPersonal(); repaintPersonal(); syncPersonalToCloud();
  } catch { /* A damaged event must not stop the page. */ }
});

/* ── 冷封存讀取（公開讀，免登入；前端用 JS SDK，後端 run-daily 才用 REST 寫入）── */
function archiveEnabled() { return _fb.ready && !!_fb.db; }

const archiveDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
const archivePages = new Map();
async function archivePage(cursor = null, limit = 31) {
  if (!isFirebaseEnabled()) return {entries:[], next:null, available:false};
  if (cursor !== null && !archiveDate(cursor)) throw new Error('invalid_archive_cursor');
  limit = Math.max(1, Math.min(90, Number(limit) || 31));
  const key = `${cursor || ''}:${limit}`, cached = archivePages.get(key);
  if (cached && Date.now() - cached.time < 300000) return cached.page;
  const query = {from:[{collectionId:'archives'}], select:{fields:['date','item_count','pass_rate','source'].map(fieldPath=>({fieldPath}))}, orderBy:[{field:{fieldPath:'date'}, direction:'DESCENDING'}], limit:limit+1};
  if (cursor) query.startAt = {values:[{stringValue:cursor}], before:false};
  const rows = await fetchJSON(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(FIREBASE_CONFIG.projectId)}/databases/(default)/documents:runQuery`, 8000, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({structuredQuery:query})});
  if (!Array.isArray(rows) || rows.some(r => r.error)) throw new Error('invalid_archive_response');
  const docs = rows.filter(r => r.document).map(r => r.document);
  const entries = docs.slice(0,limit).map(d => {
    const f = d.fields || {}, value = k => f[k]?.stringValue ?? f[k]?.integerValue ?? f[k]?.doubleValue;
    return {date:value('date'), item_count:Number(value('item_count')) || 0, pass_rate:value('pass_rate') ?? null, source:value('source') || 'firestore'};
  }).filter(e => archiveDate(e.date));
  const page = {entries, next:docs.length > limit ? entries.at(-1)?.date || null : null, available:true};
  archivePages.set(key, {time:Date.now(), page});
  return page;
}
async function archiveList() { return (await archivePage(null,90)).entries; }
async function archiveGet(date) {
  if (!isFirebaseEnabled() || !archiveDate(date)) return null;
  try {
    const doc = await fetchJSON(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(FIREBASE_CONFIG.projectId)}/databases/(default)/documents/archives/${date}`, 10000);
    return doc.fields?.payload?.stringValue ? JSON.parse(doc.fields.payload.stringValue) : null;
  } catch (e) { console.error('封存讀取失敗', e); return null; }
}

/* ── Auth 動作 ── */
async function fbLogin() {
  const email = $('fbEmail').value.trim(), pw = $('fbPw').value;
  if (!email || !pw) { $('fbMsg').textContent = '請輸入 Email 與密碼'; return; }
  $('fbMsg').textContent = '登入中…';
  try { await _fb.auth.signInWithEmailAndPassword(email, pw); closeAuthModal(); }
  catch (e) { $('fbMsg').textContent = fbErr(e); }
}
async function fbSignup() {
  const email = $('fbEmail').value.trim(), pw = $('fbPw').value;
  if (!email || pw.length < 6) { $('fbMsg').textContent = '密碼至少 6 碼'; return; }
  $('fbMsg').textContent = '註冊中…';
  try { await _fb.auth.createUserWithEmailAndPassword(email, pw); closeAuthModal(); }
  catch (e) { $('fbMsg').textContent = fbErr(e); }
}
async function fbLogout() {
  try { await _fb.auth.signOut(); } catch (e) { console.error(e); }
}
function fbErr(e) {
  const m = { 'auth/invalid-email':'Email 格式錯誤', 'auth/user-not-found':'查無此帳號',
    'auth/wrong-password':'密碼錯誤', 'auth/invalid-credential':'帳號或密碼錯誤',
    'auth/email-already-in-use':'此 Email 已註冊', 'auth/weak-password':'密碼太弱（至少 6 碼）',
    'auth/network-request-failed':'網路連線失敗' };
  return m[e.code] || ('錯誤：' + (e.code || e.message));
}

/* ── Auth UI ── */
function openAuthModal() {
  if (!isFirebaseEnabled()) {
    alert('雲端同步尚未啟用。\n請依 FIREBASE-SETUP.md 建立 Firebase 專案並填入 assets/js/config.js 的 FIREBASE_CONFIG。');
    return;
  }
  $('fbMsg').textContent = '';
  $('authModal').classList.add('open');
  $('authOv').classList.add('open');
}
function closeAuthModal() {
  $('authModal').classList.remove('open');
  $('authOv').classList.remove('open');
}
function updateAuthUI(user) {
  const btn = $('syncBtn');
  if (!btn) return;
  if (!isFirebaseEnabled()) {
    btn.style.display = 'none';   // 未設定 config → 不顯示同步按鈕
    return;
  }
  btn.style.display = 'inline-flex';
  if (user) {
    btn.classList.add('on');
    btn.title = '已登入：' + (user.email || '') + '（點擊登出）';
    btn.onclick = () => { if (confirm('登出雲端同步？此帳號收藏會保留於專屬快取，登出後顯示本機收藏。')) fbLogout(); };
  } else {
    btn.classList.remove('on');
    btn.title = '登入以跨裝置同步書籤';
    btn.onclick = openAuthModal;
  }
}
