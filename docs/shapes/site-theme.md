# 全站研究簡報主題定位（2026-09-18）

權威顯示規格見 [frontend-ux.md](../specs/frontend-ux.md)「全站研究簡報視覺」。

| 目標 | 唯一程式入口 | 責任 |
|---|---|---|
| 顏色、表面、文字、狀態、焦點 | `assets/css/app.css :root` | 全站單一 token 來源 |
| 共用布局／元件／響應式 | `assets/css/app.css` | 導覽、新聞、收藏、搜尋、歷史、登入窗、toast |
| 儀表板布局 | `assets/css/trend-briefing.css` | 只引用共用色票；trends-active 不切換色彩 |
| 徽章與資訊區塊 | `assets/js/config.js`：tint／badge／rank／infoBlock | token 可用的透明度與統一排名／標籤；分類名稱與圖示保留 |
| 動態樣式 | `assets/js/ui.js`、`render.js`、`search.js`、`bookmarks.js`、`history.js` | 分頁／分類／卡片使用共用 token；收藏色不依賴舊記錄 |
| 既有圖表 | `assets/js/dashboard.js` | SVG 文字、格線及語意色；保留多序列線型 |
| 頁首與通知 | `assets/js/main.js`、`ui.js`、`personal-data.js` | ResizeObserver 校正 sticky；通知 class 引用共用樣式 |
| 行動瀏覽器外框 | `index.html` | 淺色 theme-color／status bar |

本次無資料契約、帳號權限或後端流程變更。驗證使用既有 frontend／trend-topics／dashboard status 回歸，加上 Browser 真實畫面與操作；不是 Firebase 多帳號驗收。
