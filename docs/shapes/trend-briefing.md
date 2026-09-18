# 動態趨勢簡報定位（2026-09-18）

權威行為與數值門檻只在 [frontend-ux.md](../specs/frontend-ux.md) 的 A 版章節維護。

| 目標 | 程式／函式 | 輸入／輸出 |
|---|---|---|
| 公開新聞分組 | `assets/js/trend-topics.js`：`TrendTopics.build` | snapshots[]、截至日 → `{end,start,dates,topics,past,observed,articleCount}`；純函式，無網路／儲存副作用 |
| 群組 | 同上 | `{id,label,terms,articles,recent,previous,headline,summary,meaning,sources,count,status,latest,series,score}`；series `{date,count:number|null}`；ID 是詞組 JSON，不是固定分類 ID |
| 來源正規化 | `TrendTopics.canonicalURL/day/validSnapshot/terms` | 有效絕對 HTTP(S)、日曆日期、新聞快照與詞組；不同語言 Segmenter 支援限制見 spec |
| A 版 UI | `assets/js/trend-briefing.js`：`renderTrendBriefing/briefingDetail/briefingChart/bindTrendBriefing` | `BRIEFING` 保存 model、selected、expanded、pending；HTML 使用 esc，互動以 data attributes delegation |
| 載入隔離 | `assets/js/dashboard.js`：`loadDashboard` | `DASH.news` 固定最新來源，request 防舊回應；原發布 agent artifacts 平行取檔；歷史 payload 補齊後更新 A 版 |
| 原分類區 | `renderLegacyDashboard` | lazy details；冷層摘要只影響這區；同一 request 的 timeline 更新清除 `_bump` |
| 樣式與頁籤 | `assets/css/trend-briefing.css`；`assets/js/ui.js`、`search.js` | body `trends-active` 只控制 dashboard 布局；離開關閉原抽屜；全站顏色入口見 `site-theme.md` |
| 回歸 | `scripts/tests/trend-topics.test.mjs`、`scripts/tests/frontend.test.mjs`、`scripts/agent/verify-dashboard-system-status.mjs` | 動態分組、去重、缺日、時窗標籤、上限、穩定詞組 ID、載入競態、歷史隔離、安全 HTML |

載入順序只在 architecture.md 維護。新設計不讀 `.preview` 或私人回饋，也不觸發模型、擷取或寫入。
