# AH-01 資料契約 v2 shape

權威契約：`docs/specs/data-formats.md`；驗證／隔離行為：`docs/specs/validate.md`。

| 邊界 | 位置與職責 |
|---|---|
| 正式 schemas | `schemas/data/v2/{latest,common,news-item,official-info,models}.schema.json`；Draft 2020-12，本機相對 `$ref`，無遠端解析 |
| 離線 schema 執行 | `scripts/contracts/schema.py`；只實作上述 schemas 使用的 vocabulary，未知 keyword／外部 ref 拒絕；不宣稱是通用 JSON Schema 引擎 |
| 純函式 migration | `scripts/contracts/data_v2.py`：`prepare_item`、`migrate_document`；無網路、無當前時間、無檔案寫入；只新增契約／審核 metadata，不生成新聞或模型事實 |
| 身分 | 同模組 `canonical_url`、`stable_item_id`、`source_url`；validator 與 merge-stack 共用 URL 規則；不改原始 URL／書籤 inputs |
| Migration CLI | `scripts/migrate-data-v2.py --input ... --output ... --report ...`；輸出與報告必須為不同的新檔且不在本 worktree `data/`；禁止覆寫輸入；隔離原始資料完整放 report |
| Validator | `scripts/validate.py`：先 schema／migration、再日期／來源／URL 檢查；`--offline` 唯讀、不跑 freshness 或網路；分類報告區分 schema／legacy／缺證據／quarantine |
| 累積 | `scripts/merge-stack.py` import 共用 canonical；獨立 CLI 保留；daily 改由 AH-02 呼叫純 merge_category，只用合格候選與可靠前版，見 `category-quality.md` |
| 未來 producer | 11 份 `scripts/prompts/*.md` 要求 `source_title`／`display_title`；一般九分類初始化範本同步，企業兩分類仍引用既有 canonical prompts；schema／ID 由後端供應，不交模型猜算 |
| 前端相容輸出 | `assets/js/render.js` 讀可用 `display_title`（論文保留原有雙語呈現、模型保留 model_name）；只有 `verified === true` 顯示綠勾，needs_review 顯示待複核；`config.js:itemKey` 完全不動 |
| Fixtures／測試 | `scripts/tests/fixtures/data-contract/`、`test_data_contract.py`；由既有 CI 的 unittest discover 自動收集；另有既有 Python／Node 回歸 |

`latest.data.models` 與其他分類 key 不改名；舊封存缺分類仍可讀。`item_id` 是來源頁身分，同一來源頁跨分類相同，不是模型實體／版本 ID。不得以這個欄位直接替換書籤 key；AH-08 的 alias／雙讀／資料遷移尚未執行。
AH-02 接續入口：`category-quality.md`。v2 latest additive metadata／分類品質與原件儲存已落地；AH-01 migration sidecar 保持原用途，未改書籤 ID。
