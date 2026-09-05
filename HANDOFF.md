# HANDOFF.md — 交接狀態（2026-09-04：auto-opt 自我強化迴圈）

> **新 session 先讀這份 §0–§2，再只讀 §2 你那個 session 指定的那一份 `docs/shapes/*.md`。不要整檔讀，不要 `/compact`；context 滿了就更新本檔後 `/clear`。**
> 舊 session `專案檔案討論` 已連續 14 次 compact 後失效，原因是每次摘要都遺失檔案 shape，導致重複整檔讀取。shape 已固化進 `docs/shapes/`（每檔 1–3 KB，索引在 `docs/shapes/README.md`），規範拆到 `docs/specs/`，CLAUDE.md 只剩 5 KB 索引。本檔只記「做到哪、接下來做什麼、什麼不能碰」。

## 0. 一句話現況

Phase 0、Phase 1、Phase 2-A（2-1、2-2）、Phase 2-B（2-3，commit `ce88f38`）與 Phase 2-C（2-4、2-5，commit `a68e01b`）與 Phase 2-D（2-6、2-7，commit `89255d1`）已 commit 並 push；Phase 2 全部完成；`data/agent/metrics-history.jsonl` 已被 2026-09-04 的每晚 commit `e0f71a4` 掃進版控（tracked），此後由 `run-agents.sh` 的 `00b-category-metrics` 每晚產出；**注意：Phase 2-A 原 commit `8a2d97a` 與 docs 拆分 commit `8e75a91` 都已被 `run-daily.sh` 第 705 行的 `git reset --soft origin/main` 折進 `e0f71a4` 並一起 push 上去（內容完整、hash 作廢），詳見 §4 最後一條**；2026-09-04 另有一個 commit 把 CLAUDE.md 拆成 `docs/specs/` + `docs/shapes/` 並封鎖 `json.tool`／`cat data/*.json`。工作樹另有 `data/*.json` 的每日更新差異（run-daily.sh 產物，不是任何 Phase 的東西，不要手動 commit，也不要 checkout 掉）。

| Phase | 內容 | 狀態 | Commit |
|---|---|---|---|
| tag `pre-auto-opt` | Phase 0 之前的基線 | 已打 tag | `8338bc0` |
| 0 | `PRIORITY_KEYWORDS` 資料化、10 個 prompt 加 marker region、contract v2、`run-agents.sh` 預算 2100（S-5 ×5）、`health-check.yml` 改 UTC 12:00、`run-daily.sh` 補入項目標 `is_backfill` | 已完成 | `c4951fc` |
| 1 | 前端 好/中/不好 按鈕 → localStorage `ainews-fb` → Firestore `feedback/{uid}_{key}` → `pull-feedback.mjs` → 帳本 `human_rating` → `replay-learning.mjs` 聚合成 `learning_summary.human_ratings`；`run-agents.sh` step 00 非阻塞 + S-6i | 已完成（使用者手動項見 §3） | `4a67b37` |
| 2 | 拆成 4 個 session（見 §2）：S2-A canaries + metrics；S2-B run-agents 接線；S2-C search-reviewer scaffold + input；S2-D `newshub_search_reviewer.py` + 08b 接線 | **S2-A 已 commit（折進 `e0f71a4`）；S2-B 已 commit `ce88f38`；S2-C 已 commit `a68e01b`；S2-D 已 commit `89255d1`** | S2-A `e0f71a4`（原 `8a2d97a` 懸空）；S2-B `ce88f38`；S2-C `a68e01b`；S2-D `89255d1` |
| 3 | `agents/change-evaluator/`、`apply-change.mjs`、`canary-check.mjs`、週報判例摘要 → Slack Iris 讀回 | 進行中：S3-A 已 commit `5e99f7c`、S3-B 已 commit `663d16a`（change-evaluator runner + 08c/08d，Plan A 350×6）、S3-C 已 commit `ffe6a9e`（apply-change.mjs + 08e／run-daily staged git add）、S3-D 已 commit `f5a2396`（canary-check.mjs + 00c、staged.txt 改追加、S-2c 擴掃）、S3-C2 已 commit `614c4f5`（patch 欄位補齊：閘1 `_valid_patch`、08c 保留 patch＋配額只算 production_applied、08e A-10）；S3-E 已 commit `9c31aff`（週報＋slack-notify＋08f）、S3-F 已 commit `ba9db05`（read-slack-picks＋00d）；**Phase 3 程式碼全部完成**，剩 §3 人工項（Slack app／slack.env）填好後 08f／00d 才會真的送與讀 | — |
| 4 | `scripts/tier-b-domains.json` 由 `validate.py` 讀取（add-only） | 未開始 | — |
| 收尾 | CLAUDE.md 補 dashboard.js 載入順序、新步驟；狀態盤點表 | 未開始 | — |
| S-PWR | 電池模式偵測與 17:50 電源提醒（方案 1 加 2，獨立施工單） | 已 commit 並 push；P-1／P-2／P-3 全做，plist 已裝、`launchctl list` 兩個 label 都在；拔電源 kickstart 通知已由使用者驗過（剩電池模式整跑，見 §3） | `62a9a65` |
| 跨專案調度 | Hermes 管制塔／launchd 引擎／Iris 櫃台；fleet.yaml 單一真相、時窗重排、清債（見 §6，施工單 F-0～F-4） | 已盤點並規劃（2026-09-05）；§6.4 A 已拍板 commit，F-0 修訂版見 §6.3a；B 預設 B1 | — |

## 1. 使用者已拍板的決策（不要再問）

1. 延伸既有學習迴圈（ledger → proposals → replay），不建第二套迴圈。
2. `memory/**` 維持人工專屬；機器只把判例預覽整理成週報 Issue，經 Slack Iris 送出，使用者在 Slack 內點選要收的項目。
3. contract v2 邊界字串只改本 repo；Hermes-Agent 真本不動。
4. 新網域走 Tier B、只增不減，清單放 `scripts/tier-b-domains.json`；`agents/_control/**` 刻意**不**列入 auto-apply allowlist。
5. 自動套用上限：每週 3 件、每分類 1 件、canary 3 晚、指標掉超過 10 個百分點即回退；先照這組數字跑一個月，再用 `data/agent/metrics-history.jsonl` 實際波動調整；數字只放 `agents/_control/canaries.json`，改數字不能需要改程式。
6. 模型步驟一律 pop `ANTHROPIC_API_KEY`、`--allowedTools ""`、`--permission-mode plan`，用既有訂閱，不引入額外計費。
7. 每個 Phase 各自 commit（trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`），**commit 完立刻 push**（2026-09-05 使用者拍板；原「push 只在使用者明講時」作廢，原因見 §4 最後一條）。

## 2. Phase 2 施工單（拆成 4 個 session，每個 session 只做一列、只讀一份 shape 檔）

Phase 2 原本一個 session 做完會連續 compact（實測 14 次），所以拆成 4 個。**每個 session 開頭的 prompt 固定寫：「先讀 HANDOFF.md §0–§2，只做 S2-X，只讀它指定的那份 docs/shapes 檔，做完 commit 並 push。」** 做完一列就把「磁碟現況」欄改成「已 commit `<hash>`」，再開下一個 session。

| Session | 對應項目 | 磁碟現況（2026-09-04） | 唯一要讀的 shape 檔 | 驗收（做完才 commit） |
|---|---|---|---|---|
| S2-A | 2-1 `agents/_control/canaries.json`；2-2 `scripts/agent/build-category-metrics.mjs` → `data/agent/metrics-history.jsonl` | 已 commit（原 `8a2d97a`，2026-09-04 晚被 run-daily 折進 `e0f71a4`，內容經 `git diff 8a2d97a HEAD` 核對相同；驗收全過：self-test T-1..T-19、dry-run 不落地、同日兩次皆 10 行、http 計數 0） | `docs/shapes/data-agent-json.md` | `node scripts/agent/build-category-metrics.mjs --self-test` 通過；`--dry-run` 不落地；同日再跑一次 jsonl 行數不變；`grep -c 'http' data/agent/metrics-history.jsonl` 為 0；commit「Phase 2-A」 |
| S2-B | 2-3 `run-agents.sh` 加 `00b-category-metrics`（非阻塞）、S-1 清單、self-test chk | 已 commit `ce88f38`（2026-09-04；self-test 42 項 0 失敗、`git diff --check` 乾淨、dry-run 不落地、同日再跑 jsonl 仍 10 行、http 計數 0） | `docs/shapes/run-agents.md` | `bash scripts/run-agents.sh --self-test` 全綠；`git diff --check` 乾淨；commit「Phase 2-B」 |
| S2-C | 2-4 `agents/search-reviewer/` scaffold；2-5 `build-search-review-input.mjs` + `promote.sh` NEVER_FILES 追加 | 已 commit `a68e01b`（2026-09-05；兩個驗收指令全綠：T-1..T-13、P-1..P-8；`git diff --check` 乾淨；scaffold 18 檔對齊 trend-analyst 目錄層級）。修了兩件事：①T-3 原本用 truthy 判斷，techtrends／governance／tutorials／courses 的 PRIORITY 區段「存在但為空」被當缺席，改 `!= null`；②`.preview/` 頂層有 9 個 2026-08-16 的無 producer 孤兒 JSON 讓 P-2 失敗，**移到 `data/agent/.preview/_orphans-2026-08-16/`（未刪，gitignore 內）**，NEVER_FILES／SKIP_FILES 未動。golden manifest 在 2-6 driver 接上前只驗結構；SR-4 門檻未經多晚語料校準，≥14 晚後重校；Phase 3 接 auto-apply 時 `risk_profile: medium` 要重評 | `docs/shapes/agents-scaffold.md`（改 promote.sh 時另補 `docs/shapes/agent-scripts.md` 的 G 段，≤ 20 行） | `hermes.project.yaml` 有 `learning.mode: shadow`、`approval.*: manual_only`；`node scripts/agent/build-search-review-input.mjs --self-test` 通過；`bash scripts/agent/promote.sh --self-test` 通過，且 `grep -n NEVER_FILES scripts/agent/promote.sh` 含 `search-review-input.json`；commit「Phase 2-C」 |
| S2-D | 2-6 `scripts/newshub_search_reviewer.py`；2-7 `run-agents.sh` 加 `08b-search-review`、S-8／S-8b／S-1／S-5 調整 | 已 commit `89255d1`（S-5 維持 ×5：4×420=1680≤2100，×6 會超預算；另加 08a-search-review-input、S-6k／S-6l 自測、golden manifest `driver` 接上、hermes test_commands 加 `--selftest`） | `docs/shapes/newshub_agents.md`（改 run-agents.sh 那半段再讀 `docs/shapes/run-agents.md`） | `python3 scripts/newshub_search_reviewer.py --selftest` 通過；`node scripts/agent/check-agent-outputs.mjs --strict --self-test-boundary` 通過；`bash scripts/run-agents.sh --self-test` 全綠；commit「Phase 2-D」 |

S2-C 已在磁碟的檔案是前一個 session 寫的、沒驗過（S2-A 已驗收並 commit）：**先跑驗收指令，過了才 commit，不過就修，不要重寫。** 2-8 的單一「Phase 2」commit 改為四個 commit，trailer 不變。

### 獨立施工單 S-PWR：電池模式偵測與提醒（2026-09-05 拍板「方案 1 加 2」；不屬 Phase 2，不混進 S2-C）

session prompt 固定寫：「先讀 HANDOFF.md §0–§2，只做 S-PWR，只讀 `docs/specs/setup-scheduler.md` 與 `docs/specs/data-formats.md`，做完 commit 並 push。」

**狀態（2026-09-05）：已 commit `62a9a65` 並 push。** 三項都做了：P-1 `scripts/power-reminder.sh` + `setup-scheduler.sh` 裝第二個 plist（已跑過，`launchctl list | grep ainewshub` 兩個 label 都在；AC 下 kickstart 無通知、exit 0）；P-2 `run-daily.sh` 第 50 行後偵測 + health `power_source`（用假參數跑 HEALTH_PYEOF 區塊驗過：battery → `['電池模式執行（合蓋週期睡眠），5 類別回退']`，ac → 只留配額備註）；P-3 實際落點是 `assets/js/ui.js` `updateHeader()` 的 banner 區（`dashboard.js` 只渲染 agent 的 `artifact_health`，不碰 `data/health.json`），黃色橫幅「上次擷取：{errors[0]}」。拔電源 kickstart 通知已由使用者驗過（2026-09-05）。**未做的驗收**：電池模式整跑 run-daily.sh，列在 §3 使用者待辦。

| 項目 | 要做的事 | 檔案 | 驗收 |
|---|---|---|---|
| P-1 17:50 提醒 | 新增 launchd 工作 `com.ainewshub.power-reminder`（StartCalendarInterval 17:50），執行 `scripts/power-reminder.sh`：`pmset -g batt` 第一行不含 `AC Power` 就 `osascript -e 'display notification "18:00 擷取即將開始，請接電源" with title "AI News Hub"'`；AC 時不動作。plist 由 `scripts/setup-scheduler.sh` 一併安裝（照現有 `com.ainewshub.daily` 寫法，PATH 自帶 `/opt/homebrew/bin`） | `scripts/power-reminder.sh`（新）、`scripts/setup-scheduler.sh`、`~/Library/LaunchAgents/com.ainewshub.power-reminder.plist`（不入版控，由 setup 產生） | 拔電源 `launchctl kickstart -k gui/$(id -u)/com.ainewshub.power-reminder` 出現通知；接電源再 kickstart 無通知；`launchctl list \| grep ainewshub` 兩個 label 都在 |
| P-2 起跑標記 | `run-daily.sh` 第 44 行 caffeinate 段之後：`pmset -g batt` 判斷電源，電池模式時 `log "⚠️ 電池模式執行：macOS 合蓋會週期性睡眠，擷取可能逾時回退"`，並設 `POWER_SOURCE=battery`；最終 health 寫入（第 685–697 行 `health = {...}`）加欄位 `"power_source": "ac"\|"battery"`，電池模式時 `errors` 追加一筆「電池模式執行（合蓋週期睡眠），N 類別回退」。`docs/specs/data-formats.md` 的 health.json 範例同步加 `power_source` | `scripts/run-daily.sh`、`docs/specs/data-formats.md` | `bash -n` 通過；拔電源手動跑 `scripts/run-daily.sh`（可用 `/fetch` 單類別）後 `python3 -c "import json;h=json.load(open('data/health.json'));print(h['power_source'],h['errors'])"` 顯示 battery 與該筆 errors；接電源跑則 `ac` 且無該筆 |
| P-3 前端顯示（可選） | 先 `grep -n "health" assets/js/dashboard.js` 確認目前是否已渲染 `health.errors`；有就不動，沒有才在健康指標旁加一行顯示 `errors[0]`（純文字，不用 emoji，icon 用 svg） | `assets/js/dashboard.js`、`docs/specs/frontend-ux.md` | 本機開 `index.html`，health.json 手動塞一筆 errors 能看到；還原後看不到 |

紅線：不改 `pmset -b sleep`（合蓋仍會睡且耗電）；不引入方案 3 的補跑排程；`power_source` 只放 `ac`／`battery` 兩個值，不放電量。
背景數據（2026-09-05 查 `pmset -g log`）：08-30 電池 98% 跑 6h12m、2/7 成功；09-04 電池 78% 跑 4h15m、2/7 成功；09-01、09-03 AC 跑 25–28 分鐘、7/7 成功。

### 2-1～2-8 明細（原施工單，內容不變，供各 session 查規格）

| # | 工作項目 | 驗收條件 |
|---|---|---|
| 2-1 | 新增 `agents/_control/canaries.json`：`{"weekly_cap":3,"per_category_cap":1,"canary_nights":3,"revert_drop_pp":10,"auto_opt":{"enabled":true}}` | `check-agent-outputs.mjs` B-14 仍擋住此路徑；JSON 可被 `node -e` 讀取 |
| 2-2 | 新增 `scripts/agent/build-category-metrics.mjs`：每晚每分類 append 一行到 `data/agent/metrics-history.jsonl`（item 數、verified 率、needs_review 數、backfill 數、priority 命中率、human_ratings score、`validation.pass_rate`）；`--self-test`、`--dry-run`；同一日期冪等 | 只寫聚合數字，不寫標題／URL；缺 key 不 crash（models 用 `model_name/release_date`；tutorials/courses 可能無 `verified`） |
| 2-3 | `run-agents.sh`：step 00 之後加非阻塞 `run_step "00b-category-metrics" node "$AGENT_SCRIPTS/build-category-metrics.mjs"`；S-1 清單加入該檔；加一條 self-test chk | `bash scripts/run-agents.sh --self-test` 全綠 |
| 2-4 | 新增 `agents/search-reviewer/`（`AGENTS.md`、`SEARCH_RUBRIC.md`、`hermes.project.yaml` 照 trend-analyst 的 `adapter-contract-v1`、`golden/manifest.json` + cases、`memory/`、`.hermes/optimization-profile.json`） | 結構與 `agents/trend-analyst/` 對齊；`learning.mode: shadow`、`approval.*: manual_only` |
| 2-5 | 新增 `scripts/agent/build-search-review-input.mjs` → `.preview/search-review-input.json`；`promote.sh` 第 53 行 `NEVER_FILES` 追加 `search-review-input.json` | 該檔永不被 promote |
| 2-6 | 新增 `scripts/newshub_search_reviewer.py`：`import newshub_agents` 重用 `fail_open`、`_extract_json`、`_cli_error_detail`、`cap_text`；零工具 `claude -p`；輸出 `.preview/search-review.json`，proposals 一律 `pending_review` 且 `target_files` 只落在 allowlist（`scripts/prompts/[a-z]+.md`、`assets/js/config.js`、`scripts/tier-b-domains.json`）；旗標 `--selftest/--input/--out/--model/--timeout/--print-prompt` | `python3 scripts/newshub_search_reviewer.py --selftest` 通過；`node scripts/agent/check-agent-outputs.mjs --strict --self-test-boundary` 通過 |
| 2-7 | `run-agents.sh` 在 `08-precedents` 之後（不阻塞 observer 的區段）加 `run_model_step "08b-search-review" search-review.json python3 "$SCRIPTS_DIR/newshub_search_reviewer.py" --timeout "$(model_timeout)" ${MODEL_EXTRA[@]+"${MODEL_EXTRA[@]}"}`；S-8 期望字串改為 `"brief-latest.json roadmap.json search-review.json trend-assessment.json "`（排序後）；S-8b regex 改為 `newshub_(agents\|roadmap\|brief\|search_reviewer)\.py`；S-1 加兩個新檔；S-5 預算乘數由 ×5 改 ×6 或確認 2100 仍足 | self-test 全綠；`git diff --check` 乾淨 |
| 2-8 | commit「Phase 2」 | 訊息含 Co-Authored-By trailer |

## 2b. Phase 3 施工單（拆成 7 個 session，每個 session 只做一列、只讀一份 shape 檔）

Phase 3 是四個 Phase 裡最大的一個（一個 scaffold、一個模型 runner、三支 node 腳本、一支 shell、run-agents.sh 改四處、run-daily.sh 改一處），所以比照 Phase 2 拆成 7 個 session（S3-C2 是 S3-C 做完後發現的收尾補列，見 3-5b）。**每個 session 開頭的 prompt 固定寫：「先讀 HANDOFF.md §0–§2b，只做 S3-X，只讀它指定的那份 docs/shapes 檔，做完 commit 並 push。」** 做完一列就把「磁碟現況」欄改成「已 commit `<hash>`」，再開下一個 session。順序不能對調：S3-C 依賴 S3-B 的輸出檔，S3-D 依賴 S3-C 寫進 `proposals.json` 的 canary 欄位，S3-C2 依賴 S3-D 定下的 staged.txt 分工（00c 新建、08e append），S3-F 依賴 S3-E 送出的訊息 `ts`。

Phase 3 的資料流（一句話）：`08b-search-review` 的 `pending_review` 提案 → **閘 2** `change-evaluator`（模型，只裁定 accept／reject，不改檔）→ `apply-change.mjs`（確定性，只改 marker 區段，受 `canaries.json` 配額）→ 狀態 `canary` → `canary-check.mjs` 每晚比 `metrics-history.jsonl`，3 晚後決定 `auto_applied` 或 `reverted`。週報與 Slack 讀回是另一條線，只碰判例預覽，不碰 memory/**。

| Session | 對應項目 | 磁碟現況（2026-09-05） | 唯一要讀的 shape 檔 | 驗收（做完才 commit） |
|---|---|---|---|---|
| S3-A | 3-1 `agents/change-evaluator/` scaffold；3-2 `scripts/agent/build-change-eval-input.mjs` → `.preview/change-eval-input.json`；`promote.sh` NEVER_FILES 追加 `change-eval-input.json` | 已 commit `5e99f7c` | `docs/shapes/agents-scaffold.md`（改 promote.sh 時另補 `docs/shapes/agent-scripts.md` 的 G 段，≤ 20 行） | `hermes.project.yaml` 有 `risk_profile: high`、`learning.mode: shadow`、`approval.*: manual_only`、`direct_skill_patch: false`、`tool_scope_change: false`；`node scripts/agent/build-change-eval-input.mjs --self-test` 通過（含「輸入無標題／URL」與「search-review.json 缺席時輸出空 proposals 不 crash」兩案）；`bash scripts/agent/promote.sh --self-test` 通過且 NEVER_FILES 含 `change-eval-input.json`；commit「Phase 3-A」 |
| S3-B | 3-3 `scripts/newshub_change_evaluator.py`（閘 2 模型 runner）；3-4 `run-agents.sh` 加 `08c-change-eval-input`、`08d-change-eval`，S-1／S-5／S-6／S-8／S-8b 調整與預算決定 | 已 commit `663d16a`（Plan A：`AGENT_STEP_TIMEOUT_SEC` 420→350、S-5 ×6） | `docs/shapes/newshub_agents.md`（改 run-agents.sh 那半段再讀 `docs/shapes/run-agents.md`） | `python3 scripts/newshub_change_evaluator.py --selftest` 通過；`node scripts/agent/check-agent-outputs.mjs --strict --self-test-boundary` 通過；`bash scripts/run-agents.sh --self-test` 全綠（S-5 依 3-4 決定的乘數）；`bash scripts/run-agents.sh --dry-run` 不落地；commit「Phase 3-B」 |
| S3-C | 3-5 `scripts/agent/apply-change.mjs`（marker 區段消費者＋配額＋帳本）；3-6 `run-agents.sh` 加 `08e-apply-change`、`run-daily.sh` 的 `git add` 補上 apply-change 實際改過的檔 | 已 commit `ffe6a9e`（2026-09-05；自測 A-1..A-9 全綠、run-agents 自測 54 項 0 失敗、strict 通過、`git diff --check` 乾淨）。三件與規格的差異：①靜態 allowlist 檢查標籤用 **S-2c**（S-2b 已被 `--out-dir` 檢查占用），且只掃「// ── 自測」分隔線之前的正式碼（自測 fixture 寫 mkdtemp 假 root）；②search-reviewer 目前的提案沒有結構化 `patch` 欄位，accept 但無 patch／patch 內容已存在（noop）的提案停在 `evaluated` 不改檔、不進 canary、不占配額，但仍算 in-flight 7 天；③patch 契約寫在檔頭（add_*→`{add,list?}`、drop_*→`{remove,list?}`、rephrase_query→`{replace:{from,to}}`），search-reviewer prompt 尚未要求輸出此欄位，S3-D 之後要補 | `docs/shapes/latest-json-prompts.md`（帳本欄位只看 `docs/shapes/ledger.md` 前 20 行） | `node scripts/agent/apply-change.mjs --self-test` 通過（見 3-5 的 A-1..A-9）；`--dry-run` 不改任何檔、不寫帳本；`node scripts/agent/check-agent-outputs.mjs --strict` 通過；`bash scripts/run-agents.sh --self-test` 全綠（S-2 仍擋 `--promote`，新增 S-2b 擋 apply-change 寫到 allowlist 外）；`git diff --check` 乾淨；commit「Phase 3-C」 |
| S3-D | 3-7 `scripts/agent/canary-check.mjs`；3-8 `run-agents.sh` 加 `00c-canary-check`（在 `00b-category-metrics` 之後、任何模型步驟之前）；**S3-C 收尾帶進來的四件**：①回退寫檔一律 `import { assertWritable, splitRegion, splitPriorityKeywords } from "./apply-change.mjs"`，不複製白名單（紅線①只留一處）；②staged.txt 分工改為 00c 每晚**新建**（列出回退的檔，可為空）、08e 改 `appendFileSync`（apply-change.mjs 第 460 行附近一行改動；原因：08e 跑在 00c 之後，整檔覆寫會把回退的檔從 run-daily 的 `git add` 清單洗掉）；③S-2c 靜態檢查迴圈加入 canary-check.mjs，pattern 擴成 `writeFileSync|appendFileSync|renameSync|copyFileSync|unlinkSync|rmSync`，掃描範圍同樣止於「// ── 自測」分隔線；④開工先回填 `docs/shapes/data-agent-json.md` 第 14 行 `proposals.json` 的 canary 欄位（`canary_started`、`canary_started_at`、`baseline{verified_rate,priority_hit_rate,nights}`、`rollback{snapshot{file,region,before},note}`、`applied_by`、`diff_summary`、`evaluated_by`、`evaluated_at`、`reasons`，≤ 20 行） | 已 commit `f5a2396`（2026-09-05）。落地解讀：①00c 每晚**一定**重建 `.preview/apply-change-staged.txt`（無回退也寫空檔，08e 之後追加）；②`auto_opt.enabled=false`／canaries.json 缺 `canary_nights`／`revert_drop_pp` → 只印不改、exit 0；③夜數用 `date > canary_started`（嚴格大於，套用當天 00b 已跑過）；④判讀取兩指標中掉最多者，`drop_pp > revert_drop_pp` 才回滾（10.0 不回滾）；⑤另加 S-2d 靜態驗 canary-check 只 import 不重定義白名單；⑥回滾／確認同步改寫 `data/agent/proposals/<id>.json` 明細，不碰 learning-status | `docs/shapes/data-agent-json.md` | `node scripts/agent/canary-check.mjs --self-test` 通過（見 3-7 的 C-1..C-9；**C-x 的 canary fixture 不手寫，在暫存 root 直接 import apply-change.mjs 的 `run()` 產生**，避免兩支腳本各自想像欄位名）；只處理 `status === "canary" && production_applied === true`，`evaluated`（無 patch／noop）永遠不看、不解析 `reasons` 字串；`--dry-run` 只印判定不改檔；`grep -c "assertWritable\|splitRegion" scripts/agent/canary-check.mjs` 顯示為 import 而非重新定義；`bash scripts/run-agents.sh --self-test` 全綠（S-2c 涵蓋兩支檔）；`node scripts/agent/apply-change.mjs --self-test` 仍全綠（append 改動不破 A-x）；`git diff --check` 乾淨；commit「Phase 3-D」 |
| S3-C2 | 3-5b patch 欄位補齊：①`agents/search-reviewer/` 的 prompt／SKILL 要求每則提案依 apply-change.mjs 檔頭契約輸出結構化 `patch`（add_*→`{add,list?}`、drop_*→`{remove,list?}`、rephrase_query→`{replace:{from,to}}`）；②`build-change-eval-input.mjs` 的 `slimProposal` 保留 `patch`（閘 2 目前看不到實際 diff 就裁定 accept，這比配額問題嚴重；`validPayloadLine` 已擋 URL／超長）；③`apply-change.mjs` 的 `countInFlight` 配額計數只算 `production_applied === true`，`IN_FLIGHT_STATUSES` 的 7 天去重維持含 `evaluated`（無 patch 提案仍擋重複提案，但不再吃每週 3 個名額） | 已 commit `614c4f5`（2026-09-05；reviewer selftest 含 T-9 全綠、08c T-1..T-12、08e A-1..A-10、canary-check 全綠、change-eval selftest 全綠、run-agents 自測 58 項 0 失敗、strict 通過、`--dry-run` 08b→08e 全過、`git diff --check` 乾淨）。兩個落地解讀：(a) 閘1 對 `patch` 是**唯一不丟整筆**的欄位——不合法就 `patch:null`、提案保留、記 `gate1.patch_nulled[]`，由 08e 停在 `evaluated`；(b) 08c 的 `quota.in_flight/in_flight_by_category/remaining` 與 08e `countInFlight` 同尺、只算 `production_applied===true`，另加 `quota.dedupe_in_flight` 與 `canaries_in_flight[].production_applied`，`canaries_in_flight` 仍列全部 7 天內 evaluated/canary 供閘 2 reversibility-check 同類別去重（閘 2 prompt 未改：同類別 in-flight 仍「不過」，是保守方向）。驗收限制：`--dry-run` 下模型步驟只印 prompt、不寫 `search-review.json`，08c 實際輸出 `proposals:[]`；「verdict 帶 patch」改以 seeded 端到端驗證（`reconcile(_greedy_model_output)` → `build()` 於暫存 root，patch `{remove:"- papers low-yield query 2026"}` 貫通），首個真實 verdict 帶 patch 要等下一晚正式跑 08b→08e 才看得到 | `docs/shapes/agents-scaffold.md`（改 build-change-eval-input 那半段再看 `docs/shapes/agent-scripts.md`） | `node scripts/agent/build-change-eval-input.mjs --self-test` 通過且輸出含 `patch`；`node scripts/agent/apply-change.mjs --self-test` 通過並新增 A-10「3 件 evaluated 無 patch 不占配額，第 4 件有 patch 的 accept 仍可進 canary」；`python3 scripts/newshub_search_reviewer.py --selftest`（或既有對應自測）通過；`bash scripts/run-agents.sh --self-test` 全綠；用 `--dry-run` 跑一次 08b→08e 確認 verdict 帶 patch；commit「Phase 3-C2」 |
| S3-E | 3-9 `scripts/agent/build-weekly-report.mjs` → `.preview/weekly-report.json` + `.preview/weekly-report.md`；3-10 `scripts/agent/slack-notify.sh`（只用 curl，讀 `~/.config/ai-news-hub/slack.env`）；`run-agents.sh` 加 `08f-weekly-report`（DOW=7 才跑，非阻塞） | 已 commit `9c31aff`。落地解讀：① `git grep -n "xoxb\|hooks.slack.com"` 在 scripts/ 為 0 筆，唯一命中是本檔 §2c／§3 的規格文字（`xoxb-...` 範例）；② `run-agents.sh` 新增 `export AGENT_SCRIPTS`（原本未 export，08f 的 `bash -c` 子 shell 看不到）；③ dry-run 走環境變數 `SLACK_NOTIFY_DRY_RUN=1`（run-agents `--dry-run` 時 export），08f 步驟字串維持規格原文；④ 判例 `category` 檔內沒有就寫 `null`（現有 prec-*.json 只有 agent 名）；⑤ 08f 只在 `date +%u = 7` 跑，2026-09-05 為週六，實跑驗證用手動 `bash -c` 模擬條件為真：週報產出＋slack-notify 印「Slack 未設定，跳過」exit 0；⑥ `~/.config/ai-news-hub/slack.env` 仍未建立（§3），首次真發送前需人工填 | `docs/shapes/agent-scripts.md` | `node scripts/agent/build-weekly-report.mjs --self-test` 通過（週報不得含標題／URL／評分原始值，只有判例 id、情境摘要、分類、數量與 canary 狀態）；`bash scripts/agent/slack-notify.sh --self-test` 通過（缺 slack.env → exit 0 並 log「未設定，跳過」；token 不得出現在任何 log）；`git grep -n xoxb` 為空；commit「Phase 3-E」 |
| S3-F | 3-11 `scripts/agent/read-slack-picks.mjs`（讀回使用者在 Slack 對週報的 reaction／回覆）→ `~/.ai-news-hub/learning/precedent-picks.jsonl` + `.preview/precedent-picks.json`；`run-agents.sh` 加 `00d-slack-picks`（每晚、非阻塞、缺 slack.env 跳過） | 已 commit `ba9db05`。落地解讀：①自測不起本機 server，改成 `export run({env,log,fetch,dryRun})` 注入假 fetch（21 條）；②除 3-11 列的四欄外多帶 `schema/report_date/reply_count/reply_authors/note`，回覆原文與作者 id 刻意不落地；③✅ 認 `white_check_mark`／`heavy_check_mark`／`ballot_box_with_check`（含 skin-tone 變體），✅ 與 `[P-nnn]` 同時出現則兩者都保留；④API 丟錯或 `ok:false`（含 `missing_scope`）一律印一行 exit 0 不寫檔，非阻塞；⑤`.preview/precedent-picks.json` 每晚覆寫、jsonl 每晚追加一行（同一 `report_ts` 會重複出現，人工看 jsonl 取最後一筆即可）；⑥`git grep xoxb` 仍為 0（假 token 拆字串寫） | `docs/shapes/pull-feedback.md`（同樣是「外部回饋讀回 learning/」的型；帳本要不要記見 3-11） | `node scripts/agent/read-slack-picks.mjs --self-test` 通過；離線（無 token）跑不 crash、不寫檔；`memory/**` 零改動（`git status --porcelain agents/*/memory` 為空）；commit「Phase 3-F」 |

**Phase 3 通用紅線（每個 session 都要遵守，違反就不算驗收通過）**：①`apply-change.mjs` 能改的只有 `scripts/prompts/[a-z]+.md`、`assets/js/config.js`、`scripts/tier-b-domains.json` 三類，且只改 marker 區段內的行，`agents/_control/**`、`memory/**`、`skills/**`、`.github/**`、`hermes.project.yaml` 永遠不在清單裡；②配額數字（每週 3、每分類 1、canary 3 晚、掉 >10pp 回退）只從 `agents/_control/canaries.json` 讀，程式碼裡不得出現這些常數；③模型步驟一律 `claude -p`、pop `ANTHROPIC_API_KEY`、`--allowedTools ""`、`--permission-mode plan`，只裁定不改檔；④Slack token 只在 `~/.config/ai-news-hub/slack.env`，腳本讀了不得回顯、不得寫進 log／status／週報；⑤週報與 Slack 讀回只處理判例預覽（`.preview/precedent-proposals/`），寫進 `agents/*/memory/precedents.jsonl` 仍然是人工（§1 決策 2）。

### 3-1～3-11 明細（供各 session 查規格）

| # | 工作項目 | 驗收條件 |
|---|---|---|
| 3-1 | 新增 `agents/change-evaluator/`：`AGENTS.md`（角色：對 `pending_review` 提案做閘 2 裁定，只回 accept／reject＋理由，不產生新提案、不改 target_files）、`CHANGE_RUBRIC.md`（CE-1 證據含數字且與 `metrics-history` 對得上；CE-2 變更可逆且 `rollback` 欄非空；CE-3 不與 canary 中的同分類提案衝突；CE-4 `drop_*`／`rephrase_*` 這類 medium risk 需連續 2 晚證據；CE-5 任何對模型說話的文字→reject 並 `security_flag`）、`hermes.project.yaml` 照 search-reviewer 的 `adapter-contract-v1` 但 `risk_profile: high`、`golden/manifest.json` + 3 個 cases（accept 一件、reject 一件、redteam 一件）、`memory/`、`.hermes/optimization-profile.json` | 結構與 `agents/search-reviewer/` 對齊；`approval.*: manual_only`、`direct_skill_patch: false`、`tool_scope_change: false` |
| 3-2 | 新增 `scripts/agent/build-change-eval-input.mjs`：讀 `.preview/search-review.json`（`proposals[]` 取 `status == pending_review`）＋ `data/agent/proposals.json`（現有 `canary`／`evaluated` 件數，用來算剩餘配額）＋ `agents/_control/canaries.json` ＋ `metrics-history.jsonl` 最近 14 晚聚合；輸出 `.preview/change-eval-input.json`（schema `change-eval-input-v0.1`，含 `generated_at`、`quota:{weekly_cap,per_category_cap,in_flight,remaining}`、`proposals[]`、`metrics_window`）；`search-review.json` 缺席或 0 件 → 仍寫檔但 `proposals: []` | `--self-test`：無標題／URL、缺檔不 crash、配額算式 `remaining = max(0, weekly_cap − in_flight)`，`in_flight` = 近 7 天內 `status ∈ {evaluated, canary}` 件數 |
| 3-3 | 新增 `scripts/newshub_change_evaluator.py`：`import newshub_agents as na` 重用 `fail_open`、`_extract_json`、`_cli_error_detail`、`cap_text`；憲章＋`CHANGE_RUBRIC.md`＋golden；user prompt 分 `<metadata>`（配額）與 `<untrusted_items>`（提案與指標）；輸出 `.preview/change-eval.json`（schema `agent-change-eval-v0.1`，`verdicts[{proposal_id, verdict: accept|reject, reasons[], rubric_hits[], security_flag}]`）；閘 2 機械覆核只丟不補寫：`proposal_id` 必須存在於輸入、accept 件數 ≤ `quota.remaining`、每分類 ≤ `per_category_cap`、`security_flag` 者一律 reject、`rollback` 空者一律 reject；`--selftest/--input/--out/--model/--timeout/--print-prompt` 與 2-6 同 | `--selftest` 通過（含 golden 3 案與「模型 accept 超配額被砍到 remaining」一案）；輸出零標題／URL |
| 3-4 | `run-agents.sh`：在 `08b-search-review` 之後加 `run_step "08c-change-eval-input" node "$AGENT_SCRIPTS/build-change-eval-input.mjs"` 與 `run_model_step "08d-change-eval" change-eval.json python3 "$SCRIPTS_DIR/newshub_change_evaluator.py" --timeout "$(model_timeout)" ${MODEL_EXTRA[@]+"${MODEL_EXTRA[@]}"}`；S-1 加 3 個新檔；S-6 加 `--self-test`／`--selftest` 兩條；S-8 期望字串改為 `"brief-latest.json change-eval.json roadmap.json search-review.json trend-assessment.json "`；S-8b regex 加 `change_evaluator`。**預算決定（二選一，寫進 commit message）**：第 5 個模型步驟讓 5×420=2100 剛好頂到預算，S-5 若改 ×6 會超。優先方案 A：`MODEL_STEP_TIMEOUT` 預設 420→350（6×350=2100，S-5 改 ×6），前提是 `data/logs/` 近 7 晚沒有任何模型步驟超過 300s；否則方案 B：`08d` 只在 `change-eval-input.json` 的 `proposals` 非空時才跑（多數晚上為空），S-5 維持 ×5 並在註解寫明 08d 是條件步驟 | self-test 全綠；`--dry-run` 不落地；`git diff --check` 乾淨 |
| 3-5 | 新增 `scripts/agent/apply-change.mjs`：①讀 `.preview/change-eval.json` 的 accept 件，先把裁定合併進 `data/agent/proposals.json`（accept → `status: evaluated`，reject → `rejected`，附 `evaluated_at`、`reasons`），每件 `appendEvent({event_type:"proposal_evaluated", actor:"change-evaluator", subject_type:"proposal", subject_id, payload:{verdict, reasons}})`；②對 `evaluated` 件依 `change_type` 改檔：只在 `<!-- SEARCH_QUERIES:BEGIN/END -->`／`<!-- PRIORITY:BEGIN/END -->` 區段內增刪改行、`PRIORITY_KEYWORDS` 只改 `config.js` 該常數的陣列元素、`add_domain` 只 append 到 `scripts/tier-b-domains.json`（檔不存在則以 `{"schema":"tier-b-domains-v0.1","domains":[]}` 建立，Phase 4 才接 validate.py）；改前把區段原文存進該提案的 `rollback.snapshot`；③改完 `status: canary`、`canary_started: <今日>`、`baseline: {verified_rate, priority_hit_rate}`（該分類 `metrics-history` 近 7 晚中位數）；`appendEvent({event_type:"proposal_auto_applied", payload:{target_files, diff_summary, canary_started}})`；④把實際改過的檔案路徑寫到 `.preview/apply-change-staged.txt`（一行一檔）；⑤配額再核一次（每週 3、每分類 1、`auto_opt.enabled` 為 false 時整支只印不改）；`--dry-run`、`--self-test`。self-test A-1 區段外的行 byte 級不變；A-2 非 allowlist 路徑拒改；A-3 `agents/_control/**` 拒改；A-4 配額超出時多的件維持 `evaluated` 不改檔；A-5 `auto_opt.enabled:false` 零寫入；A-6 snapshot 可還原到 byte 級相同；A-7 帳本事件欄位齊全且無標題／URL；A-8 冪等（同一件跑兩次不重複改）；A-9 `models.md` PRIORITY 在前的順序不受影響 | 全部 A-x 通過；`check-agent-outputs.mjs --strict` 仍通過（`canary`／`evaluated` 是既有 ALLOWED_STATUSES） |
| 3-6 | `run-agents.sh` 在 `08d-change-eval` 之後加 `run_step "08e-apply-change" node "$AGENT_SCRIPTS/apply-change.mjs"`（dry-run 時帶 `--dry-run`，比照 00b 的 `METRICS_EXTRA` 做法）；新增 self-test S-2b：`grep -n "writeFileSync\|renameSync" apply-change.mjs` 找到的目標都經過 allowlist 函式（用靜態字串檢查，不執行）；`run-daily.sh` 第 736 與 767 行 `git add data/` 之後各加一行：`[[ -s data/agent/.preview/apply-change-staged.txt ]] && xargs -I{} git add -- {} < data/agent/.preview/apply-change-staged.txt`（只加 apply-change 改過的檔，不把使用者手改的 prompt 一起折進去）；`docs/specs/run-daily.md` 補 3 行說明 | self-test 全綠；`bash -n scripts/run-daily.sh` 通過；staged.txt 不存在或為空時 run-daily 行為與現在完全相同 |
| 3-5b | （S3-C2）①search-reviewer prompt／SKILL 要求 `patch` 欄位，契約同 apply-change.mjs 檔頭；②`build-change-eval-input.mjs` `slimProposal` 保留 `patch`；③`apply-change.mjs` `countInFlight` 只算 `production_applied === true`，去重集合不變 | 見 §2b S3-C2 列 |
| 3-7 | 新增 `scripts/agent/canary-check.mjs`：對 `proposals.json` 每件 `status: canary`，取 `canary_started` 之後該分類在 `metrics-history.jsonl` 的夜數 n；n < `canary_nights` → 只印「觀察中 n/3」；n ≥ `canary_nights` → 算 canary 期 `verified_rate`／`priority_hit_rate` 平均與 `baseline` 的差，任一指標掉超過 `revert_drop_pp` 百分點 → 用 `rollback.snapshot` 還原區段、`status: reverted`、`reverted_at`、`appendEvent({event_type:"canary_reverted", payload:{metric, baseline, observed, drop_pp}})`、還原的檔案路徑寫進 `apply-change-staged.txt`（**00c 每晚新建此檔**、可為空；同一 session 把 08e 的 apply-change.mjs 改成 `appendFileSync`，否則 08e 整檔覆寫會洗掉回退的檔）；否則 `status: auto_applied`、`confirmed_at`，帳本再記一筆 `proposal_auto_applied` 且 `payload.stage: "confirmed"`（不新增 EVENT_TYPE，`ledger.mjs` 不動）；該分類某晚沒跑（無該日該分類列）不算夜數；`--dry-run`、`--self-test`。self-test C-1 n 不足不動；C-2 掉 10.1pp 回退、掉 9.9pp 不回退（邊界從 canaries.json 讀）；C-3 回退後區段 byte 級等於 snapshot；C-4 缺席夜不計；C-5 同一件不重複判定；C-6 帳本無標題／URL；C-7 `revert_drop_pp` 改成 5 後 C-2 邊界跟著變（證明沒寫死）；C-8 零 canary 提案 → exit 0、零寫入；C-9 `evaluated` 且 `production_applied:false` 的件不回退、不記帳 | 全部 C-x 通過；`--dry-run` 只印 |
| 3-8 | `run-agents.sh` 在 `00b-category-metrics` 之後加 `run_step "00c-canary-check" node "$AGENT_SCRIPTS/canary-check.mjs"`（dry-run 帶 `--dry-run`；必須排在任何模型步驟前，回退釋放的配額當晚就能被 08d 用到）；S-1 加檔；S-6 加自測 | self-test 全綠 |
| 3-9 | 新增 `scripts/agent/build-weekly-report.mjs`：彙整近 7 天 `.preview/precedent-proposals/` 的判例候選（每則只留 `id`、agent、分類、`situation` 前 120 字、`discriminator`；不留來源標題／URL）、`proposals.json` 近 7 天狀態變化（evaluated／canary／auto_applied／reverted 件數與 diff_summary）、`metrics-history` 近 7 天每分類 verified_rate 均值；輸出 `.preview/weekly-report.json` 與 `.preview/weekly-report.md`（Slack 可直接貼的 mrkdwn，每則判例一行，行首固定 `[P-nnn]` 讓 3-11 能對回）；`--self-test`；`promote.sh` NEVER_FILES 追加 `weekly-report.json weekly-report.md` | 週報零標題／URL／評分原始值；`--self-test` 通過 |
| 3-10 | 新增 `scripts/agent/slack-notify.sh`：`set -euo pipefail`；讀 `~/.config/ai-news-hub/slack.env`（需 `SLACK_BOT_TOKEN`、`SLACK_CHANNEL_ID`；缺檔或缺變數 → log「Slack 未設定，跳過」exit 0）；用 `curl -sS -X POST https://slack.com/api/chat.postMessage`（bot token 而非 webhook，因為 3-11 讀回需要同一支 app）送 `weekly-report.md`；回傳的 `ts` 寫到 `~/.ai-news-hub/learning/weekly-report-sent.jsonl`（`{ts, channel, sent_at, report_date}`）；token 只經 `-H "Authorization: Bearer $SLACK_BOT_TOKEN"` 傳入，`set -x` 不得開；`--self-test`（用假 env 檔＋`SLACK_API_BASE` 指向本機假 server 或 `--dry-run` 只印 payload）。`run-agents.sh` 加 `run_step "08f-weekly-report" bash -c '[[ $(date +%u) -eq 7 ]] && node "$AGENT_SCRIPTS/build-weekly-report.mjs" && bash "$AGENT_SCRIPTS/slack-notify.sh" || true'`（週日跑；放在 `08e` 之後、observer 之前；非阻塞） | `git grep -n "xoxb\|hooks.slack.com"` 為空；缺 slack.env 時 run-agents 全程正常；`bash scripts/agent/slack-notify.sh --self-test` 通過 |
| 3-11 | 新增 `scripts/agent/read-slack-picks.mjs`：讀 `weekly-report-sent.jsonl` 最近一筆 `ts`，用 `reactions.get` 與 `conversations.replies` 取該訊息的 reaction 與回覆；規則：對訊息本體按 ✅ 視為「全收」，回覆內含 `[P-nnn]` 或 `P-nnn` 視為只收該幾則；產出 `.preview/precedent-picks.json`（`{report_ts, picked:[P-nnn...], picked_all:bool, fetched_at}`）與 append `~/.ai-news-hub/learning/precedent-picks.jsonl`；**不寫 memory/**、不改 precedents.jsonl**，人工把 picks 併入判例時走原本的人審路徑；帳本：`EVENT_TYPES` 沒有對應事件，本 session 不記帳本、不改 `ledger.mjs`（若之後要記，另開施工單加 `precedent_picked`）；缺 slack.env → exit 0 跳過；`--self-test`（假 API 回應）。`run-agents.sh` 加 `run_step "00d-slack-picks" node "$AGENT_SCRIPTS/read-slack-picks.mjs"`（每晚、非阻塞） | `git status --porcelain agents/*/memory` 為空；`--self-test` 通過；離線不 crash |

Phase 4 的細節見 §0（紀律見 CLAUDE.md「auto-opt 路線圖與工作紀律」）；帳本 `EVENT_TYPES` 已預留 `proposal_evaluated`、`proposal_auto_applied`、`canary_reverted`，Phase 3 不需改 `ledger.mjs`（3-7 的「canary 通過」用 `proposal_auto_applied` 加 `payload.stage`，3-11 不記帳本）。

## 3. 需要「人」做的事（agent 無法代）

| 項目 | 指令／位置 | 未做的後果 |
|---|---|---|
| ~~部署 Firestore rules（Phase 1）~~ **✅ 2026-09-05 已部署**（`firebase login` 後 `deploy --only firestore:rules` 成功；`pull-feedback.mjs --dry-run` 回 `scanned=0` exit 0，403 消失；之後改 rules 只需重跑 deploy，登入 token 在 `~/.config/configstore/firebase-tools.json`） | `npx -y firebase-tools deploy --only firestore:rules`（首次會開瀏覽器要 `firebase login`；本機未裝 firebase CLI，須在 `~/ai-news-hub` 執行）| 未部署時 `pull-feedback.mjs` 回 403，帳本收不到 `human_rating`；前端評分也寫不進 Firestore。**2026-09-05 已查證根因就是這條、與 S3-B 無關**：writer 帳號 signIn 200、uid 與 `firestore.rules` 內常數一致，`runQuery feedback` 回 `PERMISSION_DENIED`（不帶 where 也一樣）→ 線上仍是 `c2695db` 的舊 rules（無 `feedback` match）。未部署前每晚 `00-pull-feedback` 都會 exit 2、overall 恆為 degraded；不要改程式把 403 吞成 skipped，那會遮掉真的設定錯誤 |
| 網站登入 | 站上以 writer 帳號登入 | 按鈕只寫 localStorage，不會同步到 Firestore |
| S-PWR 驗收（電池模式整跑） | 拔電源 kickstart 通知已於 2026-09-05 由使用者驗過（有跳「18:00 擷取即將開始，請接電源」）。剩下：任一晚電池模式跑完，`python3 -c "import json;h=json.load(open('data/health.json'));print(h['power_source'],h['errors'])"` 應印 `battery` 與回退備註 | 只是驗收，功能已裝好；不影響 AC 正常執行 |
| Phase 3 前填 Slack 設定（S3-E 動工前） | 建一個 Slack app（bot token scopes：`chat:write`、`reactions:read`、`channels:history`；私頻道則 `groups:history`），把 bot 加進目標頻道，寫 `~/.config/ai-news-hub/slack.env`：`SLACK_BOT_TOKEN=xoxb-...`、`SLACK_CHANNEL_ID=C...`（`chmod 600`）。**要用 bot token 不用 incoming webhook**：webhook 只能送不能讀，S3-F 的讀回需要同一支 app | S3-E／S3-F 只會 log「Slack 未設定，跳過」，不會 crash；此檔永不入版控 |
| **每天 18:00 前接電源**（合蓋與否皆可；2026-09-05 拍板，方案 1） | MacBook 接 AC | 電池＋合蓋時 macOS 每 17–36 分鐘只暗醒幾秒，`caffeinate` 擋不住；實測 08-30、09-04 兩次電池執行都跑 4–6 小時、7 類別只成功 2 個（AC 執行 25–28 分鐘、7/7 成功） |

## 4. 勿動 / 勿誤判

- **repo 是公開的。** `OPS-RUNBOOK.md`、`archiver.env`、`*.env`、`data/agent/.preview/` 都在 `.gitignore`，永不移除；`.preview/` 那條是因為 `run-daily.sh` 每天 `git add data/`。
- `~/.config/hermes/*.env`、`iris-deployment.key`、`.iris-deployment-authorization-claims/` 是機密，連變數名都不要讀（classifier 會拒絕，不要重試）。
- `promote.sh` 的 `NEVER_FILES` 與「刻意不提供 `--promote`」都不能改；S-2 會擋任何步驟出現 `--promote`／`--out-dir`。
- `raw_feedback_off_repo`：原始評分、標題、URL、人工評語只留 `~/.ai-news-hub/learning/`；repo 只放聚合數字與 id。
- `memory/**`、`skills/**` 人工審核專屬；`agents/_control/**` 不進 auto-apply allowlist。
- `hermes.project.yaml` 內 `deny_read_write_paths`、`approval.*: manual_only`、`direct_skill_patch:false`、`tool_scope_change:false` 是契約，不放寬。
- 已取消的評分不會傳到帳本（Phase 1 已知限制，非 bug）。
- `Hermes-Agent/Hermes-auto-optimization-manual.spec.json` 標記 confidential，不得引用到公開產物。
- **「commit 不 push」在本 repo 只能撐到當晚 18:00，因此 2026-09-05 起改為 commit 完立刻 push（決策 7）。** `run-daily.sh` 第 701–728 行每晚 `git fetch` → `git reset --soft origin/main` → `git add data/` → commit → `git push origin main`：所有未 push 的本機 commit 會被折進當晚的「📰 AI News」commit 一起推上公開 repo（2026-09-04 已實際發生：`8e75a91`、`8a2d97a`、`fb16719` 三個 commit 折進 `e0f71a4`）。舊決策「push 只在使用者明講時」只對「當天 18:00 之前」成立，已作廢；HANDOFF 記的 hash 隔天可能已作廢，要用 `git diff <hash> HEAD -- <檔案>` 核對內容而不是找 hash。是否改 `run-daily.sh`（例如只 push data/ 的 commit、或改成先 `git rebase` 再 commit）由使用者拍板，不屬任何 Phase。
- **GitHub「🔴 Health check: missed」commit 多數是誤判，不代表本機沒跑。** 2026-09-05 前 `health-check.yml` 用「latest.date == 台灣今天」判斷，但 GitHub cron 實測延遲 3–9 小時，跨台灣午夜後「今天」變隔天就誤判（08-28／08-29／09-01／09-05 四次皆誤判）。已改為以 SLOT_DATE（台灣時間 < 20:00 視為前一天的 slot）比較 `latest.date >= SLOT_DATE`，並加 `workflow_dispatch`。看到 missed 先對 `data/logs/<日期>.log` 的「推送成功」時間，再決定要不要補跑。同一次修正也把 `run-daily.sh` 的 `git pull --rebase … 2>/dev/null` 改成會清 `.git/rebase-merge` 殘留、失敗即 abort、錯誤進 log（2026-08-22 起殘留兩週沒人發現）。

## 5. 低 context 工作法（在本專案強制）

1. 不整檔讀取：`grep -n` 找行號，`sed -n START,END` 只看要改的段落；資料檔用 `head -c`、`jq keys`、`wc -l`。
2. 廣泛調查交給 Explore subagent，主 context 只收結論。
3. 新檔用 heredoc 寫入，不回顯；同一檔的多處修改集中在一次 python heredoc。
4. 一個 session 只做一個 Phase；做完 commit，然後開新 session，不 `/compact`。
5. shape 一律先查 `docs/shapes/README.md` 對應的那一份檔，查不到再開檔並回填該檔。規範（run-daily、validate、分類、前端 UX）在 `docs/specs/`，同樣只讀對應那份。
6. `data/*.json` 只用 `python3 -c` 印 keys／len／前 3 筆；`json.tool` 與 `cat data/*.json` 已在 `.claude/settings.json` deny。
7. context 快滿：先把本檔 §0 與 §2「磁碟現況」欄更新，然後 `/clear` 開新 session，不 `/compact`。

## 6. 跨專案調度施工單（2026-09-05 規劃；Hermes 管制塔／launchd 引擎／Iris 櫃台）

> 本節是**跨專案**施工單，施工地點主要在 `~/Hermes-Agent`、`~/.hermes`、`~/Library/LaunchAgents`，不是 ai-news-hub 的 Phase。放在本檔是因為本 repo 是唯一有 HANDOFF 紀律的地方；各 session 開工先讀本節，再只開該 session 列出的檔案。§4 紅線全部適用（Hermes 真本契約不動、`~/.config/hermes/*.env` 連變數名都不讀、confidential spec 不引用）。
> 盤點日期 2026-09-05，來源為 `~/Library/LaunchAgents/*.plist` 全部解析、`launchctl list`、`pmset -g sched`、`du`、各 repo `git status`；標 ［未能驗證］ 者無實測數據。

### 6.0 白話結論

一台 16GB 的機器上有兩套排程器互不知情：launchd 掛 19 個工作（12 個 Hermes、7 個其他專案），Hermes v0.20.0 內建 cron 只跑 1 個工作；沒有共用的鎖、log、執行帳本，pmset 只有一個喚醒點（17:55），所以凌晨四個工作全是假排程，都擠到早上開機時一起跑。目標架構：**Hermes 當管制塔（只讀執行帳本、經 Iris 每天 DM 一份艦隊摘要），launchd 當引擎（保留行程隔離，套一支共用 runner），Iris 當櫃台（DM 摘要、告警、核准中繼；不做 ai-news-hub 週報 ✅ 讀回）**。金融類比：launchd 是清算系統真的執行，Hermes 是風控監控台只看帳，Iris 是客服櫃台只對使用者說話。

**不把重型工作搬進 Hermes cron** 的三個實測理由：gateway `KeepAlive` 重啟會漏 Docker 容器（已需 03:30 reaper 收拾）；ai-news-hub 一晚 7–10 支平行 `claude -p`（各 1200s）不適合塞進單一 Python 常駐行程；launchd 的獨立行程／鎖／PATH 是目前唯一的隔離手段。

### 6.1 現況診斷（量化）

**排程時窗（台北時間）**

| 時窗 | 工作 | 模型呼叫 | 問題 |
|---|---|---|---|
| 00:00 | hermes learner（`run_learner_daily.sh`） | Opus 2＋N（N＝候選數÷batch，`daily_learner.py:772` 無上限） | 機器通常在睡；延到下次喚醒才爆發 |
| 03:30／04:30／D1 04:45 | container-reaper、agent-memory daily、monthly | 0 | 同上；monthly 與 daily 相隔 15 分鐘搶 `AgentMemoryFabric/Backups` |
| 09:00／09:20 | skillwatch（`~/skill-vault/scripts/run_all.sh`）、eaga optimizer | 0–1 | 與被延後的凌晨工作在開機時擠在一起 |
| 17:55 喚醒→18:00 | ai-news-hub `run-daily.sh` | 12–15 | AC 25–28 分；電池 4–6 小時，撞到凌晨窗 |
| 19:30 | hermes curator | Opus 1 | 與 ai-news-hub 電池模式重疊 |
| 日 20:00／一 08:30 | auditor、weekly-digest | Opus ≥2／1–2 | auditor 與 ai-news-hub 08f 週日同晚 |
| 六 21:00 | gdrive-sync（rclone） | 0 | 08-08 跑 11.5 小時，留 44 GB 歸檔 |
| 每 300s | dashboard-push → Firestore | 0 | 288 次／日，餵的本機 dashboard（:9119）已停用 |

**其他事實**

| 項目 | 數字 | 備註 |
|---|---|---|
| pmset 喚醒點 | 1（17:55） | `pmset repeat` 只允許一組 |
| 互不知情的 Claude CLI 路徑 | 3 | `run-daily.sh` 直呼、Hermes claude-cli-proxy（127.0.0.1:18796）、NeuroLearn `claude_proxy.py`（127.0.0.1:7734，socket-activated） |
| 每日模型呼叫 | 約 16–20＋N | Hermes 各腳本 `MODEL="claude-opus-5"` 寫死；N 是唯一無上限變數 |
| Hermes 常駐行程 RSS | 約 125 MB（4 個） | 不是瓶頸 |
| 孤兒 MCP stdio server | 20 個，約 555 MB | mcp-pdf ×6、playwright ×7、agent-memory ×7，來自已結束的 Claude Code session |
| memory_pressure | 38% free | 18:00 那批是 CPU／網路瓶頸，非記憶體 |

**技術債與無效益檔案**（可回收約 3 GB＋44 GB 週期性）

| 項目 | 大小 | 處置 |
|---|---|---|
| `~/.hermes/hermes-agent-rollback-20260809T022830-747312000` | 1.4 GB | 08-09 升版殘留，無 plist 引用 → 刪 |
| `~/.hermes/v020-stage-home`、`backups`、`state-snapshots` | 664＋591＋87 MB | 同次升版殘留 → 刪或壓成一份 |
| `~/.hermes/iris-runtime/releases/`（55 版 1.2.4→2.1.41-rc.30）、`backups/` | 90＋44 MB | 只留 `current` 與前一版 |
| `iris-runtime/` 24 個 `failed-uat-*.json`、4 個 `failed-install-*.json`、11 個 `*.rolled-back.json` | 小 | 清，但先過 6.4 決策 B |
| `~/.hermes/logs/`（`claude_cli_proxy.launchd.log` 25 MB、`gateway-manual.log` 12 MB、`agent.log`×4 20 MB、`slack_bridge.log.*` 10 MB） | 77 MB | 無輪替 → runner 內建 14 天輪替 |
| `~/.hermes/*.jsonl`（`iris-runtime-telemetry` 2.1 MB、`iris-learning-retrieval` 1.3 MB） | 3.4 MB | 無 retention → 加上限 |
| `~/.hermes/config.yaml.bak-*`、`.corrupt.*.bak` | 8 個 | 刪（`~/.hermes` 本身是 git，最後 commit `32dd5a0` 07-11） |
| `~/Hermes-Agent/hermes-iris-runtime-v2.1.41-rc.15…rc.21`（7 棵 untracked） | 19 MB | 刪 |
| `~/Hermes-Agent/loop-engineering`（07-09 起未動）、根目錄 4 張 PNG | 100 MB、3.7 MB | 6.4 決策 D；PNG 移出 git |
| `~/Hermes-Agent/dist` | 16 MB | 依 `docs/dist-retention-policy-2026-08-25.md` 執行 |
| launchd 真相三份副本（installed、`scripts/launchd/`、`hermes-console/deploy/`） | — | 由 6.2 的 `fleet.yaml` 取代 |
| `~/Library/LaunchAgents/disabled/` 5 個 plist（`linkedin-weekly` 為壞 XML）、`disabled-2026-07-25/`、`~/.hermes/com.zyc.hermes-console.plist` | 小 | 刪 |
| `~/gdrive-sync/_archive/2026-08-08_210001` | 44 GB | `_cleanup.sh` 保留 30 天，約 09-12 自動到期；保留期改 14 天 |
| `~/gdrive-sync/_sync_logs/launchd.out.log`、`_sync_manifest.csv`、`summary_2026-08-08.md`、3 個 `.bak` | 55＋58＋46 MB＋小 | log 被 `_cleanup.sh:53,64` 明確排除、無上限 → 納入輪替；`.bak` 刪、腳本改 git 管理 |
| `~/NeuroLearn/claude_proxy.py`（根目錄 untracked，與 `scripts/claude_proxy.py` 完全相同；plist 指向 untracked 那份） | 小 | plist 改指 `scripts/`，刪根目錄複本 |
| GOVNHUB-WebTest-Agent（plist 硬編另一台機器路徑、07-08 起無 commit；GitHub Action 仍每天 22:00 UTC 跑） | 0 | 6.4 決策 D |
| `~/Obsidian-KM/_scripts/daily-maintenance.log` | 3.1 MB | 納入輪替 |
| `~/ai-news-hub/ai-news-hub.bundle`（04-07）、`scripts/__pycache__` | 91 KB | 刪、`__pycache__` 加 gitignore |

**Hermes-Agent repo 半套用狀態（先於一切）**：branch `minimal-governance` 有 20 個 modified、10 個 untracked、**46 個 staged 未 commit 的刪除**（整套 Iris UAT harness：`scripts/iris_*uat*`、`tests/test_iris_*uat*`、`hermes-console/iris_uat_*.js`、`schemas/iris-*uat*-v1.json`、`deploy/iris-runtime/cutover.py`、`release_partition_validator.py`、舊 `hermes-console/*.plist`＋wrapper），自 09-03 停在這狀態；同時 `~/.hermes/iris-runtime/current` → rc.26，但 rc.29／rc.30 已建、最後 commit `ccc68c6` 記載 rc.31，線上 Iris 落後 4–5 個候選版。

### 6.2 目標架構

| 元件 | 落點 | 內容 | 不做什麼 |
|---|---|---|---|
| 單一真相 `fleet.yaml` | `~/Hermes-Agent/fleet/fleet.yaml`（退路：`~/.hermes/fleet/`，代價是與治理 repo 分家） | 每工作一列：`id, project, entry, window, timeout, needs_model, needs_ac, needs_docker, notify_on_fail` | 不含任何機密、不引用 `.env` |
| 產生器 `gen-plists.sh` | 同目錄 | 由 `fleet.yaml` 產 plist 到 `~/Library/LaunchAgents/`，`plutil -lint` 全過 | 不改各專案 entry script |
| 共用 runner `run.sh <job-id>` | 同目錄 | `export PATH=/opt/homebrew/bin:…`、`flock` 單例鎖、`timeout`、log → `~/.local/state/fleet/logs/<job>/`（14 天輪替）、結束 append `~/.local/state/fleet/runs.jsonl`（job、start、end、exit、duration、host_on_ac） | 不讀 `.env`、不回顯任何輸出到 Slack |
| Hermes cron（唯一一個工作） | `hermes cron create` 08:00 | 讀 `runs.jsonl`，經 Iris DM 昨晚摘要與失敗清單 | 不跑任何重型工作 |
| Iris | 現狀（DM-only、單一使用者、片語核准） | 摘要、告警、optimization proposal 核准中繼 | 不做 ai-news-hub 週報 ✅ 讀回（無 `reactions:read`／頻道 history；加上去要改 Hermes 真本）→ ai-news-hub 維持專用 Slack app（§3） |

ai-news-hub 端改動＝plist 的 `ProgramArguments` 換成 `run.sh ai-news-hub-daily`；`run-daily.sh` 零改動。

**時窗重排（一個喚醒點就夠）**

| 窗 | 內容 | 說明 |
|---|---|---|
| 17:55 喚醒／18:00 晚間鏈 | 序列：ai-news-hub → curator → learner（`DEEP_BATCH` 上限＋timeout 90 分）→ 週日 auditor → agent-memory daily → container-reaper | 同一時間只有一條 Claude 路徑；ai-news-hub 內部 7–10 平行不變 |
| 09:00 早間輕窗 | skillwatch → eaga optimizer → D1 agent-memory monthly | 機器已開、0–1 次模型；monthly 移早上就不再與 daily 搶目錄 |
| 一 08:30 | weekly-digest | 維持 |
| 六 22:00 | gdrive-sync | 歸檔保留 14 天、`launchd.out.log` 納入輪替、`timeout 6h` |
| 事件驅動 | dashboard-push 改為 runner 結束時觸發＋每小時 1 次心跳 | 288 次／日 → 約 30 次／日 |
| 08:00 | Hermes cron → Iris DM 艦隊摘要 | Hermes 現成 cron→Slack 遞送，零 Hermes 程式改動［未能驗證：v0.20.0 cron job 能否直接讀本機檔案，只從 `cron/scheduler.py` toolset 機制推斷；失敗退回 runner 結尾直接 `chat.postMessage`］ |

**方案優先順序**

| 方案 | 成本 | 效益 | 判定 |
|---|---|---|---|
| A 管制塔架構（本節） | 約 5 個 session（F-0～F-4）；Hermes 程式只改 learner 一個常數 | 排程單一真相、零重疊、模型路徑序列化、每日可觀測、回收約 3 GB | **優先** |
| B 全搬進 Hermes cron | 改寫 12 個 wrapper、失去行程隔離 | 少一套排程器 | 否決：gateway 重啟漏容器、平行 `claude -p` 不宜行程內 |
| C 只清債不重排 | 1 個 session | 回收空間 | 治標；凌晨工作仍假排程、配額仍三頭馬車 |

### 6.3 施工單（每 session 一列；做完 commit 立刻 push；F-0 未完成前 F-1 不開工）

| Session | 工作項目 | 只開這些檔 | 驗收條件 | 需使用者拍板 |
|---|---|---|---|---|
| **F-0 Hermes-Agent 收斂**（修訂版，見下表 6.3a） | 決策 A 已拍板 commit：備份分支＋stash 物件 → 拆兩個 commit → 補 `docs/HANDOFF.md` 決策紀錄 → 清 7 棵 rc 暫存樹與 PNG → 建 2.2.0 跑 canary → 通過才 promote／合 main／清 `releases/` | `~/Hermes-Agent`：`git status`、`docs/HANDOFF.md`（新）、`deploy/iris-runtime/release_spec.json`、`deploy/iris-runtime/README.md`、`docs/dist-retention-policy-2026-08-25.md` | 見 6.3a 各步驟驗收；步驟 5 canary 失敗即停在步驟 4，不合 main | 決策 B（F-0 步驟 5–6 預設走 B1） |
| **F-1 fleet 單一真相** | 寫 `fleet/fleet.yaml`（19 個工作逐一登錄）、`fleet/gen-plists.sh`、`fleet/run.sh`；刪 `scripts/launchd/`、`hermes-console/deploy/*.plist`、`~/Library/LaunchAgents/disabled*/`、`~/.hermes/com.zyc.hermes-console.plist` | `~/Library/LaunchAgents/*.plist`（python plistlib 解析，不 cat）、上述三檔 | 產生的 plist 與 `launchctl list` 逐一對得上；`plutil -lint` 全過；`run.sh --self-test` 通過；每個工作在 `runs.jsonl` 至少一筆 | 決策 C（落點） |
| **F-2 時窗重排** | 依 6.2 表改 `fleet.yaml`，`launchctl bootout`／`bootstrap` 重掛；learner 加 batch 上限與 timeout（Hermes 腳本改一個常數）；NeuroLearn plist 改指 `scripts/claude_proxy.py` | `fleet.yaml`、`run_learner_daily.sh`（grep 常數行）、`com.neurolearn.proxy.plist` | 連續 7 晚 `runs.jsonl` 無重疊（end_i ≤ start_{i+1}）；晚間鏈 AC 下總時長 ≤ 90 分；`data/health.json` 的 `QUOTA_NOTE` 7 晚為空 | learner 上限數字 |
| **F-3 Iris 摘要** | `hermes cron create` 08:00 工作，prompt 只讀 `~/.local/state/fleet/runs.jsonl`；失敗退回 runner 結尾 `chat.postMessage` | `~/.hermes/cron/jobs.json`（只印 keys） | 連續 3 天 08:00 收到 DM；失敗工作有標示 | 無 |
| **F-4 清債** | 依 6.1 表逐項刪除（刪前列清單給使用者確認）；gdrive `_cleanup.sh` 保留期 14 天＋log 納入；`~/.hermes` JSONL 加上限；GOVNHUB workflow 停用；孤兒 MCP 清理並找出來源 | 6.1 表所列路徑；`~/gdrive-sync/_cleanup.sh` | `du -sh ~/.hermes` ≤ 1.8 GB；`~/gdrive-sync` 穩態 ≤ 5 GB；`ps` 無 etime > 30 分的 mcp stdio 行程；`git status` 各 repo 乾淨 | 決策 D |

#### 6.3a F-0 修訂版（2026-09-05 依 §6.4 A 拍板；一步一驗收，步驟 5 是關鍵閘）

| 步驟 | 工作 | 驗收 |
|---|---|---|
| 1 | `~/Hermes-Agent` 先 `git branch backup/pre-minimal-governance-20260905 ccc68c6`；工作樹用 `git stash create` 存一個 stash 物件當保險，不套用、不 drop | `git branch -a` 看到備份分支；stash 物件 hash 記回本檔 §6.6 |
| 2 | commit 1：46 個 staged 刪除＋20 個修改中對應的設定檔（`iris_local_full_gate.py`、`verify_python_test_matrix.py`、`release_spec.json`、`install.py`、`test_iris_runtime_release.py`、`test_weekly_production_preflight.py` 等）；commit 2：`hermes-console/iris_intent_classifier.js`、`tests/test_iris_intent_classification.mjs`＋`slack_bridge.mjs` 接線 | `git status` 只剩 7 棵 `hermes-iris-runtime-v2.1.41-rc.*` 暫存樹與 `CLAUDE.md`；`node --check` 與 `python3 scripts/iris_local_full_gate.py` 通過 |
| 3 | 寫 `docs/HANDOFF.md`（AGENTS.md 已要求此檔）：拆閘門理由（08-14～09-03 共 24 次 UAT 全失敗、6 個候選版 0 推廣）、新閘門定義（sonnet 單車道分流＋intent classifier）、rc.27 機密 printenv 封鎖與 rc.28 worker 遞迴委派關閉兩項修正在 2.2.0 的落點；commit 3 | 檔案存在且入版控；`grep -n 'minimal-governance' docs/HANDOFF.md` 至少 1 筆 |
| 4 | 刪 7 棵 rc 暫存樹（2.7–2.9 MB 各）、4 張 PNG 移出 git、`CLAUDE.md`（`@AGENTS.md`）收入；`dist` 依 retention policy | `git status` 乾淨；push `minimal-governance` 到 origin |
| 5 | `scripts/build_iris_runtime_release.py` 建 2.2.0 → `python3 install.py plan` → `canary`；`launchctl list` 四個 hermes 服務 exit 0；Iris DM 一句測試訊息有回 | 通過：`readlink ~/.hermes/iris-runtime/current` = `releases/2.2.0`。失敗：`install.py rollback` 後 `current` 回到 `releases/2.1.41-rc.26`，停在步驟 4，把 12 項阻斷檢查最小子集拉回來再談合 main |
| 6 | `promote`；`minimal-governance` 合 main、push；`releases/` 只留 2.2.0 與 rc.26（回滾基準），刪 rc.13–25、rc.27–30（約 80 MB）；24 個 `failed-uat-*.json` 打成一個 tar 歸檔後刪 | `readlink current` = 2.2.0；`ls releases/` 只剩 2 個；`git branch -vv` main 與 origin 同步 |

未能驗證（做到該步驟時先補驗）：2.2.0 的 `install.py verify --live` 與 `rollback` 是否仍可執行（只讀 diff 未實跑）；`failed-uat-*.json` 與 rc 版本對應靠 mtime 推斷；`~/.config/hermes/*` 與 confidential spec 依紅線未開。

### 6.4 待使用者拍板

| 代號 | 問題 | 建議 |
|---|---|---|
| A | 46 個 staged 刪除（Iris UAT harness＋舊部署機制）commit 還是 `git reset`？ | **已拍板（2026-09-05）：commit**，拆兩個 commit 留在 `minimal-governance`，先不合 main；理由：分支與 main 同指 `ccc68c6`、15,330 行只在工作樹；刪除集合 0 個活引用；舊閘門 24 次 UAT 全失敗、0/6 推廣。執行見 6.3a |
| B | `iris-runtime/current` 停在 rc.26，rc.27～rc.31 去留？ | 建議 B1：rc.26 續用，rc.27–30 不推（rc.27 canary 已回滾、rc.28–30 從未過閘、rc.31 未建），改建 2.2.0 走新閘 canary；rc.30 走舊閘走不通（舊閘要 UAT receipt，rc.30 是 0 執行）。6.3a 步驟 5–6 預設此路徑，未正式拍板 |
| C | `fleet/` 放 `~/Hermes-Agent` 還是 `~/.hermes`？ | `~/Hermes-Agent`（治理 repo、且要取代的兩份 plist 副本就在那） |
| D | `loop-engineering`（100 MB、07-09 起未動）、GOVNHUB（本機已死、Action 仍跑）、EAGA optimizer（每日 09:20）去留？ | loop-engineering 歸檔為 git tag 後刪；GOVNHUB 停 workflow；EAGA 保留但納入 fleet |

### 6.5 紅線（本節專用，疊加 §4）

- `~/Hermes-Agent/*/hermes.project.yaml` 七份契約真本不動；`fleet.yaml` 是排程登錄簿，不是契約，不放 `approval`／`write_scope` 之類欄位。
- `run.sh` 與 `runs.jsonl` 不含任何 token、不含 Slack 訊息內容、不含 ai-news-hub 原始評分／標題／URL。
- Hermes gateway 行程內只跑 F-3 那一個 cron 工作；任何 `needs_model: true` 或 `needs_docker: true` 的工作一律 launchd。
- 刪除任何 6.1 表項目前先列清單給使用者，不因「已在表上」直接刪。

### 6.6 狀態盤點

| 項目 | 狀態 |
|---|---|
| 盤點（launchd、pmset、du、git status、Hermes cron） | 已完成 2026-09-05 |
| 規劃（本節） | 已寫入 |
| F-0（Hermes-Agent `minimal-governance` 收斂） | 已完成 2026-09-05：步驟 1–5（備份、commit、HANDOFF、清理 push、tag／build／install／smoke／DM 人測）與步驟 6（S-F0-6a～6c：push＋main ff＋tag `v2.2.0`；24 個 failed-uat 歸檔刪除；14 個 rc 目錄歸檔刪除，`releases/` 剩 42、`current`→`2.2.0`）全部完成；Hermes-Agent 最終 commit `0ae4968`（S-F0-6d 回寫 commit 見該 repo git log）。F-1 可開工 |
| F-1～F-4 | 未開始；A 已拍板 commit（6.3a）；B 預設 B1 待正式拍板 |
| F-0 步驟 1 備份（2026-09-05） | 已完成：分支 `backup/pre-minimal-governance-20260905`=`ccc68c6`；stash 物件 `eacd1291d398779cb3094aa4360c46c1a5bdd8ff`（另掛 ref `refs/backup/f0-step1-stash` 防 gc，未套用未 drop）；untracked 10 項 tar 於 `~/Hermes-Agent-backup-20260905/untracked-f0-step1.tgz`（5.0 MB） |
| ai-news-hub §3 人工項（專用 Slack app／slack.env） | 未變，與本節無關 |
| Phase 4、收尾 | 未變 |

---

# 〔封存〕Firebase 熱冷層交接（2026-06-21，2026-07-07 更新，A–I 除 G 外皆已完成）

> 給接手的 coding agent / 維護者。**先讀本檔與 `CLAUDE.md`，再讀 `assets/`、`scripts/`、`*.md`。
> 不要重做已完成的重構——只驗證與接續。**

---

## Step 0 — 先做這個（清 lock + 提交基線）

接手的第一件事，**先於任何規劃**：清掉殘留 lock、把目前所有正規化變更（含本檔與 `CLAUDE.md`/`AGENTS.md` 更新）提交成乾淨基線。這樣 agent 讀到的是正確版本、之後的 diff 也有明確起點。Firebase 未設定也可先提交——網站照常運作。

```bash
cd ~/ai-news-hub
rm -f .git/index.lock                      # 沙箱遺留，必清否則 git 寫入失敗
git status                                 # 預期：3 改 + 多個新檔，0 已暫存
git add -A
git commit -m "♻️ 正規化：前端拆檔 + Firebase 書籤同步 + 冷封存 + 文件更新"
```

> 註：此 commit **不含** Firebase 真實憑證（仍是 placeholder），且 `archiver.env` 在 repo 外，安全。
> 完成後再依第 4 節 checklist 接續（smoke test → Firebase 設定 → 冷封存遷移 → push）。

---

## 1. 已完成（已寫入磁碟，**尚未 commit**）

| 區塊 | 內容 | 狀態 |
|------|------|------|
| 前端拆檔 | `index.html` 1,049→107 行；`assets/css/app.css` + `assets/js/` 九模組（classic script，順序固定） | ✅ 已驗證 `node --check` + 本機 http 200 |
| 書籤雲端同步 | `assets/js/firebase.js`（Email/Password + Firestore `users/{uid}`，offline-first） | ✅ 程式完成；待填 config |
| 冷封存 | `archives/{date}` 設計；`scripts/archive-to-firestore.mjs`（Node 零依賴 REST，scoped writer）；`history.js` 冷熱合併；`run-daily.sh` 已注入每日上傳+prune | ✅ 程式完成；待設定 |
| 安全規則 | `firestore.rules`（users 本人寫、archives 公開讀/writer 寫）、`firebase.json` | ✅ 待填 `WRITER_UID` + 部署 |
| 防膨脹 | `.gitignore` +`failed_*.txt`/bundle/emerging/`*.env` | ✅ |
| 文件 | `FIREBASE-SETUP.md`、`ARCHIVE-SETUP.md`、`CLAUDE.md`（已更新新架構）、`AGENTS.md`（收斂為指標） | ✅ |

驗證紀錄：9 個 JS `node --check` 全過、串接 bundle 語法過、`run-daily.sh`/`repo-slim.sh` `bash -n` 過、`archive-to-firestore.mjs --dry-run` 正確（今日 cutoff 06-14：42 檔搬冷層、06-19 留熱層）。

## 2. 待辦（需「人」在 Mac + Firebase console，agent 無法代）

> **2026-07-07 現況更新（第三輪，冷封存全鏈打通）**：A/B/C/D/E/F 全部完成。**C 已完成**：`firestore.rules`（綁 uid `pYozGzhoIHchJvONuHvjxkVN4b52`）已於 Console 規則編輯器發布。**D 已完成**：writer 帳號 `archiver@ai-news-hub-33c51.firebaseapp.com`。**E 已完成**：`~/.config/ai-news-hub/archiver.env`（chmod 600，off-repo）。**F 已完成**：`node scripts/archive-to-firestore.mjs --older-than 7 --prune` 一次性遷移 49 檔（2026-04-04…06-29）至 Firestore `archives/{date}`，成功 49、失敗 0，本機冷檔已 prune，只留近 7 天熱層（07-01/02/03/06/07）。此後 `run-daily.sh` 每日自動上傳逾 7 天並 prune。**剩餘可選：G repo 瘦身、孤兒帳號清理。**
> ⚠️ 遷移指令更正：用 `--older-than 7 --prune`（**非** `--all --prune`）。`--all` 會連近 7 天熱層檔一起 prune，破壞「近 7 天走 static」設計；`--older-than 7` 只搬並刪 < (今日-7) 的冷檔。
> ⚠️ env 變數名更正：實際為 `FB_API_KEY`/`FB_PROJECT_ID`/`WRITER_EMAIL`/`WRITER_PASSWORD`（`archive-to-firestore.mjs` 讀取），非舊述的 `ARCHIVER_EMAIL/PASSWORD`。
> 備註：另有孤兒帳號 `writer@ai-news-hub-33c51.firebaseapp.com`（uid `S8x1ULOvWbWiIAeLhNZMsSfFWVo1`，密碼遺失、無規則授權、無害），可於 Console → Authentication → Users 選擇性刪除。

| # | 待辦 | 為什麼只能人做 |
|---|------|----------------|
| A | 清除殘留 `.git/index.lock`（`rm -f .git/index.lock`） | 先前沙箱無法刪；git 寫入被它擋住 |
| B | 建 Firebase 專案 → 填 `assets/js/config.js` 的 `FIREBASE_CONFIG` | 需 Google 帳號登入 console |
| C | ~~啟用 Email/Password、建 Firestore、部署 `firestore.rules`~~ ✅ **2026-07-07 完成**（Console 規則編輯器發布） | 同上 |
| D | ~~建 writer 帳號 → 取 uid → 換掉 `firestore.rules` 的 `WRITER_UID` → 重部署~~ ✅ **完成** | 同上 |
| E | ~~建 `~/.config/ai-news-hub/archiver.env`（writer 帳密，off-repo）~~ ✅ **完成** | 機密，不進 repo |
| F | ~~一次性冷封存遷移：`node scripts/archive-to-firestore.mjs --older-than 7 --prune`~~ ✅ **完成**（49 檔搬 Firestore、本機留近 7 天） | 需 E 的憑證 + 網路 |
| G | repo 瘦身刪除：`bash scripts/repo-slim.sh`（bundle/failed log/emerging） | 沙箱無刪除權限；Mac 原生 git 可 |
| H | commit + push | — |
| I | ~~pmset 每日喚醒~~ ✅ **2026-07-07 完成**：經 `osascript ... with administrator privileges` 授權對話框套用 `pmset repeat wakeorpoweron MTWRFSU 17:55:00`；`pmset -g sched` 已顯示 `wakepoweron at 5:55PM every day`（原為錯誤的 Saturday 8:55PM） | — |

## 3. 勿動 / 勿誤判

- **勿重新內聯**：`assets/js/` 九模組是刻意拆分，別合回單檔。
- **placeholder 勿自填**：`FIREBASE_CONFIG`（`YOUR_*`）、`firestore.rules` 的 `WRITER_UID` 由人填，勿編造。
- **機密界定**：`firebaseConfig` apiKey **非機密**（公開前端 ID），可 commit；`archiver.env` 才是機密，已 gitignore + off-repo，**絕不 commit**。
- **後端擷取/驗證鏈**（`run-daily.sh` 主體、`validate.py`、`merge-stack.py`、`extract-json.py`、prompts/）運作中，除非明確要求只驗證不重寫。run-daily 僅新增了「冷封存上傳」一段。
- **未填 Firebase 前網站照常**：config 為 placeholder 時全部 no-op，書籤走 localStorage、歷史走 static——可安全先 push 再設定。

## 4. 上線 checklist（建議順序）

```bash
# 0+1) 清 lock + commit 基線 → 見上方「Step 0」，先完成它

# 2) 本機 smoke test
python3 -m http.server 8799   # 開 http://localhost:8799 點各頁/書籤/搜尋/歷史
node --check assets/js/*.js
node scripts/archive-to-firestore.mjs --older-than 7 --dry-run

# 3) Firebase 設定（依 FIREBASE-SETUP.md + ARCHIVE-SETUP.md）→ 填 config / WRITER_UID / archiver.env → 部署 rules

# 4) 冷封存遷移 + repo 瘦身（先 dry-run 再實跑；--older-than 7 保留熱層 7 天）
node scripts/archive-to-firestore.mjs --older-than 7 --dry-run
node scripts/archive-to-firestore.mjs --older-than 7 --prune
bash scripts/repo-slim.sh
git add -A && git commit -m "🧹 冷封存遷移 Firestore + repo 瘦身"

# 5) push
git push origin main
```

## 5. 已知小事
- `data/index.json` 目前僅 1 筆（舊歷史索引近乎空）；改用 Firestore 列表後歷史頁會恢復完整封存，run-daily 也會持續更新它。
- GitHub Pages 為 project page（base `/ai-news-hub/`）；前端全用相對路徑，勿改絕對路徑。
- **2026-07-06 事件（已處理）**：週一 models/tutorials/courses 抽 0 筆，根因非解析而是 Claude CLI 配額耗盡 + API Connection closed；當日 18:05 準時啟動但跑 87 分鐘（10 類 × 重試）中途撞 session limit，週類別排最後遭餓死。修正：①週一週類別優先擷取 ②配額/連線 sentinel 分級（硬性配額立即跳出、暫時性中斷保留重試）③extract-json.py 加 infra sentinel 診斷（見 commit `4664b31`）。同時發現並修 launchd plist 缺週末（僅 Weekday 1-5 → 已改每日觸發，解釋 07-04/05 的 missed）；pmset 每日喚醒仍待人設定（見第 2 節待辦 I）。
