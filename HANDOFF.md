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
| 3 | `agents/change-evaluator/`、`apply-change.mjs`、`canary-check.mjs`、週報判例摘要 → Slack Iris 讀回 | 未開始 | — |
| 4 | `scripts/tier-b-domains.json` 由 `validate.py` 讀取（add-only） | 未開始 | — |
| 收尾 | CLAUDE.md 補 dashboard.js 載入順序、新步驟；狀態盤點表 | 未開始 | — |
| S-PWR | 電池模式偵測與 17:50 電源提醒（方案 1 加 2，獨立施工單） | 已 commit 並 push；P-1／P-2／P-3 全做，plist 已裝、`launchctl list` 兩個 label 都在；拔電源 kickstart 通知已由使用者驗過（剩電池模式整跑，見 §3） | `62a9a65` |

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

Phase 3、4 的細節見上表（紀律見 CLAUDE.md「auto-opt 路線圖與工作紀律」）；帳本 `EVENT_TYPES` 已預留 `proposal_evaluated`、`proposal_auto_applied`、`canary_reverted`，Phase 3 不需改 `ledger.mjs`。

## 3. 需要「人」做的事（agent 無法代）

| 項目 | 指令／位置 | 未做的後果 |
|---|---|---|
| 部署 Firestore rules（Phase 1） | `firebase deploy --only firestore:rules` | `pull-feedback.mjs` dry-run 回 403，帳本收不到 `human_rating` |
| 網站登入 | 站上以 writer 帳號登入 | 按鈕只寫 localStorage，不會同步到 Firestore |
| S-PWR 驗收（電池模式整跑） | 拔電源 kickstart 通知已於 2026-09-05 由使用者驗過（有跳「18:00 擷取即將開始，請接電源」）。剩下：任一晚電池模式跑完，`python3 -c "import json;h=json.load(open('data/health.json'));print(h['power_source'],h['errors'])"` 應印 `battery` 與回退備註 | 只是驗收，功能已裝好；不影響 AC 正常執行 |
| Phase 3 前填 Slack 設定 | `~/.config/ai-news-hub/slack.env`（webhook 或 bot token） | 週報無法送出；此檔永不入版控 |
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
