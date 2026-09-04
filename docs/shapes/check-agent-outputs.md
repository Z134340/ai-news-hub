<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

### F. contract v2 驗證器：`check-agent-outputs.mjs`（230 行）

旗標 `--strict`、`--self-test-boundary`；驗 `data/agent/`（不是 `.preview/`）。`REQUIRED_BOUNDARIES`：`agent_outputs_advisory_only, no_direct_prompt_patch, raw_feedback_off_repo, human_review_required_for_memory_and_skills, evaluator_gated_auto_apply`。proposal `status ∈ {pending_review, evaluated, rejected, auto_applied, canary, reverted}`；`pending_review` 必須 `requires_human_review:true, advisory_only:true, production_applied:false`；非 pending 需 `evaluated_by` 且 `target_files` 全在 allowlist。`AUTO_APPLY_ALLOWED_TARGETS`：`scripts/prompts/[a-z]+.md`、`assets/js/config.js`、`scripts/tier-b-domains.json`。`BLOCKED_TARGETS`：`.env`、`secrets/`、`firebase.json`、`firestore.rules`、`.github/workflows/deploy.yml`、`data/latest.json`、`data/index.json`。B-14 擋 `agents/_control/canaries.json`。

