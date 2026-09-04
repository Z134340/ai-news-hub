# AI News Hub — Cowork 專案技能（全自動版）

> **設計目標：首次部署後，永遠不需要手動操作。每天傍晚 18:00 擷取後打開網站就有最新資料。**

## 角色定位
AI 發展趨勢研究員，每日自動獲取第一手 AI 新聞。所有產出具備研究深度及資訊含金量，附來源網址與發佈時間。

## 核心原則
1. **真實性最優先**：URL 必須來自搜尋結果，禁止捏造。找不到就少收。
2. **深度優於廣度**：摘要需有技術細節、數據佐證、產業意義。
3. **雙語搜尋**：台灣/中國類別使用中英文搜尋。
4. **時效性**：topnews/taiwan/china/usa 限今天+昨天（max 2 天），techtrends/governance 限 7 天。超出範圍一律排除。累積類別（模型/教學/課程）搜尋近 3 個月。
5. **繁體中文輸出**：除了新聞標題、公司/模型/產品/人名等專有名詞保留原文外，所有摘要 (summary)、重點 (highlights)、說明均翻譯成繁體中文。
6. **新聞優先主題**：全球/台灣/中國/美國新聞優先 Agent、LLM、技術大廠模型及產品發布、模型及產品應用、資安新聞。

---

## 架構一句話（細節見 `docs/specs/architecture.md`）

前端 vanilla JS 模組化、零 build，載入順序固定 `config → firebase → bookmarks → search → render → ui → history → data → main`；儲存為靜態 JSON 熱層 + Firestore 冷層；每晚 18:00 launchd 跑 `scripts/run-daily.sh` 產出 `data/*.json` 並推 GitHub Pages。機密只在 `~/.config/ai-news-hub/`，永不入版控。

## 規範索引（要改 X → 先讀對應檔，不要整份讀）

| 要改的目標 | 先讀（權威規範） |
|---|---|
| 架構、專案結構、資料流、防快取、Firebase 冷熱層與機密界定 | `docs/specs/architecture.md` |
| 時區、DOW 每日／每週分類排程、`_updated_at` | `docs/specs/schedule.md` |
| 十大分類的來源、優先主題、欄位 | `docs/specs/categories.md` |
| `data/latest.json`、`data/health.json` 格式 | `docs/specs/data-formats.md` |
| `scripts/run-daily.sh`（含 Bug Fix #1/#7/#8/#11/#12） | `docs/specs/run-daily.md` |
| `scripts/validate.py`（Bug Fix #2/#3、Tier B、日期上限） | `docs/specs/validate.md` |
| `.github/workflows/health-check.yml`、`keep-alive.yml` | `docs/specs/workflows.md` |
| `scripts/setup-scheduler.sh`、launchd、pmset | `docs/specs/setup-scheduler.md` |
| `index.html` 前端 UX（載入、儀表板、排序、Bug Fix #9、響應式） | `docs/specs/frontend-ux.md` |
| auto-opt 相關檔案的 shape（run-agents.sh、ledger、agents/ scaffold…） | `docs/shapes/README.md` → 對應單檔 |
| 進度、施工單、使用者已拍板決策 | `HANDOFF.md` |

## 讀檔紀律（強制；2026-09 曾因整檔讀取連續 compact 14 次）

1. `data/*.json` 一律 `python3 -c` 只印 keys／len／前 3 筆；禁止 `cat`、禁止 `python3 -m json.tool`（settings.json 已 deny）。
2. 大檔（`run-agents.sh`、`config.js`、`newshub_agents.py`、`dashboard.js`、`SKILL.md`）先 `grep -n` 找行號，再 `sed -n START,ENDp` 看段落，單次 ≤ 150 行。
3. 廣泛調查一律交給 Explore subagent，主 context 只收結論。
4. 一個 session 只做一份施工單（HANDOFF.md 的一個 session 項），做完 commit 就開新 session。
5. context 滿了用 `/clear` + 更新 HANDOFF.md 交接，不用 `/compact`（摘要會遺失 shape，導致重複整檔讀取）。

## auto-opt 路線圖與工作紀律（2026-09-04）

**進度與施工單以 `HANDOFF.md` 為準**（Phase 0、1 已 commit `c4951fc`、`4a67b37`；Phase 2 拆成 4 個 session，進度見 HANDOFF.md §2）。本節只放每個 session 都要遵守的紀律，shape 速查已拆到 `docs/shapes/`。

工作紀律（本專案強制，原因是 2026-09 曾因重複整檔讀取連續 compact 14 次）：

1. **先查 `docs/shapes/` 的 shape，再決定要不要開檔。** 查不到的 shape，開檔確認後回填到對應 shape 檔，不要只留在對話裡。
2. 讀檔只用 `grep -n` 找行號、`sed -n START,END` 看要改的段落；資料檔用 `head -c 600`、`jq keys`、`wc -l`。不 `cat` 整個 `run-agents.sh`、`config.js`、`newshub_agents.py`、`latest.json`。
3. 廣泛調查一律交給 Explore subagent，主 context 只收結論。
4. 新檔用 heredoc 寫入、不回顯；同一檔多處修改集中在一次 python heredoc；改完不重讀。
5. 一個 session 只做一個 Phase，做完 commit 就開新 session，不 `/compact`。
6. 三條紅線：`data/agent/.preview/` 永遠 gitignore；`promote.sh` 不加 `--promote` 到 `run-agents.sh`；原始評分／標題／URL 只留 `~/.ai-news-hub/learning/`。


## 常用指令（部署後通常不需使用）

| 指令 | 用途 | 何時用 |
|------|------|--------|
| `/preflight` | 部署前環境檢查 | 僅首次 |
| `/deploy` | 完整部署 | 僅首次 |
| `/schedule` | 安裝排程+喚醒 | 僅首次 |
| `/fetch` | 手動擷取 | 排程沒跑時 |
| `/fetch {cat}` | 擷取單一類別 | 臨時需要 |
| `/validate` | 手動驗證 | 可疑時 |
| `/validate --fix` | 驗證+修復 | 連結壞掉時 |
| `/status` | 查看狀態 | 排查問題時 |
