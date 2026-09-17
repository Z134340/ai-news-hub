<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

## index.html 前端 UX 規範

### 載入
- 開啟 → 骨架屏 shimmer → fetch latest.json?v={Date.now()} → 淡入內容
- **health.json 並行載入，但 404 時靜默忽略（⚠️ Bug Fix #5）**：
  ```javascript
  const healthData = await fetch("data/health.json?v=" + Date.now())
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);
  // healthData 為 null 時，Header 不顯示健康指標，不影響主功能
  ```
- **latest.json 不存在（首次部署 / 404）→ 顯示友善提示「🕐 首次部署完成，等待明日 18:00 首次擷取」+ 手動擷取按鈕**
- **fetch 失敗（網路錯誤）→ 顯示「⚠️ 無法載入資料」+ 重試按鈕（3 秒後自動重試一次）**

### Header 健康儀表板（全寬單列佈局）
- 左側：Logo + 標題 + 日期
- 中間：主分類 Tab（sec-tabs，`flex:1` 置中）
- 右側（永遠靠右）：狀態膠囊 + 驗證率 + 更新時間 + 搜尋
- **CSS 關鍵**：`.hdr-inner{width:100%}` 確保容器全寬；`.hdr-right{margin-left:auto}` 固定靠右端
  · 🟢 綠色脈動 = 今日資料已就緒 + 驗證率 ≥ 90%
  · 🟡 黃色 = 今日資料已就緒但驗證率 < 90%
  · 🔴 紅色 = 資料非今日（排程可能沒跑）

### 優先排序規則
- 論文研討、AI 新聞（含子分類）、模型快訊啟用「主題優先排序」
- 優先關鍵字：LLM-as-a-Judge, LLM/Agent evaluation, AgentBench, SWE-bench, agentic, multi-agent, benchmark, 評測, cybersecurity/資安, model release/模型發布, 技術大廠名（OpenAI, Anthropic, Google, Meta, Microsoft, NVIDIA, Apple, AWS, Gemini, GPT, Claude, LLaMA, Mistral）
- 排序邏輯：先依優先主題分組（匹配者在前），組內依日期由新到舊
- 資料非今日 → 頂部固定橙色橫幅：「⚠️ 今日資料尚未更新（上次：YYYY-MM-DD），電腦上線後將自動補跑。」
- health.json status === "missed" → 紅色橫幅：「🔴 昨日排程未執行，請確認電腦是否有開機。」
- health.json `errors[0]` 非空 → 黃色橫幅（svg alert icon，純文字）：「上次擷取：{errors[0]}」；來源為配額耗盡備註或 S-PWR 電池模式回退備註（`ui.js` updateHeader）

### 自動更新偵測（⚠️ Bug Fix #9）
- 每 **15 分鐘**靜默 fetch latest.json?v={Date.now()}（排程每日傍晚一次，較頻繁檢查以利補跑後即時更新）
- **使用鎖定機制防止疊加**：
  ```javascript
  let isChecking = false;
  setInterval(async () => {
    if (isChecking) return;
    isChecking = true;
    try {
      const r = await fetch("data/latest.json?v=" + Date.now());
      if (!r.ok) return;
      const j = await r.json();
      if (j.time !== currentTime) showUpdateBanner();
    } catch {} 
    finally { isChecking = false; }
  }, 15 * 60 * 1000);
  ```
- time 變更 → 頂部滑入藍色提示「📰 新資料已到，點擊重新載入」
- 點擊 → 平滑更新，不閃爍
- **比對 time（非 date）**：若當日有補跑（supplement-run），time 會變而 date 不變，用 time 欄位才能偵測到該次更新

### 分類更新時間顯示
- 每個分類頁面標題下方顯示該類別的最後更新時間（`_updated_at`）
- 格式：`🕐 更新 MM/DD HH:mm`
- 每週類別若資料非今日，額外顯示「（每週一更新）」灰色提示
- 前端邏輯：`DATA._updated_at[catId]`，fallback 到 `DATA.time`

### 五大分類頁籤 + 八個子頁籤
📄 論文研討 ｜ 📰 AI新聞（🔥全球熱門·🇹🇼台灣熱議·🇨🇳中國熱議·🇺🇸美國熱議·📈技術趨勢·⚖️科技治理·🛠️AI工具教學·🎓AI官方課程/證照）｜ 🚀 模型快訊 ｜ 🔖 書籤 ｜ 📅 歷史紀錄

### 卡片設計
- 前 3 展開，其餘收合
- 展開：max-height transition 300ms + scroll to top (offset 80px)
- 右上角：✅ verified / ⚠️ needs_review
- 各類別色系：論文藍紫/全球金/台灣綠/中國紅/美國藍/模型紫線

### 響應式（iPhone 優化）
- 桌面 >768px / 平板 ≤768px / 手機 ≤480px / iPhone SE ≤370px
- `viewport-fit=cover` + `env(safe-area-inset-*)` 適配 iPhone 瀏海/Dynamic Island
- `apple-mobile-web-app-capable` + `theme-color: #06080f` PWA 支援
- 主分類 Tab 手機端改為橫向滾動，觸控優化（`touch-action: manipulation`）
- Sub-tab 自動 scrollIntoView 到當前選中項
- Sticky header + tabs 高度由 JS 動態計算（`updateStickyOffsets`）
- 消除 iOS 300ms 點擊延遲、tap highlight 閃爍
- Sub-tabs 加入 `backdrop-filter` 模糊效果

### 技術
- Vanilla JS，零依賴，SVG Sprite 內嵌（含 calendar icon）
- 色彩：bg #06080f, surface #0d1117, card #111822, accent #818cf8

---

## 趨勢儀表板改版（2026-09-17 設計方向確認；尚未實作）

### 已確認的方向

- 採 A「研究簡報式」：本期重點 → 焦點主題比較 → 點選主題看判讀、走勢與證據。原型用於設計討論，不代表線上功能。
- 「本期焦點主題」保留六個展示位置，內容須隨時事更新，不固定綁死於目前六個大分類。新聞收錄分類與動態焦點主題是不同層次。
- 本次只將設計決策納入共用文件，沒有授權實作前端或更動既有趨勢產生管線；接續工作先細化設計與資料契約。

### 設計提案（細節待後續確認）

- 首屏一個主要趨勢與兩個次要觀察；比較區減少重複長卡，桌面顯示所選主題的詳情，手機直向閱讀。
- 根據近期新聞形成具體議題，隨新資料重新評估焦點；顯示入選原因與「新浮現／持續關注／關注降溫」等變化提示，不要求每天換滿六個。
- 主題不足時如實少列；退出焦點的主題可在過往主題查詢。同一主題改名應延續身分與歷史，避免名稱改變造成走勢中斷。
- 保留資料截至日、缺日與來源證據；關注度與階段分開呈現。沒有觀測不能補 0；7／30／90 日均是不同視窗，不能當成三個歷史時間點。多主題可重疊，不畫總和 100% 的市佔圖。

### 接續設計前須釐清

1. 沿用既有探索候選與趨勢資料的範圍；固定叢集如何映射到動態議題，不能只換前端名稱就宣稱已支援動態主題。
2. 主題穩定 ID、同義詞、合併／拆分與歷史銜接方式；新主題尚無足夠歷史時的呈現。
3. 觀測視窗、更新頻率、入選／退場條件、來源去重與證據門檻；目前尚未拍板演算法及數值門檻。
4. A 版既有原型仍展示固定主題及 2026-07-30 歷史資料；下次先更新動態主題畫面，再討論實作範圍與驗收。
