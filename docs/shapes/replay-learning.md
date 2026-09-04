<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

### E. `replay-learning.mjs` 與 `learning-status.json`

- 寫到 `.preview/learning-status.json`；`--promote` 才寫 `data/agent/learning-status.json`。旗標 `--promote --self-test --strict`。
- 頂層：`mode:"auto-opt-v2", last_replay_at, events_count, profile_version, active_boundaries[6], proposal_count, last_error, skipped_events_count, learning_summary`。
- `learning_summary`：`generated_from_events, summary_limit(6), topic_signals[], source_signals[], lens_signals[]{id,weight,direction}, human_ratings{}, style_signals[], applied_effect_counts{}, latest_profile_version, latest_outputs_at`。
- `human_ratings`：`{half_life_days:30, items_rated, by_category[], by_source_domain[]}`，元素 `{id, good, mid, bad, score, feedback_count}`，依 `feedback_count` 降冪取前 6；`score = Σ(0.5^(ageDays/30)·v)/Σweight`，good=+1、mid=0、bad=-1，round 3 位。
- 注意：磁碟上的 `data/agent/learning-status.json` 是 2026-07-09 舊版，沒有 `human_ratings`；要看新欄位請看 `.preview/`。

