<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

### J. `data/latest.json` 與 prompt marker

- `latest.json` 頂層：`date, time, generated_at, source, data{cat: []}, stats, _updated_at, validation{total, verified, warnings, removed, pass_rate(數值)}`。一般分類項目：`title, date, url, verified, url_status, title_score, complete, verified_at`；papers 另有 `title_zh, field, impact, institution, venue, authors`；tutorials/models 有 `is_new, first_seen, last_seen` 且可能沒有 `verified/url_status`；models 用 `model_name/release_date` 代替 `title/date`；`is_backfill` 可能不存在。**指標程式必須容忍缺 key。**
- `scripts/validate.py` 白名單：`TRUSTED_DOMAINS` 硬編碼集合 + import 時 `load_tier_b_domains()` 讀 `scripts/tier-b-domains.json`（`{schema:"tier-b-domains-v0.1", note, domains[]}`，即 apply-change `TIER_B_DOMAINS` 區段）add-only 併入；`check_domain_whitelist` 去 `www.` 精確比對。`--self-test` 離線 17 項（含 `scripts/sources-registry.json`：`{schema:"sources-registry-v0.1", checked_at, check_method, tier_legend, consumers, categories{cat:[{name,tier,lang,site|null,feed,type}]}}`，10 分類各 ≥ 3 feed）。
- `data/logs/validate-YYYY-MM-DD.json`：`date, dry_run, total_items, verified, warnings, removed, details, per_item_results`，沒有分類層。
- `scripts/prompts/*.md` 10 檔各有兩個 HTML 註解區段：`<!-- SEARCH_QUERIES:BEGIN/END -->` 與 `<!-- PRIORITY:BEGIN/END -->`（`models.md` 是 PRIORITY 在前）；區段內容是自由 Markdown；目前沒有任何程式讀 marker，消費者留給 Phase 3 的 `apply-change.mjs`。
- `PRIORITY_KEYWORDS`（`assets/js/config.js:130-149`）：`{latin[], cjk[], cjkPatterns[]}`；唯一消費者 `render.js:21-31` 的 `buildPriorityRegex`；自動優化只允許對三個陣列 add-only。

