<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

### I. `data/agent/*.json` 頂層（不含 `.preview/`）

| 檔 | 頂層 → 元素欄位 |
|---|---|
| `trends.json` | `generated_at, source_latest_date, profile_version, window_days, mode, advisory, production_write, schema_version, input_summary, clusters[]` → `cluster_id, title, score, score_breakdown, evidence_count, unique_item_count, financial_signal_rate, categories, sources, why_now, financial_implication, suggested_action, evidence` |
| `timeline.json` | `metrics_schema, window{start,end,observed_days,missing_dates,continuity}, axis{dates,…}, totals, clusters[]` → `cluster_id, title, present_in_window, totals, series, delta, moving_average{ma7,ma30,ma90}, slope, source_concentration, syndication_evidence` |
| `candidates.json` | `candidate_count, candidates[]` → `candidate_id, candidate_type, topic, category, status, score, scores, reason, why_now, research_questions, suggested_next_queries, evidence, boundary` |
| `recommendations.json` | `recommendations[]` → `recommendation_id, cluster_id, priority, title, rationale, suggested_action, review_questions, evidence_urls` |
| `trend-assessment.json` | `schema, rubric_version, analyst_version, assessments[], source, gate{…}, duration_ms, attempts, model, session_id` → `cluster_id, stage, confidence, syndication_call, headline_zh, scores, rationale, rubric_hits, security_flag` |
| `roadmap.json` | 同上外殼，`roadmaps[]` → `cluster_id, trajectory, horizon, next_milestone, falsifier, watch_signals, blockers_ranked, confidence` |
| `brief-latest.json` | `…, highlights[], omitted_note_zh, security_notice{detected,scope,note_zh}, gate{…}` → `highlight_id, headline_zh, body_zh, why_it_matters_zh, confidence, confidence_ceiling, evidence_ids, cluster_id` |
| `proposals.json` | `proposal_count, proposals[]` → `proposal_id, created_at, proposal_type, status, target_files, rationale, expected_effect, risk, rollback, evidence, requires_human_review, advisory_only, production_applied`；單筆也在 `data/agent/proposals/prop-*.json`；Phase 3（`apply-change.mjs` ／ `canary-check.mjs` 寫入）追加欄位見下一列 |
| `proposals.json`（Phase 3 欄位） | 閘 2 裁定後：`evaluated_by("change-evaluator"), evaluated_at, verdict, reasons`（字串陣列，只給人看、程式永不解析）。`status` 生命週期 `evaluated`（無 patch／noop，`production_applied:false`，永不進 canary）→ `canary`（08e 實際改檔，`production_applied:true`）→ `auto_applied`（`confirmed_at`）或 `reverted`（`reverted_at`）。canary 欄位：`canary_started`(YYYY-MM-DD), `canary_started_at`(ISO), `baseline{verified_rate,priority_hit_rate,nights}`（套用當下該類別近 7 夜中位數）, `rollback{snapshot{file,region,before},note}`（`region` ∈ prompt 區段名／`PRIORITY_KEYWORDS`／`TIER_B_DOMAINS`；`before` 為區段原文，tier-b 為整檔）, `applied_by("apply-change")`, `diff_summary`；00c 只看 `status==="canary" && production_applied===true`，夜數＝`metrics-history.jsonl` 該 `cat` 在 `canary_started` 之後的不同 `date` 數，門檻 `canary_nights`／`revert_drop_pp` 只讀 `agents/_control/canaries.json` |
| `metrics-history.jsonl`（Phase 2-A 新增，由 `scripts/agent/build-category-metrics.mjs` 產出，同日冪等） | 每行一分類：`schema("category-metrics-v0.1"), date, generated_at, cat, items, verified, verified_rate, needs_review, title_low_match, backfill, priority_hits, priority_hit_rate, human_rating_score(null 可), human_rating_count, validation_pass_rate`；只有聚合數字，不含標題／URL；`--self-test`、`--dry-run` |

