<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

### G. `scripts/agent/` 其他腳本（一行一檔）

| 檔 | 用途 / 旗標 / 輸出 |
|---|---|
| `build-insights.mjs` | 語料 → `trends.json`、`candidates.json`、`recommendations.json`；`--window --out-dir --promote --self-test` |
| `build-timeline.mjs` | `lib/trend-metrics.mjs` 每日頻次 → `timeline.json`；同上旗標 |
| `build-roadmap-input.mjs` | timeline + trend-assessment → `roadmap-input.json`；`--timeline --trend --curation --clusters --out --promote --self-test` |
| `build-brief-input.mjs` | 語料 + timeline + 兩份上游 → `brief-input.json`（`brief-input-v0.1`） |
| `harvest-precedents.mjs` | 閘 1 降級紀錄 → 判例候選（`.preview/precedent-proposals/`） |
| `build-current-state-manifest.mjs` / `build-system-status.mjs` | observer 09/10；`--out --root --self-test`、`--manifest --out --root --schema --self-test` |
| `validate-system-status-schema.mjs`、`verify-dashboard-system-status.mjs`、`freshness-release-gate.mjs`、`build-review-packet.mjs` | 驗證 / 一致性 / 新鮮度閘 / 人審包；皆有 `--self-test`（verify-dashboard 無旗標） |
| `promote.sh` | `.preview/` → `data/agent/` 人工晉升；`--apply --allow-degraded --window --root --self-test`；第 53 行 `NEVER_FILES="roadmap-input.json brief-input.json brief-input-7d.json agent-run-status.json current-state-manifest.json search-review-input.json"`；P-2 只掃 `.preview/*.json` 頂層，子目錄不算 |
| `build-search-review-input.mjs` | Phase 2-5：metrics-history + 10 支 prompt marker 區段 + `PRIORITY_KEYWORDS` + human_ratings 聚合 + canaries 快照 → `.preview/search-review-input.json`（`search-review-input-v0.1`；在 NEVER_FILES）；`--window --metrics --out --self-test`（T-1..T-13；T-3 以 `!= null` 分辨「缺 marker」與「空區段」） |
| `build-change-eval-input.mjs` | Phase 3-A 閘 2 輸入。讀 `.preview/search-review.json`（只留 `status=pending_review`）＋ `proposals.json`（近 7 天 `evaluated/canary` 算 in_flight）＋ `agents/_control/canaries.json`（配額唯一來源，缺檔 → remaining 0）＋ metrics 14 晚 → `.preview/change-eval-input.json`（schema `change-eval-input-v0.1`，鍵 `source/quota/canaries_in_flight/proposals/metrics_window/allowlist_targets/boundary`）。上游無 `rollback` 時依 change_type 補並標 `rollback_source: derived`。`slimProposal` 保留 `patch`（非物件 → `null`；patch 內字串一樣過 `scrub`，含 URL 者整串換成 `[url-removed]`；S3-C2）。`quota.in_flight/in_flight_by_category/remaining` 只算 `production_applied===true` 的 in_flight（與 apply-change `countInFlight` 同尺），`quota.dedupe_in_flight` 與 `canaries_in_flight[]`（每筆帶 `production_applied`）仍含全部 7 天內 `evaluated/canary` 供閘 2 reversibility-check 去重。缺 search-review.json 仍寫出 `proposals: []`。`--self-test` T-1..T-12；export `build/scrub/deriveRollback/loadInFlight`。promote.sh NEVER_FILES 已含此檔。 |
| `lib/corpus.mjs` / `lib/lexicons.mjs` / `lib/trend-metrics.mjs` | 語料讀取（熱層 7 天、`~/.ai-news-hub/corpus/` 34 天）／六個固定 `cluster_id` 詞庫／決定論指標（刻意不消毒標題） |

