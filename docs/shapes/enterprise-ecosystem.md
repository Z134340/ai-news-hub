# 企業生態系 shape

| 邊界 | 實作位置 |
|---|---|
| 主選單與兩個子分頁 | `assets/js/config.js` 的 `SECS`、`ECOSYSTEM_SUBS`、`SUBS_BY_SECTION`；`assets/js/ui.js` 的 `renderSubTabs/switchSec/switchSub` |
| 畫面容器 | `index.html` 的 `panel-ecosystem`、`sub-official_info`、`sub-models` |
| 卡片 | `assets/js/render.js` 的 `renderOfficialInfo`、`renderModels`；舊封存缺 `official_info` 由 `assets/js/data.js` 補空陣列 |
| 搜尋 | `assets/js/config.js` 的 `SEARCH_CATS`；`assets/js/search.js` 支援 `url`／`source_url` |
| 擷取提示 | `scripts/prompts/official_info.md`、`models.md`；兩者都含 `PRIORITY` 與 `SEARCH_QUERIES` marker |
| 官方來源唯一名單 | `skills/official-ai-ecosystem-research/references/official-sources.json`；prompt 與 `validate.py` 共同引用 |
| 結構與來源閘 | `scripts/validate.py` 的 `REQUIRED_FIELDS`、`CATEGORY_DATE_LIMITS`、`check_official_ai_company_domain`；公司名稱與網址網域必須是 registry 中的同一組配對 |
| 累積 | `scripts/merge-stack.py`：官方資訊 30 天／20 筆，模型 90 天／20 筆；canonical URL 優先去重，重複出現沿用 `first_seen` 且不重新標成新項目，只寫分類檔 |
| 每日接線 | `scripts/run-daily.sh`：`official_info`、`models` 都在 `DAILY_CATS`；`tutorials/courses` 才是週一分類 |
| 探索與學習 | `scripts/sources-registry.json` 的兩分類 feed；`EDITORIAL_CATEGORIES`、`PROMPT_CATS`、metrics `CATEGORIES` 均含 `official_info` |

相容性規則：`models` data key 不改名；「企業生態系」只是一層 UI 導覽。舊 `latest.json` 與歷史快照沒有 `official_info` 時必須正常顯示空狀態。資料擷取、驗證及發布仍由既有候選檔交易流程處理，不能讓 `merge-stack.py` 直接寫 `latest.json`。
