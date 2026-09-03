/* AI News Hub — main.js  啟動序列（所有模組載入後最後執行） */

/* ======== INIT ======== */
loadBookmarks();
loadFeedback();
buildTabs();
updateBmTabCount();
loadData();
requestAnimationFrame(updateStickyOffsets);
initFirebase();   // 可選雲端同步；未設定 config 時自動 no-op
// 儀表板是預設分頁，必須排在 initFirebase() 之後：它的時間軸要吃冷封存，
// 而 archiveEnabled() 看的是 initFirebase() 同步設好的 _fb.ready。
// 順序顛倒不會報錯，只會安靜地把冷層 61 天縮成熱層 8 天。
loadDashboard();
