# 熱門 Agent Skills

權威分類與納入門檻見 [categories.md](../specs/categories.md)，排程見 [schedule.md](../specs/schedule.md)。

| 目標 | 程式／資料 | 行為 |
|---|---|---|
| 候選白名單 | `scripts/skills-repositories.json` | 僅放已人工確認的跨工具 Skill／技能包；不是自動安裝清單 |
| GitHub 資料 | `scripts/fetch-skills.mjs` | 讀官方 REST API、整批驗證、星數排序、原子寫入 `data/skills.json`；任一 repo 失敗不覆寫 |
| 每日整合 | `scripts/run-daily.sh` | 每天先更新 Skills；失敗時保留既有檔，再與其他分類合併及驗證 |
| 前端 | `assets/js/data.js`、`config.js`、`render.js`、`index.html` | 當前榜單獨立載入，顯示星數、型態、領域、授權、支援工具與最近維護日；搜尋與書籤共用既有機制 |
| 回歸 | `scripts/tests/fetch-skills.test.mjs` | 驗證排序、授權缺值與 archived repo 整批拒絕 |

`skills` 只服務榜單與搜尋，不進入 `scripts/agent/lib/corpus.mjs` 的新聞趨勢、學習、提案及 canary 語料；補跑新聞時由 `data/skills.json` 原樣帶回 `latest.json`，避免分類遺失或污染既有十類內容指標。

GitHub 星數是 repo 層級人氣訊號，不是安全、品質或單一 Skill 使用量。本站只提供來源連結，不自動下載或安裝第三方 Skill。
