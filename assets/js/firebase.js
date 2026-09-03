/* AI News Hub — firebase.js
   可選的 Firebase 雲端書籤同步（仿 NeuroLearn：Firebase v10 compat + Email/Password Auth + Firestore）。
   設計原則：offline-first。未設定 config（保持 YOUR_API_KEY）或未登入時，全部 no-op，
   網站照常以 localStorage 運作；填入真實 config 並登入後，自動跨裝置同步書籤。

   資料模型：users/{uid} 文件，欄位 bookmarks = { bmId: {...} }（單文件 map，1 read / 1 write，最省）。
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
      updateAuthUI(_fb.user);
      if (user) { await syncBookmarksFromCloud(); await syncFeedbackFromCloud(); }
    });
  } catch (e) { console.error('Firebase 初始化失敗', e); }
}

/* ── 同步：寫入雲端（由 bookmarks.js 的 saveBookmarks 觸發）── */
async function syncBookmarksToCloud() {
  if (!_fb.ready || !_fb.user) return;          // 未登入 → no-op，仍只用 localStorage
  try {
    await _fb.db.collection('users').doc(_fb.user.uid).set(
      { bookmarks: BOOKMARKS, updated_at: new Date().toISOString() },
      { merge: true }
    );
  } catch (e) { console.error('書籤上傳失敗', e); }
}

/* ── 同步：登入時把雲端與本機聯集（衝突取 savedAt 較新者），再寫回雲端 ── */
async function syncBookmarksFromCloud() {
  if (!_fb.ready || !_fb.user) return;
  try {
    const snap = await _fb.db.collection('users').doc(_fb.user.uid).get();
    const cloud = (snap.exists && snap.data().bookmarks) ? snap.data().bookmarks : {};
    const merged = { ...cloud };
    Object.entries(BOOKMARKS).forEach(([id, local]) => {
      const c = merged[id];
      if (!c || (local.savedAt || '') > (c.savedAt || '')) merged[id] = local;
    });
    BOOKMARKS = merged;
    localStorage.setItem('ainews-bm', JSON.stringify(BOOKMARKS));
    updateBmTabCount();
    if (typeof curSec !== 'undefined' && curSec === 'bookmarks') renderBookmarks();
    // 重繪頁面上的書籤按鈕狀態
    document.querySelectorAll('.bm-btn[data-bmid]').forEach(btn => {
      const id = btn.dataset.bmid, saved = !!BOOKMARKS[id];
      btn.classList.toggle('bm-saved', saved);
      btn.title = saved ? '移除書籤' : '加入書籤';
      btn.innerHTML = svg('bookmark', 14, saved ? '#818cf8' : 'var(--tx3)');
    });
    await syncBookmarksToCloud();   // 把聯集結果寫回，讓兩端一致
  } catch (e) { console.error('書籤下載失敗', e); }
}

/* ── 回饋同步：feedback/{uid}_{key} 一筆一文件；取消評分 → 刪文件。
   docId 用 uid 開頭是 firestore.rules 的硬條件；key 先去掉 Firestore 不接受的字元。── */
function fbDocId(itemId) {
  const safe = String(itemId).replace(/[^A-Za-z0-9_-]/g, c => '.' + c.charCodeAt(0).toString(16));
  return `${_fb.user.uid}_${safe}`;
}
async function syncFeedbackToCloud(itemId, rec) {
  if (!_fb.ready || !_fb.user) return;
  try {
    const ref = _fb.db.collection('feedback').doc(fbDocId(itemId));
    if (!rec) { await ref.delete(); return; }
    await ref.set({ uid: _fb.user.uid, item_id: itemId, cat: rec.cat || '', rating: rec.rating,
      item_date: rec.item_date || '', title: rec.title || '', url: rec.url || '', ts: rec.ts }, { merge: true });
  } catch (e) { console.error('回饋上傳失敗', e); }
}
async function syncFeedbackFromCloud() {
  if (!_fb.ready || !_fb.user) return;
  try {
    const snap = await _fb.db.collection('feedback').where('uid', '==', _fb.user.uid).get();
    const cloud = {};
    snap.docs.forEach(d => { const x = d.data() || {}; if (x.item_id) cloud[x.item_id] = x; });
    const merged = { ...FEEDBACK };
    Object.entries(cloud).forEach(([id, x]) => {
      const local = merged[id];
      if (!local || (x.ts || '') > (local.ts || '')) {
        merged[id] = { rating: x.rating, cat: x.cat || '', item_date: x.item_date || '', title: x.title || '', url: x.url || '', ts: x.ts || '' };
      }
    });
    FEEDBACK = merged;
    localStorage.setItem('ainews-fb', JSON.stringify(FEEDBACK));
    paintFeedbackButtons();
    // 本機較新的那幾筆補上雲，讓兩端一致
    for (const [id, rec] of Object.entries(FEEDBACK)) {
      const c = cloud[id];
      if (!c || (rec.ts || '') > (c.ts || '')) await syncFeedbackToCloud(id, rec);
    }
  } catch (e) { console.error('回饋下載失敗', e); }
}

/* ── 冷封存讀取（公開讀，免登入；前端用 JS SDK，後端 run-daily 才用 REST 寫入）── */
function archiveEnabled() { return _fb.ready && !!_fb.db; }

async function archiveList() {
  if (!archiveEnabled()) return [];
  try {
    const snap = await _fb.db.collection('archives').orderBy('date', 'desc').get();
    return snap.docs.map(d => {
      const x = d.data() || {};
      return { date: x.date || d.id, item_count: x.item_count || 0, pass_rate: x.pass_rate || '', source: x.source || 'firestore' };
    });
  } catch (e) { console.error('封存清單讀取失敗', e); return []; }
}

async function archiveGet(date) {
  if (!archiveEnabled()) return null;
  try {
    const doc = await _fb.db.collection('archives').doc(date).get();
    if (!doc.exists) return null;
    const x = doc.data() || {};
    return x.payload ? JSON.parse(x.payload) : null;
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
    btn.onclick = () => { if (confirm('登出雲端同步？書籤仍保留在本機。')) fbLogout(); };
  } else {
    btn.classList.remove('on');
    btn.title = '登入以跨裝置同步書籤';
    btn.onclick = openAuthModal;
  }
}
