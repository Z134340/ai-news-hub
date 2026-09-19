## 檔案 shape 速查（2026-09-04，由 Explore 逐檔核對；自 CLAUDE.md 拆出）

用法：要改哪個檔，只讀對應的一份 shape 檔（各 1–3 KB），不要整目錄讀。查不到的 shape，開檔確認後回填到對應檔案。

| 要改的目標 | 先讀 |
|---|---|
| A 版趨勢簡報、動態焦點與觀測 | `docs/shapes/trend-briefing.md` |
| 熱門 Agent Skills 候選、GitHub 排名與前端 | `docs/shapes/hot-skills.md` |
| 企業生態系導覽、官方來源、每日累積與相容性 | `docs/shapes/enterprise-ecosystem.md` |
| 前端個人資料／冷層、`validate.py`、`run-daily.sh`／發布與程序鎖 | `docs/shapes/site-robustness.md` |
| release manifest、內容 hash、前端版本化 cache 與降級 | `docs/shapes/release-manifest.md` |
| `scripts/run-agents.sh`（L3 判讀層、step 清單、self-test S-1～S-8b） | `docs/shapes/run-agents.md` |
| `scripts/newshub_agents.py`（模型 runner，可 import） | `docs/shapes/newshub_agents.md` |
| `scripts/agent/lib/ledger.mjs`（off-repo 帳本、EVENT_TYPES） | `docs/shapes/ledger.md` |
| `scripts/agent/pull-feedback.mjs`、Firestore `feedback/` | `docs/shapes/pull-feedback.md` |
| `scripts/agent/replay-learning.mjs`、`learning-status.json` | `docs/shapes/replay-learning.md` |
| `scripts/agent/check-agent-outputs.mjs`（contract v2 驗證器） | `docs/shapes/check-agent-outputs.md` |
| `scripts/agent/` 其他腳本（含 `promote.sh` NEVER_FILES） | `docs/shapes/agent-scripts.md` |
| `agents/<name>/` scaffold、`hermes.project.yaml` | `docs/shapes/agents-scaffold.md` |
| `data/agent/*.json` 頂層（不含 `.preview/`） | `docs/shapes/data-agent-json.md` |
| `data/latest.json`、prompt marker、`PRIORITY_KEYWORDS` | `docs/shapes/latest-json-prompts.md` |

- [全站研究簡報主題](site-theme.md)：共用色彩、元件、響應式與動態樣式入口。
