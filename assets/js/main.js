/* AI News Hub — main.js  啟動序列（所有模組載入後最後執行） */

/* ======== INIT ======== */
loadBookmarks();
buildTabs();
updateBmTabCount();
loadData();
requestAnimationFrame(updateStickyOffsets);
initFirebase();   // 可選雲端同步；未設定 config 時自動 no-op
