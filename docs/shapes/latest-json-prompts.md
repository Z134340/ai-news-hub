<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

### J. `data/latest.json` 與 prompt marker

- `latest.json` 頂層：`date, time, generated_at, source, data{cat: []}, stats, _updated_at, validation{total, verified, warnings, removed, pass_rate(數值)}`。一般分類項目：`title, date, url, verified, url_status, title_score, complete, verified_at`；papers 另有 `title_zh, field, impact, institution, venue, authors`；tutorials/models 有 `is_new, first_seen, last_seen` 且可能沒有 `verified/url_status`；models 用 `model_name/release_date` 代替 `title/date`；skills 另有 `stars, forks, license, type, focus, tools`；`is_backfill` 可能不存在。**指標程式必須容忍缺 key。**
- `scripts/validate.py` 一般白名單：`TRUSTED_DOMAINS` 硬編碼集合 + import 時 `load_tier_b_domains()` 讀 `scripts/tier-b-domains.json` add-only 併入。企業生態系使用更窄的 `skills/official-ai-ecosystem-research/references/official-sources.json`：`official_info`／`models` 的主 URL 與證據 URL 必須命中官方網域。`--self-test` 離線檢查 11 個 RSS 探索分類；skills 為 GitHub API 決定性來源，不放進 feed registry。
- `data/logs/validate-YYYY-MM-DD.json`：`date, dry_run, total_items, verified, warnings, removed, details, per_item_results`，沒有分類層。
- `scripts/prompts/*.md` 10 檔各有兩個 HTML 註解區段：`<!-- SEARCH_QUERIES:BEGIN/END -->` 與 `<!-- PRIORITY:BEGIN/END -->`（`models.md` 是 PRIORITY 在前）；區段內容是自由 Markdown；目前沒有任何程式讀 marker，消費者留給 Phase 3 的 `apply-change.mjs`。
- `PRIORITY_KEYWORDS`（`assets/js/config.js:130-149`）：`{latin[], cjk[], cjkPatterns[]}`；唯一消費者 `render.js:21-31` 的 `buildPriorityRegex`；自動優化只允許對三個陣列 add-only。


- `scripts/prompts/governance.md` 是每日 `run-daily.sh` 擷取時讀取的搜尋提示；數發部 AI 專區是 HTML 探索入口（分類來源權威見 `docs/specs/categories.md`），不列入僅接受 RSS/Atom/RDF 的 `scripts/sources-registry.json`。`scripts/setup-prompts.sh` 保留相同入口與收錄限制；修改範本時不得執行整批產生來覆寫活提示。
