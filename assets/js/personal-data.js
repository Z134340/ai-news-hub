/* Account-scoped, versioned local cache. Legacy keys remain untouched and local-only. */
let PERSONAL = { uid:null, epoch:0, deleted:{}, feedbackDeleted:{} };
const personalId = id => typeof id === 'string' && /^bm[a-z0-9]+$/.test(id);
const plainRecord = x => !!x && typeof x === 'object' && !Array.isArray(x);
const validStamp = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT/.test(x) && Number.isFinite(Date.parse(x));
function personalNotice(message) {
  let el = $('personalStatus');
  if (!el && document.body) {
    el = document.createElement('div'); el.id = 'personalStatus'; el.setAttribute('role', 'status');
    el.className = 'personal-notice';
    document.body.appendChild(el);
  }
  if (el) { el.textContent = message; el.hidden = !message; }
}
function readPersonal(key) {
  try { const raw = localStorage.getItem(key); return raw === null ? null : JSON.parse(raw); }
  catch { personalNotice('本機儲存無法讀取；新聞仍可閱讀。'); return null; }
}
function cleanPersonal(value, kind) {
  const out = {};
  if (!plainRecord(value)) return out;
  for (const [id, rec] of Object.entries(value)) {
    if (!personalId(id)) continue;
    if (kind === 'deleted') { if (validStamp(rec)) out[id] = rec; continue; }
    if (!plainRecord(rec)) continue;
    if (kind === 'bookmarks') {
      if (!plainRecord(rec.item) || !validStamp(rec.savedAt)) continue;
      const cat = SEARCH_CATS.find(c => c.key === rec.cat);
      if (!cat) continue;
      out[id] = {cat:cat.key, catLabel:cat.label, catColor:cat.color, item:rec.item, savedAt:rec.savedAt};
    } else if (['good','mid','bad'].includes(rec.rating) && validStamp(rec.ts)) {
      out[id] = Object.fromEntries(['rating','cat','item_date','title','url','ts'].map(k => [k, typeof rec[k] === 'string' ? rec[k] : '']));
    }
  }
  return out;
}
function personalKey(uid = PERSONAL.uid) { return 'ainews-personal-v2:' + (uid ? 'user:' + encodeURIComponent(uid) : 'guest'); }
function mergePersonal(a, ad, b, bd, stamp) {
  const records = {...a}, deleted = {...ad};
  for (const [id, time] of Object.entries(bd)) if (!deleted[id] || time > deleted[id]) deleted[id] = time;
  for (const [id, rec] of Object.entries(b)) if (!records[id] || rec[stamp] > records[id][stamp]) records[id] = rec;
  for (const [id, time] of Object.entries(deleted)) if (records[id] && time >= records[id][stamp]) delete records[id];
  return {records, deleted};
}
function nextPersonalStamp() {
  const stamps = [...Object.values(PERSONAL.deleted), ...Object.values(PERSONAL.feedbackDeleted), ...Object.values(BOOKMARKS).map(x=>x.savedAt), ...Object.values(FEEDBACK).map(x=>x.ts)];
  return new Date(Math.max(Date.now(), ...stamps.map(x => Date.parse(x) + 1).filter(Number.isFinite))).toISOString();
}
function persistPersonal() {
  try {
    const stable = value => Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)));
    const serialized = JSON.stringify({version:2, bookmarks:stable(BOOKMARKS), feedback:stable(FEEDBACK), deleted:stable(PERSONAL.deleted), feedbackDeleted:stable(PERSONAL.feedbackDeleted)});
    if (localStorage.getItem(personalKey()) !== serialized) localStorage.setItem(personalKey(), serialized);
    return true;
  } catch { personalNotice('本機儲存已滿或不可用；本次變更可能無法在關閉後保留。'); return false; }
}
function switchPersonalAccount(uid) {
  PERSONAL = {uid:uid || null, epoch:PERSONAL.epoch + 1, deleted:{}, feedbackDeleted:{}};
  const raw = readPersonal(personalKey());
  const cached = plainRecord(raw) && raw.version === 2 ? raw : {};
  // Unknown ownership of old caches: preserve for local access, never import into an account.
  BOOKMARKS = cleanPersonal(raw === null && !uid ? readPersonal('ainews-bm') : cached.bookmarks, 'bookmarks');
  FEEDBACK = cleanPersonal(raw === null && !uid ? readPersonal('ainews-fb') : cached.feedback, 'feedback');
  PERSONAL.deleted = cleanPersonal(cached.deleted, 'deleted');
  PERSONAL.feedbackDeleted = cleanPersonal(cached.feedbackDeleted, 'deleted');
  BOOKMARKS = mergePersonal(BOOKMARKS, PERSONAL.deleted, {}, {}, 'savedAt').records;
  FEEDBACK = mergePersonal(FEEDBACK, PERSONAL.feedbackDeleted, {}, {}, 'ts').records;
  repaintPersonal();
}
function repaintPersonal() {
  updateBmTabCount(); paintFeedbackButtons();
  document.querySelectorAll('.bm-btn[data-bmid]').forEach(btn => {
    const saved = !!BOOKMARKS[btn.dataset.bmid];
    btn.classList.toggle('bm-saved', saved); btn.title = saved ? '移除書籤' : '加入書籤';
    btn.innerHTML = svg('bookmark', 14, saved ? '#818cf8' : 'var(--tx3)');
  });
  if (curSec === 'bookmarks') renderBookmarks();
}
function personalSession() { return {uid:PERSONAL.uid, epoch:PERSONAL.epoch}; }
function currentPersonal(s) { return s.uid === PERSONAL.uid && s.epoch === PERSONAL.epoch; }
