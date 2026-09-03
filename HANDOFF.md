# HANDOFF.md — 交接狀態（2026-09-04：auto-opt 自我強化迴圈）

> **新 session 先讀這份，再讀 CLAUDE.md 的「檔案 shape 速查」。不要重讀整個檔案，不要再 `/compact` 舊 session。**
> 舊 session `專案檔案討論` 已連續 14 次 compact 後失效，原因是每次摘要都遺失檔案 shape，導致重複整檔讀取。shape 已固化進 CLAUDE.md，本檔只記「做到哪、接下來做什麼、什麼不能碰」。

## 0. 一句話現況

Phase 0 與 Phase 1 已 commit（未 push）；Phase 2 只完成調查、**一個檔案都還沒寫**；工作樹乾淨在 `4a67b37`。

| Phase | 內容 | 狀態 | Commit |
|---|---|---|---|
| tag `pre-auto-opt` | Phase 0 之前的基線 | 已打 tag | `8338bc0` |
| 0 | `PRIORITY_KEYWORDS` 資料化、10 個 prompt 加 marker region、contract v2、`run-agents.sh` 預算 2100（S-5 ×5）、`health-check.yml` 改 UTC 12:00、`run-daily.sh` 補入項目標 `is_backfill` | 已完成 | `c4951fc` |
| 1 | 前端 好/中/不好 按鈕 → localStorage `ainews-fb` → Firestore `feedback/{uid}_{key}` → `pull-feedback.mjs` → 帳本 `human_rating` → `replay-learning.mjs` 聚合成 `learning_summary.human_ratings`；`run-agents.sh` step 00 非阻塞 + S-6i | 已完成（使用者手動項見 §3） | `4a67b37` |
| 2 | `agents/_control/canaries.json`、`build-category-metrics.mjs` → `data/agent/metrics-history.jsonl`、`agents/search-reviewer/` + `newshub_search_reviewer.py` 第四個模型步驟 | **調查完成，未動工** | — |
| 3 | `agents/change-evaluator/`、`apply-change.mjs`、`canary-check.mjs`、週報判例摘要 → Slack Iris 讀回 | 未開始 | — |
| 4 | `scripts/tier-b-domains.json` 由 `validate.py` 讀取（add-only） | 未開始 | — |
| 收尾 | CLAUDE.md 補 dashboard.js 載入順序、新步驟；狀態盤點表 | 未開始 | — |

## 1. 使用者已拍板的決策（不要再問）

1. 延伸既有學習迴圈（ledger → proposals → replay），不建第二套迴圈。
2. `memory/**` 維持人工專屬；機器只把判例預覽整理成週報 Issue，經 Slack Iris 送出，使用者在 Slack 內點選要收的項目。
3. contract v2 邊界字串只改本 repo；Hermes-Agent 真本不動。
4. 新網域走 Tier B、只增不減，清單放 `scripts/tier-b-domains.json`；`agents/_control/**` 刻意**不**列入 auto-apply allowlist。
5. 自動套用上限：每週 3 件、每分類 1 件、canary 3 晚、指標掉超過 10 個百分點即回退；先照這組數字跑一個月，再用 `data/agent/metrics-history.jsonl` 實際波動調整；數字只放 `agents/_control/canaries.json`，改數字不能需要改程式。
6. 模型步驟一律 pop `ANTHROPIC_API_KEY`、`--allowedTools ""`、`--permission-mode plan`，用既有訂閱，不引入額外計費。
7. 每個 Phase 各自 commit（trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`），**push 只在使用者明講時**。

## 2. Phase 2 施工單（下一個 session 直接照做）

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
| Phase 3 前填 Slack 設定 | `~/.config/ai-news-hub/slack.env`（webhook 或 bot token） | 週報無法送出；此檔永不入版控 |
| push | `git push` | 目前三個 commit 只在本機 |

## 4. 勿動 / 勿誤判

- **repo 是公開的。** `OPS-RUNBOOK.md`、`archiver.env`、`*.env`、`data/agent/.preview/` 都在 `.gitignore`，永不移除；`.preview/` 那條是因為 `run-daily.sh` 每天 `git add data/`。
- `~/.config/hermes/*.env`、`iris-deployment.key`、`.iris-deployment-authorization-claims/` 是機密，連變數名都不要讀（classifier 會拒絕，不要重試）。
- `promote.sh` 的 `NEVER_FILES` 與「刻意不提供 `--promote`」都不能改；S-2 會擋任何步驟出現 `--promote`／`--out-dir`。
- `raw_feedback_off_repo`：原始評分、標題、URL、人工評語只留 `~/.ai-news-hub/learning/`；repo 只放聚合數字與 id。
- `memory/**`、`skills/**` 人工審核專屬；`agents/_control/**` 不進 auto-apply allowlist。
- `hermes.project.yaml` 內 `deny_read_write_paths`、`approval.*: manual_only`、`direct_skill_patch:false`、`tool_scope_change:false` 是契約，不放寬。
- 已取消的評分不會傳到帳本（Phase 1 已知限制，非 bug）。
- `Hermes-Agent/Hermes-auto-optimization-manual.spec.json` 標記 confidential，不得引用到公開產物。

## 5. 低 context 工作法（在本專案強制）

1. 不整檔讀取：`grep -n` 找行號，`sed -n START,END` 只看要改的段落；資料檔用 `head -c`、`jq keys`、`wc -l`。
2. 廣泛調查交給 Explore subagent，主 context 只收結論。
3. 新檔用 heredoc 寫入，不回顯；同一檔的多處修改集中在一次 python heredoc。
4. 一個 session 只做一個 Phase；做完 commit，然後開新 session，不 `/compact`。
5. shape 一律先查 CLAUDE.md「檔案 shape 速查」，查不到再開檔並回填該節。

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
