<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

### H. `agents/<name>/` scaffold 與 `hermes.project.yaml`

目錄：`.hermes/optimization-profile.json`、`AGENTS.md`、`<X>_RUBRIC.md`、`hermes.project.yaml`、`golden/{manifest.json, cases/C-0n.json, redteam/R-0n.json}`、`memory/{MEMORY.md, precedents.jsonl, principles.md}`、`skills/<skill>/SKILL.md`。三個現有 agent：`brief-writer`（high）、`tech-roadmap`（high）、`trend-analyst`（medium）。

`hermes.project.yaml` 鍵樹（三個 agent 完全相同，只差值）：`project_id, display_name, role:"judgment-agent", risk_profile(medium|high), read_scope[], write_scope[]（=memory/precedents.jsonl）, deny_read_write_paths[]（.env, .env*, secrets/, **/*.key, **/credentials*, ../../data/agent/*.json, ../../data/latest.json, ../../data/index.json）, read_only_paths[], test_commands[], learning{mode:shadow, shared_learning:ranking_only, shared_ledger:false, decisions_ledger}, approval{high_risk:manual_only, publish:manual_only}, agent_outputs{assessment, precedents, learning_status}, allowed_autonomy{7 個 boolean，含 direct_skill_patch:false, tool_scope_change:false}, evidence{eval_commands, required_controls}, skills[]（skill-contract-v1）`。Root `hermes.project.yaml` 是專案級版本，無 `allowed_autonomy` / `evidence`。

`golden/manifest.json`：`schema:"trend-golden-manifest-v0.1", manifest_version, analyst_version, rubric_version, expectation_semantics{13 key}, suites.cases / suites.redteam{gate:"hard", must_pass_ratio:1.0, fixtures[]}`；case 有 `hard/soft/evidence`，redteam 有 `vector/field/offline_must_survive/hard/note`。`precedents.jsonl` 每行 `{id:"P-nnn", date, situation, call, discriminator, rubric:"TR-n"}`。`.hermes/optimization-profile.json` 與 root 只差 `project_id, root, managed_targets.forbidden, tests, success_metrics`。

