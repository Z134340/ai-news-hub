# learning-loop v1 — 雙訊號自主優化迴圈（icon 回饋 × 趨勢探索）

> 2026-09-10 拍板。權威規範；施工單在 `HANDOFF.md` §7（每列一個 session）。改本檔不必同步回 CLAUDE.md。
> 所有數字皆為經驗值起步值（非文獻），只放 `agents/_control/canaries.json`，由 canary 實跑後調整。

## 1. 目標

讓每晚的搜尋主題與排序，由兩個訊號共同驅動，且不依賴任何人工檢核：

| 訊號 | 來源 | 現況（2026-09-10 實測 `[已驗證]`） | v1 要達到的狀態 |
|---|---|---|---|
| 利用（exploitation） | 使用者在站上按 好／中／不好 icon → Firestore `feedback/` → `pull-feedback.mjs` → 帳本 `human_rating` | 管線程式正確但**從未收到資料**：`--dry-run` 回 `scanned=0`、帳本 115 筆全是 `outputs_generated`、`metrics-history.jsonl` 50 列 `human_rating_count:0`，系統狀態卻仍綠燈（靜默失敗） | 評分進入排序權重；訊號斷線時自動黃燈並寫帳本事件 |
| 探索（exploration） | 各分類官方站與知名站的 RSS/Atom（Node fetch，硬驗證）＋ WebSearch 探索提示（補充） | 不存在；搜尋 100% 靠 `claude -p` WebSearch，無新興議題發現機制 | 每晚產出「新興候選」，保證固定比例的搜尋與排序名額給候選，避免同溫層 |

一句話：**icon 是唯一的人工輸入；其餘閘門全部機械化**（閘 2 rubric、canary、回退、震盪凍結）。

## 2. 優先順序與 tradeoff

| 優先 | 方案 | 成本 | 效益 | Tradeoff |
|---|---|---|---|---|
| 1 | 方案 1 混合：RSS/Atom 為主要可驗證來源，WebSearch 探索提示為補充 | 1 支 Node 腳本、1 份來源登錄檔；零新付費服務 | 來源可稽核、URL 不會捏造；WebSearch 補 RSS 缺口 | RSS 覆蓋窄（部分官方站無 feed）；需維護登錄檔 |
| 2 | 純 WebSearch 探索提示 | 最低 | 零維護 | 無硬驗證，候選品質不可稽核，違反 loop 鐵則 1 |
| 3 | 付費趨勢 API（如 Google Trends 第三方） | 新增月費 | 訊號強 | 違反成本紀律；不採 |

其他已決定的取捨：探索配額 25%、單一來源上限 30% 加 HHI 上限、回饋權重 0.15 都是起步值；P5 技術債與 P0–P4 分開排；不引入 bandit／ML 函式庫；機器永不寫 `memory/**`；不做曝光追蹤；`promote.sh` 不加 `--promote`。

## 3. 元件（C1–C8）

| 元件 | 做什麼 | 落點 | 紅線 |
|---|---|---|---|
| C1 訊號接排序 | 依 `human_rating` 事件算每分類、每來源網域的親和度（半衰期 30 天，好=+1／中=0／不好=−1），成為 `build-insights.mjs` WEIGHTS 第 7 項 `feedback`（0.15） | `scripts/agent/build-insights.mjs`；聚合值只寫 `.preview/feedback-affinity.json` | 原始評分／標題／URL 只留 `~/.ai-news-hub/learning/` |
| C2 訊號健康閘 | 每晚檢查：①最近 N 晚（起步 7）`human_rating_count` 全 0；②Firestore 有文件但 pull 回 0（cursor 卡住）。任一成立 → `data/agent/signal-health.json` 標 `yellow`、帳本 `signal_health` 事件、儀表板黃燈 | `scripts/agent/check-signal-health.mjs`、`run-agents.sh` 步驟 `00e-signal-health`（非阻塞） | 只寫聚合數字（計數、日期），不寫 uid |
| C3 來源登錄 | `scripts/sources-registry.json`：每分類官方站與 RSS/Atom URL、tier（A 官方／B 知名／C 社群）；`scripts/tier-b-domains.json` 真的建立並接進 `validate.py` | `scripts/sources-registry.json`、`scripts/tier-b-domains.json`、`scripts/validate.py` | Tier B 只增不減；`apply-change.mjs` 對 tier-b 檔仍限 marker 區段 |
| C4 探索管線 | `discover-trends.mjs`：Node fetch 登錄檔的 feed（併發 ≤ 5、逾時 10 秒、總上限 90 秒），比對 90 天語料算新穎度，輸出 `.preview/emerging-candidates.json`；週一 trend-analyst 讀作輸入 | `scripts/agent/discover-trends.mjs`、`run-agents.sh` 步驟 `00f-discover-trends`（非阻塞） | 不用付費 API；16GB 機器不高併發；失敗即空清單、不阻塞 |
| C5 探索配額 | `build-insights.mjs` 排序後保留 25% 名額給候選；任一來源網域佔比 > 30% 或 HHI > 上限即降權補位 | `build-insights.mjs`；數字在 `canaries.json` 的 `exploration` 區塊 | 數字只在 canaries.json，程式不寫死 |
| C6 候選進閘 1 | `build-search-review-input.mjs` 把候選附進 search-reviewer 輸入，提案型別新增 `add_query`（走既有 `patch:{add,list}`） | `scripts/agent/build-search-review-input.mjs`、`agents/search-reviewer/` prompt | 提案仍走閘 2 與 apply-change 配額 |
| C7 前端 | 不加新 icon；未登入時在評分按鈕旁以既有 `svg()` 加「登入後才同步」提示 | `assets/js/bookmarks.js` | 不用 emoji |
| C8 迴圈硬化 | ①閘 2 輸出統一 VerdictReport（`{overall, score, items:[{check_id,status,evidence,location}]}`）；②同一提案被 canary 回退 2 次即凍結（`canaries.json` `freeze_after_reverts:2`），寫 `proposal_frozen` 事件；③模型步驟顯式 `--model` | `newshub_change_evaluator.py`、`canary-check.mjs`、`newshub_agents.py` | 不放寬 HARD_DENY；不新增計費 |

## 4. loop 步驟（每晚 18:00，接在既有 `run-agents.sh`）

| 步驟 | 名稱 | 讀 | 寫 | 阻塞 |
|---|---|---|---|---|
| 00 | pull-feedback（既有） | Firestore | 帳本 `human_rating` | 否 |
| 00b | category-metrics（既有） | latest.json、帳本 | `metrics-history.jsonl` | 否 |
| 00c | canary-check（既有，C8 加凍結） | metrics-history、staged | 回退／凍結事件 | 否 |
| 00e | signal-health（C2） | metrics-history、pull-feedback 輸出 | `signal-health.json`、`signal_health` 事件 | 否 |
| 00f | discover-trends（C4） | sources-registry、90 天語料 | `.preview/emerging-candidates.json` | 否 |
| 05 | insights（C1、C5） | 帳本親和度、候選 | `insights.json`（含 `exploration_share`） | 否 |
| 08a–08e | 閘 1 → 閘 2 → apply（既有，C6 加候選、C8 VerdictReport） | 候選、提案 | marker 區段、canary 狀態 | 否 |
| 08f | weekly-report（既有；改為**可選**） | 帳本 | `.preview/weekly-report.*` | 否 |

終止條件（不可關）：每週 3 件、每分類 1 件、canary 3 晚、掉 10 pp 回退、同案 2 次回退凍結。

## 5. 不可越權邊界

| 邊界 | 規則 |
|---|---|
| 人工檢核 | **不在關鍵路徑**。Slack 週報／picks／判例貼進 memory 全部改為可選，缺 `slack.env` 直接跳過，不影響任何閘門 |
| 記憶 | 機器永不寫 `memory/**`、`skills/**`、`agents/_control/**`、`.github/**`、`hermes.project.yaml` |
| 資料 | `data/agent/.preview/` 永遠 gitignore；原始評分／標題／URL／uid 只留 `~/.ai-news-hub/learning/`；repo 只放聚合數字與 id |
| 成本 | 既有 Claude Code 訂閱；RSS 用 Node 內建 fetch；不引入付費 API |
| 排序公平 | 探索配額與集中度上限不得為 0；數字只在 `canaries.json` |
| 發布 | `promote.sh` 不加 `--promote`；commit 完立刻 push |

## 6. 施工單分工（每列一個 session；細節與驗收見 `HANDOFF.md` §7）

| 工項 | 對應元件 | 估工 | 前置 |
|---|---|---|---|
| L-0 訊號健康閘 | C2 | 1 session | 無 |
| L-1 端到端驗證 | C7 ＋ 使用者登入點 3 則 | 1 session ＋ 使用者 5 分鐘 | L-0 |
| L-2 訊號接排序 | C1 | 1 session | L-1 帳本有 ≥ 3 筆 `human_rating` |
| L-3 來源登錄 | C3 | 1 session | 無（可與 L-0 並行） |
| L-4 探索管線 | C4 | 1 session | L-3 |
| L-5 探索配額 | C5 | 1 session | L-4 |
| L-6 候選進閘 1 | C6 | 1 session | L-4 |
| L-7 迴圈硬化 | C8 | 1 session | 無 |
| L-8 技術債 A（setup-prompts、重複函式） | P5 | 1 session | L-0～L-7 之後 |
| L-9 技術債 B（孤兒目錄、快取、文件漂移、CI 自測） | P5 | 1 session | L-8 |
