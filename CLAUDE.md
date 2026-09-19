# AI News Hub — Claude Code / Codex 共用專案規範

> 本檔是兩個開發工具共用的工作規則與索引；根目錄 `AGENTS.md` 只負責指向本檔。修改規則時只改本檔或索引指定的權威文件，不建立工具別副本。
> 設計目標：首次部署後自動運作，每天上午 10:00 擷取後可閱讀最新資料。

## 啟動與文件分工

1. 先完整讀本檔，再讀 `HANDOFF.md` §0–§1；依本次工項只讀相關施工單、規格與 shape，不整份讀交接或整目錄掃描。
2. `CLAUDE.md` 管共用工作規則；`HANDOFF.md` 管當前狀態、決策與下一步；`docs/specs/` 管功能與架構規格；`docs/shapes/` 管資料形狀與程式定位。每項資訊在對應位置維護，其他文件只引用。
3. `docs/legacy/` 是歷史紀錄，不能當作目前待辦或直接執行其中指令。已拍板但未實作的設計，必須明確標示，不能當作線上現況。
4. 使用者在本次工作的明確授權與修正優先於舊專案約定；發現衝突先核對日期、適用範圍及實際程式，再更新對應文件，不以私人記憶覆蓋共用決策。

## 新聞品質原則

- 真實性最優先：來源 URL 必須有搜尋結果或已核實來源，禁止捏造；找不到就少收。
- 深度優於廣度：摘要需有技術細節、數據佐證與產業意義；台灣／中國類別使用中英文搜尋。
- 繁體中文輸出：除原文標題與專有名詞外，摘要、重點與說明均用繁體中文。
- 時效性：topnews/taiwan/china/usa 限今天＋昨天；techtrends/governance 限 7 天；累積類別（模型／教學／課程）搜尋近 3 個月。排程與各類細節見下方索引。
- 新聞優先 Agent、LLM、技術大廠模型與產品、應用及資安；各分類的具體優先順序與欄位只在 `docs/specs/categories.md` 維護。

## 架構與維護邊界

- 前端為 vanilla JS 模組化、零 build；不得重新內聯成單檔。模組清單與固定載入順序只在 `docs/specs/architecture.md` 維護。
- 儲存採 static JSON 熱層與 Firestore 冷層；配置與機密界定見架構規格。不得編造 `FIREBASE_CONFIG`、`WRITER_UID` 等 placeholder，或擅自替換已設定的值。
- repo 公開。帳密與 `*.env`、`OPS-RUNBOOK.md`、`data/agent/.preview/` 等受忽略內容不得納入版控；不得移除相關忽略規則。禁止讀取的機密範圍見 `HANDOFF.md` §4。
- 擷取／驗證鏈運作中，未明確要求時只驗證，不重寫 `scripts/run-daily.sh`、`scripts/validate.py` 等後端流程；不可在正式工作目錄執行會覆寫活提示詞的 `scripts/setup-prompts.sh`。
- `agents/*/AGENTS.md` 是自動化代理的執行憲章，會被 runner 載入；不是根目錄開發規範的副本，不因文件去重而刪除、合併或改變其角色。維護該目錄時依對應 shape 讀取契約。
- auto-opt 邊界不變：不得將 `promote.sh --promote` 加入 `run-agents.sh` 自動流程；原始評分／標題／URL／人工評語只留 `~/.ai-news-hub/learning/`；`memory/**`、`skills/**` 維持人工審核專屬，`agents/_control/**` 不進 auto-apply allowlist。
- `.claude/settings.json` 與 Codex 的權限／工具設定各自生效；Markdown 規則不能代替權限控制。不得為了共用文件自動同步、放寬兩端權限或搬移憑證。

## 規範索引（要改 X → 先讀對應檔）

| 要改的目標 | 權威文件 |
|---|---|
| 架構、專案結構、載入順序、防快取、Firebase 冷熱層與機密界定 | `docs/specs/architecture.md` |
| 時區、每日／每週分類排程、`_updated_at` | `docs/specs/schedule.md` |
| 新聞分類的來源、優先主題與欄位 | `docs/specs/categories.md` |
| `data/latest.json`、`data/health.json` 格式 | `docs/specs/data-formats.md` |
| `scripts/run-daily.sh` 擷取與每日 Git 整合行為 | `docs/specs/run-daily.md` |
| `scripts/validate.py`、Tier B、日期上限 | `docs/specs/validate.md` |
| GitHub Actions 健康檢查與保活 | `docs/specs/workflows.md` |
| Cloudflare Pages、GitHub 部署來源、發佈包與回退 | `docs/specs/deployment.md` |
| 架構強化 living backlog、Session 相依與 release gates | `docs/specs/architecture-hardening-v1.md` |
| 排程安裝、launchd、電源與喚醒 | `docs/specs/setup-scheduler.md` |
| 前端 UX、趨勢儀表板與待實作設計 | `docs/specs/frontend-ux.md` |
| 雙訊號學習迴圈 | `docs/specs/learning-loop-v1.md` |
| 企業生態系官方資訊／模型快訊調研、來源核驗與研究輸出 | `skills/official-ai-ecosystem-research/SKILL.md` |
| auto-opt 程式、資料 shape、代理契約定位 | `docs/shapes/README.md` → 對應單檔 |
| 當前狀態、施工單、使用者已拍板決策 | `HANDOFF.md` |

## 讀檔與任務紀律

1. 大檔先用 `rg -n` 找行號，再以 `sed -n START,ENDp` 按段讀取，單次不超過 150 行；規範索引已足夠時，不重讀整份檔案。
2. `data/*.json`（含子目錄）只用程式印 keys／len／必要欄位／前 3 筆；禁止 `cat` 整份資料及 `python3 -m json.tool`。兩端都遵守，不假設 Claude 的 deny 設定會自動套用到 Codex。
3. 先查對應 shape；缺少資訊再讀原始碼，實作造成 shape 變更時同步更新。純調研發現的缺口先記交接，不能把未驗證推論寫成事實。
4. 廣泛調查在工具支援時交給只讀探索子代理，主工作階段只收結論；無此能力時由主代理依索引分段調查，不依賴固定名為 Explore 的角色。
5. 一個工作階段聚焦一份施工單或一個明確工項；Phase 可拆成多個工項，不把「一個工項」誤解為一次完成整個 Phase。
6. 新檔可用 heredoc；同一檔多處修改集中處理；修改後只讀必要差異並驗證，不反覆全文輸出。
7. 長任務、切換工具或上下文將滿時，先更新交接再接續。工具支援時另開新工作階段；若系統自動摘要，從共用文件恢復，不將聊天摘要或私人記憶當作唯一交接。
8. 多 Session 工程依 `HANDOFF.md`／對應 living backlog 的工項 ID 逐次執行，一個 Session 只做一個工項。每次完成並更新交接後，最終回覆必須附上「下一個 Session 可直接貼上執行的完整 Prompt」，至少包含專案路徑、必讀文件、工項 ID、前置條件、變更範圍、勿動範圍、驗收、提交／推送與交接要求；若 backlog 已完成，明確寫無下一工項，不虛構 Prompt。

## 共同開發與提交

- 開始前確認工作目錄、分支、基準 commit 與 `git status`。既有變更不得覆蓋、回退或混入自己的提交。
- 每日排程的 checkout 固定保留給排程；開發預設使用獨立 worktree／分支。同一工項、同一檔案在同一時間由一位負責者修改；兩工具並行時各用自己的 worktree，不共用 Git index。
- 切換工具時，在 `HANDOFF.md` §0 的工項記錄：工項 ID、負責工具、分支／基準 commit、變更範圍、完成／未完成、驗證結果與下一步。跨 worktree 接手先同步該分支；共用文件不代表未提交內容會自動同步。
- 完成授權工項、通過相應驗證後，只提交該工項檔案並立即 push 到對應工作分支。整合由一位整合者進行；操作主分支前確認排程未執行、主工作目錄乾淨、遠端狀態已核對，再整合並立即 push。不得 force-push 或把別人的暫存內容一併提交。
- Commit 署名依實際參與工具與可確認的身份填寫；不固定套用某個 Claude 型號，不冒用另一工具身份。舊提交與歷史施工單中的署名不回寫。
- 技術上已完成、已 commit、已 push、已部署、已驗收分開記錄；沒有實際證據就保留待驗證，不能因程式存在而宣告端到端完成。

## 驗證與完成條件

- 文件變更：檢查差異空白、引用路徑、歷史搬移完整性，以及規則／決策是否只有一個維護位置。變更入口規範時，以兩工具的新工作階段做只讀載入驗證，確認能找到最新決策；不能執行時記錄原因。
- 前端變更：逐檔執行 `node --check`（例如 `for f in assets/js/*.js; do node --check "$f" || exit; done`），啟動本機 HTTP server 做受影響操作的 smoke test，並執行 `node scripts/archive-to-firestore.mjs --dry-run`。不可把一次 `node --check assets/js/*.js` 當成已檢查所有檔案。
- 後端變更：依施工單執行既有 self-test／dry-run；不要為了驗證而重跑正式擷取、發文、推送或覆寫活資料。
- 完成後更新對應 spec／shape 與交接，報告變更、驗證、剩餘限制。Claude Code 的 slash commands、Codex 的工作階段操作依實際可用工具使用，不假設另一工具也提供相同指令。
