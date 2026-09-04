<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

### A. L3 判讀層：`scripts/run-agents.sh`（491 行）

| 項目 | 內容 |
|---|---|
| 環境變數 | `AGENT_BUDGET_SEC`（預設 2100）、`AGENT_STEP_TIMEOUT_SEC`（420）、`AGENT_INSIGHTS_WINDOW`（7）、`AGENT_TIMELINE_WINDOW`（90）、`AGENT_MODEL`（選用，加 `--model`）；`MIN_REMAIN_SEC=45` 常數 |
| CLI | `--dry-run`（model step 改 `--print-prompt`）、`--self-test`、`--strict`、`--budget N`、`--step-timeout N`、`-h`；未知參數 exit 2 |
| `run_step name cmd…` | DAG 感知：預算耗盡 → `skipped_budget`、上游失敗 → `skipped_dep`；輸出 `$TMP_DIR/$name.out`；設 `LAST_STEP_STATUS` / `FAILED_STEP`；恆 `return 0` |
| `run_model_step name artifact cmd…` | 先快照 `.preview/$artifact` → `$SNAP_DIR`，跑 `run_step`，再 `guard_verdict`（新檔 `.source=="fail_open"` 而快照不是 → 還原） |
| `run_observer_step name cmd…` | 無視預算與上游失敗一定跑；失敗仍設 `FAILED_STEP` |
| `model_timeout` | `min(MODEL_STEP_TIMEOUT, remain-15)`，下限 60 |
| Step 順序 | `00-pull-feedback`（跑完清 `FAILED_STEP`）→ `01-insights` → `02-timeline` → `03-trend-assess`(model, `trend-assessment.json`) → `04-roadmap-input` → `05-roadmap`(model, `roadmap.json`) → `06-brief-input` → `07-brief`(model, `brief-latest.json`) → `08-precedents`（前面把 `FAILED_STEP` 存進 `HARVEST_BLOCKER` 再清）→ `09-current-state-manifest`(observer) → `10-system-status`(observer) |
| Self-test | S-1 執行檔存在（15 支）／S-2 無 `--promote`／S-2b 無 `--out-dir`／S-3 `.gitignore` 含 `data/agent/.preview/`／S-4 status 檔在 preview 內／S-5 `BUDGET_SEC ≥ MODEL_STEP_TIMEOUT×5`／S-6 無 step 動 `memory/`／S-6b~S-6i 轉呼叫子腳本 `--self-test`（S-6i = pull-feedback）／S-7 `bash -n`／S-8 model artifact 集合 == `"brief-latest.json roadmap.json trend-assessment.json "`／S-8b model runner 不得用裸 `run_step`／S-8c、S-8d observer 09/10 精確行／S-9a~f `guard_verdict` 真值表 |
| 加第四個 model step 要改 | S-1 清單、S-8 期望字串（排序後）、S-8b regex `newshub_(agents|roadmap|brief)\.py`、必要時 S-5 乘數 |
| 輸出 | `.preview/agent-run-status.json`（`agent-run-status-v1`：`mode, advisory:true, production_write:false, publish:"manual_only", started_at, finished_at, duration_sec, budget_sec, overall(ok|degraded|failed), counts, steps[], freshness{source_latest_date,generated_at}, restored_artifacts[]`）；log 在 `mktemp -d -t ai-news-hub-agent`（EXIT 刪）；exit 0（degraded 也 0）、`--strict` 且非 ok → 1 |

