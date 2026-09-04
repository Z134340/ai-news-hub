<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

### C. 帳本：`scripts/agent/lib/ledger.mjs`（off-repo）

路徑 `~/.ai-news-hub/learning/events.jsonl`；游標 `~/.ai-news-hub/learning/feedback-cursor.json` = `{last_ts, seen:{docName: ts}}`。

| 欄位 | 值域 |
|---|---|
| `ts` | ISO8601 |
| `event_type` | `outputs_generated` `curation_imported` `output_accepted` `user_correction` `proposal_reviewed` `audit_finding` `human_rating` `proposal_evaluated` `proposal_auto_applied` `canary_reverted`（未知即 throw；後三種已為 Phase 3 預留） |
| `actor` | 預設 `"system"`；回饋為 `"human"` |
| `subject_type` / `subject_id` | string；`human_rating` 為 `"news_item"` / item_id |
| `payload` | object |

`human_rating.payload`：`rating ∈ {"good","mid","bad"}`（字串，非數字）、`cat`、`item_date`、`title`、`url`、`source`（hostname 去 `www.`）、`uid_hash`（sha256 前 8 碼）。`readEvents()` → `{events, skipped}`；`ledgerStats()` → `{events_count, event_types, skipped_count}`。

