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
- 中間：主分類 Tab（sec-tabs，`flex:1` 靠左，窄桌面／平板可獨立一列）
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

### 六大內容頁籤 + 八個新聞子頁籤
📄 論文研討 ｜ 📰 AI新聞（🔥全球熱門·🇹🇼台灣熱議·🇨🇳中國熱議·🇺🇸美國熱議·📈技術趨勢·⚖️科技治理·🛠️AI工具教學·🎓AI官方課程/證照）｜ 🚀 模型快訊 ｜ ✨ 熱門 Skills ｜ 🔖 書籤 ｜ 📅 歷史紀錄

熱門 Skills 為獨立頁籤。每張卡顯示 GitHub repo、星數、型態、領域、授權、支援工具、最近維護日與 GitHub 連結；明示星數是 repo 層級人氣，不代表安全或單一 Skill 使用量。排序只使用 GitHub API 數值，不由模型生成。

### 卡片設計
- 前 3 展開，其餘收合
- 展開：max-height transition 300ms + scroll to top (offset 80px)
- 右上角：✅ verified / ⚠️ needs_review
- 全站分類控制、排名與一般標籤採共用淡紫主題；成功、提醒、錯誤與圖表多序列保留語意辨識。

### 響應式（iPhone 優化）
- 桌面 >768px / 平板 ≤768px / 手機 ≤480px / iPhone SE ≤370px
- `viewport-fit=cover` + `env(safe-area-inset-*)` 適配 iPhone 瀏海/Dynamic Island
- `apple-mobile-web-app-capable` + `theme-color: #fafaff` PWA 支援
- 主分類 Tab 手機端改為橫向滾動，觸控優化（`touch-action: manipulation`）
- Sub-tab 自動 scrollIntoView 到當前選中項
- Sticky header + tabs 高度由 JS 動態計算（`updateStickyOffsets`）
- 消除 iOS 300ms 點擊延遲、tap highlight 閃爍
- Sub-tabs 加入 `backdrop-filter` 模糊效果

### 技術
- Vanilla JS，零依賴，SVG Sprite 內嵌（含 calendar icon）
- 全站顏色由 `assets/css/app.css` 的 `:root` tokens 維護；儀表板與新聞、搜尋、書籤、歷史、登入窗共用。

### 全站研究簡報視覺（2026-09-18）

- 使用者授權將儀表板 A 版主視覺延伸全站：暖白背景、白色內容卡、淡紫選取底、深紫操作色與深藍灰文字，統一導覽、圓角、留白、標題和資訊層級。
- `app.css :root` 為顏色唯一程式來源：`--bg/sf/card` 表面、`--tx/tx2/tx3` 文字、`--ac/acl/ac-soft/ac-selected` 品牌與選取、`--green/amber/red/blue/cyan/pink/purple` 狀態及圖表、`--bd/bdH/focus` 邊界與焦點。`trend-briefing.css` 只保留儀表板布局並引用共用 tokens。
- 主／子分類頁籤統一紫色；名稱、圖示與選取線維持分類辨識。圖表多序列仍保留多色、線型、文字；驗證與失敗狀態仍保留綠／琥珀／紅及文字，不以顏色作唯一線索。
- 徽章透明背景以 `color-mix` 配合 CSS token 產生，不可在 `var(...)` 後串接十六進位透明度。收藏分類標籤由當前樣式呈現，不用舊收藏的 `catColor` 決定外觀；未遷移或改寫既有收藏記錄。
- `trends-active` 只控制儀表板寬度與重複標題顯示，搜尋與分頁切換不切換配色。登入、toast、空狀態、搜尋與歷史均繼承同一表面與文字色。
- 桌面新聞閱讀欄上限 1120px，儀表板維持 1320px；Header 保留既有 1.2 倍辨識尺寸，主內容使用原生比例，讓單一 viewport 顯示更多卡片與摘要。平板／手機同步收斂內容字級、行高與留白，但登入及搜尋輸入框維持 16px、觸控按鈕維持可操作尺寸；長徽章換行，320px 窄螢幕頁首可分列，只有導覽與既有大圖表可局部橫向捲動。
- `ResizeObserver` 追蹤頁首高度，搜尋、同步按鈕、字型與響應式換行後重新校正 sticky 子導覽；不支援時仍使用原 resize 與啟動校正。全站鍵盤焦點可見，減少動態效果偏好同樣適用。
- CSS `color-mix` 需現代瀏覽器。配色更新不更動新聞資料、分組算法、Firebase 權限、擷取或發布流程。

---

## 趨勢儀表板 A「研究簡報式」（2026-09-18 實作）

### 已確認的視覺與互動

- 使用者確認 A 版畫面與「剛好」的字級、留白、資訊密度，並於 2026-09-18 明確要求「請實作」。淺色、淡紫強調，保留原新聞頁功能。
- 本期重點一則＋延伸觀察最多兩則 → 最多六個動態焦點 → 主題判讀、七日收錄量與來源。桌面左右比較，800px 以下直向閱讀；選題後手機捲到詳情，鍵盤焦點可見並尊重減少動態效果設定。
- 主題不足時少列；沒有合格主題顯示證據累積中，沒有最新新聞顯示重試。以實際截至日標示過期，不把舊資料當今日。
- 「過往主題與觀測說明」提供近十四天內、近期七天未再收錄的群組及算法說明。原固定分類圖表、判讀與系統資訊保留在獨立收合區；原資料發布與人工審核邊界不變。

### 動態焦點資料契約

- 前端唯讀使用 `data/latest.json` 與 `data/index.json` 列出的近十四天熱層封存；最多十三份歷史檔、同時最多四個請求，各請求八秒逾時。先呈現最新資料，再補齊歷史。未讀到的日子保留缺口，不用冷層摘要假充整日新聞。
- 使用 papers、topnews、taiwan、china、usa、techtrends、governance 的標題；教學、課程、模型長期目錄不混入日常焦點。只納入有效 HTTP(S) URL、有效發布日期，排除未來及超出十四日範圍的新聞。
- 標題以 `title_zh` 優先，否則保留原文；以 `Intl.Segmenter` 取詞並排除一般停用詞，取共同出現的兩個關鍵詞形成群組，並非預設六大分類。無 Segmenter 的舊瀏覽器只保留拉丁文字詞；不同瀏覽器詞庫版本可能產生不同分詞，不承諾跨引擎完全相同排名。
- URL 去除 fragment、utm_*、fbclid、gclid、www 與尾斜線，再排序 query 後去重；同 URL 以最新快照為準。不同網域的轉載仍可各計一篇，網域數不代表獨立採訪數。
- 入選至少兩篇不同 URL、發布日期在截至日往前七日內。分數＝近七日篇數＋來源網域數×1.5＋最近兩日有文章時加2；選下一題時，每個已展示的共同詞讓有效分數除以（1＋重複詞數×2）。與已選群組的文章重疊達較小群組65%即排除；最多六題，不補假題。
- 主題 ID 為正規化、排序後的詞組，不依顯示標題生成；同一詞組維持身分與在可讀取期間的觀測。沒有跨日期持久化 registry，同義詞、更名、合併／拆分不自動接歷史；僅「相同詞組」可視為同一群組。這是可解釋的關鍵詞分組，並非語意模型或成熟度評分。
- 主標題與摘要取群組最近的新聞；詳情清楚標為來源摘要與入選依據，不新增無來源的研究結論。`verified === true` 才顯示已通過網站驗證，其他一律待確認。
- 走勢是按文章發布日期分組的本站收錄篇數，非市場熱度、不是百分比。未取得當日快照的日期為 null／「—」，不得補零或補線。焦點可重疊，不做總和100%的市佔圖。
- 前後兩個七日視窗都取得完整日快照時，前窗無篇數顯示「本窗新見」、本窗較少顯示「收錄減少」、其餘「持續出現」；資料不完整一律「近期焦點」，不宣稱新興或降溫。這些狀態只描述已觀測收錄量。

### 載入與相容邊界

- 趨勢持有獨立 latest 快照，切換歷史新聞不會改變趨勢截至日；不依賴可被歷史切換修改的全域 DATA。
- 重試使用請求序號丟棄舊回應；歷史補齊保留使用者選題、說明區展開及焦點。冷層摘要只補既有觀測區，不重設新焦點。
- 原新聞自動更新提示仍有效；點選新版提示重新載入可取得新焦點，儀表板也有獨立重新整理按鈕。未變更擷取排程、模型 runner、preview promotion、Firebase 寫入或權限。
- 實作與驗證入口見 `docs/shapes/trend-briefing.md`。部署狀態以遠端提交和 Pages 的同 SHA 成功紀錄為準，不以本段文字宣告。
