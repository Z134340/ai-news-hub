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
| `proposals.json` | `proposal_count, proposals[]` → `proposal_id, created_at, proposal_type, status, target_files, rationale, expected_effect, risk, rollback, evidence, requires_human_review, advisory_only, production_applied`；單筆也在 `data/agent/proposals/prop-*.json` |
| `metrics-history.jsonl`（Phase 2-A 新增，由 `scripts/agent/build-category-metrics.mjs` 產出，同日冪等） | 每行一分類：`schema("category-metrics-v0.1"), date, generated_at, cat, items, verified, verified_rate, needs_review, title_low_match, backfill, priority_hits, priority_hit_rate, human_rating_score(null 可), human_rating_count, validation_pass_rate`；只有聚合數字，不含標題／URL；`--self-test`、`--dry-run` |

