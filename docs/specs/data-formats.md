<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

## data/latest.json 格式

```json
{
  "schema_version": 2,
  "date": "YYYY-MM-DD",
  "time": "ISO 8601 (Asia/Taipei)",
  "generated_at": "07:48",
  "source": "local",
  "data": { "papers":[], "topnews":[], "taiwan":[], "china":[], "usa":[], "techtrends":[], "governance":[], "tutorials":[], "courses":[], "official_info":[], "models":[], "skills":[] },
  "stats": { "papers":0, "topnews":0, "taiwan":0, "china":0, "usa":0, "techtrends":0, "governance":0, "tutorials":0, "courses":0, "official_info":0, "models":0, "skills":0 },
  "_updated_at": { "papers":"ISO 8601", "topnews":"ISO 8601", ... },
  "validation": { "total":0, "verified":0, "needs_review":0, "warnings":0, "removed":0, "pass_rate":0 }
}
```

AH-02 起，`_updated_at` 是各分類合格內容最後實質改變的時間，`_checked_at` 記最近嘗試，`_update_outcome` 分開本輪結果與實際供應資料。無可靠內容不填 updated；舊快照原值保留。精確契約、結果矩陣与例外見 `category-quality.md`。

`data/skills.json` 為 `{items, _updated_at, source}`；items 欄位見分類規範。AH-02 daily 擷取改寫私有候選；此 public 檔保留相容用途。有 `_update_outcome` 的 latest 已包含品質閘選出的 Skills，前端不再用此舊檔覆蓋；較舊版本仍可讀取。歷史快照沒有 `skills`，或舊封存沒有 `official_info` 時，前端須視為空陣列，不得中斷載入。

## data/health.json 格式

```json
{
  "last_run": "ISO 8601",
  "last_success": "ISO 8601",
  "last_success_scope": "local_processing",
  "publication": "pending",
  "last_date": "YYYY-MM-DD",
  "source": "local",
  "status": "ok|partial|failed|missed|not_run",
  "categories_ok": 7,
  "categories_failed": 0,
  "validation_pass_rate": 95,
  "consecutive_failures": 0,
  "last_missed": null,
  "errors": [],
  "power_source": "ac|battery"
}
```

`power_source`（S-PWR，2026-09-05）：`run-daily.sh` 啟動時以 `pmset -g batt` 第一行是否含 `AC Power` 判定，只放 `ac`／`battery` 兩值，不放電量。電池模式時 `errors` 會多一筆「電池模式執行（合蓋週期睡眠），N 類別回退」（N 為 `categories_failed`）。`errors` 排序：配額備註在前、電池備註在後。

---


2026-09-18 起：validation.pass_rate 為數值百分比，僅 verified=true 計入；needs_review 獨立計數。health 新增 `last_success_scope: "local_processing"` 與 `publication: "pending"`，發布結果以 run-daily 規格的 off-repo receipt 為準，不把 health 的處理成功視為推送／部署成功。

## AH-01：版本化資料契約 v2

Schema 在 `schemas/data/v2/`，入口 `latest.schema.json`；另有一般新聞、官方資訊、模型與共用項目 schemas。採 Draft 2020-12，相對引用全部隨 repo 保存，可離線解析。執行入口與支援的 schema vocabulary 見 `docs/shapes/data-contract-v2.md`。版本與本文的資料契約專用；不等於 learning-loop／agent adapter 的 contract v2。

### 版本與相容資料

- 根物件與每個 v2 item 使用整數 `schema_version: 2`。根最小必填為 `schema_version`、`data`；歷史快照可能缺 `time`／`stats`／個別分類，故不強補。已存在欄位仍驗型別，data 只接受已登錄分類的陣列。
- 無版本或整數 `1` 是 migration 輸入；未知版本、字串版本、布林版本拒絕，不能降格套 legacy。v2 根不接受未版本化 item。單分類 validator 不升級未處理分類的 root version；全分類成功輸出才設 root v2。
- `contract_state: current` 需完整新版欄位與非空 source_title／display_title；`legacy` 保存 `legacy: {from_version: 1, missing_fields: [...]}`。legacy 不是已驗證、不是發布資格，也不是免檢標籤。
- 舊模型只要求舊核心欄位：model_name/version/institution/release_date/domain/summary/advantages/benchmarks/highlights，與 url 或 source_url。缺新版能力、限制、分析、定價或證據欄位時保留原有資料、缺欄位保持不存在；不從名稱／摘要推測、也不補「無限制」「免費」「官方自述」等內容。已存在的新欄位仍須符合型別／enum，錯誤資料不藉 legacy 逃過 schema。
- `context_window`／`pricing`／`license` 的明確 null 表示未知；空 benchmarks/evidence_urls 是可接受的結構，不等於已驗證其內容。主要 URL 可作直接來源；是否符合公司網域及網路驗證另判。
- schema 不憑字元推測語言，也不證明內容真實。內容標題翻譯與來源一致性仍由來源證據驗證；本工項沒有進行真實內容複核。

### 原文與顯示標題

| 欄位 | 意義 |
|---|---|
| `source_title` | 可核實的來源頁原文標題；絕不由中文標題、model_name 或 summary 冒充 |
| `display_title` | 繁體中文顯示標題；migration 只沿用明確既有 display_title 或 title_zh，不能自行翻譯 |
| `title`／`model_name` | 舊 client 的相容欄位，migration 原樣保留，不重寫也不補缺，以免影響既有書籤 key |

無可靠原文或翻譯時，新欄位為 null 並記 needs_review；既有內容照常可讀。未來擷取提示要求另外提供 source_title/display_title，後端提供版本與 ID；未版本化 producer 輸入經相容 migration，不能因模型自行聲稱 schema_version 就跳過驗證。

### Canonical URL 與 item_id

唯一實作是 `scripts/contracts/data_v2.py`，validator 去重與 merge-stack 共用：

1. 僅接受無帳密的絕對 HTTP(S) URL；拒絕空白／控制字元、反斜線、非法 port／percent escape。
2. scheme／host 小寫、IDNA host、去預設 port、空 path 變 `/`；path 大小寫與尾斜線保留，不假定 HTTP 與 HTTPS 等價。
3. 去 fragment、大小寫不敏感的 `utm_*`、`fbclid/gclid/dclid/msclkid/mc_cid/mc_eid`；剩餘 query 按 key/value 排序，保留重複與空值。`ref`、`source` 可能有語意，故保留。
4. `canonical_url` 另外儲存；原始 `url`／`source_url` 不改寫，source_url-only 不新增 url。
5. `item_id = "ahn2_" + SHA256(UTF8("ai-news-hub:item:v2\n" + canonical_url))`，完整 64 位小寫 hex。排除分類、陣列順序、日期、標題、模型名；同來源頁跨分類同 ID。沒有合法 URL 就不能生成 ID，不採猜測標題 fallback。
6. query 排序及 fragment 去除是本版本明確等價規則；排序有特殊意義的來源、多公告共用單頁、redirect／canonical link／尾斜線別名不自動推斷。未來若要變更身分規則須另立版本與 alias migration。
7. 前端目前仍使用原 itemKey；不採新 item_id，也不清除／重建收藏。書籤切換、Firebase alias／雙讀不在 AH-01。

### 明確 migration 與回退

```sh
python3 -B scripts/migrate-data-v2.py --input /path/history.json --output /tmp/history-v2.json --report /tmp/history-v2-report.json
python3 -B scripts/validate.py --input /tmp/history-v2.json --offline
```

- CLI 只接受新的 output/report 路徑；不覆寫 input、本 worktree data 目錄或既有檔。實際營運資料 migration 仍須另行授權，不能把上例改成正式檔並宣稱已切換。
- 正常退出 0；有隔離項時輸出相容資料＋含完整原始 item 的 report 並退出 2；輸入／路徑錯誤退出 1。不得丟棄 report；此 migration 的 quarantine 仍是離線診斷 sidecar；AH-02 私有發布儲存層另見 `category-quality.md`。
- 純函式不注入當前時間，保留項目順序；同輸入重跑序列化結果一致，對已成功遷移輸出重跑不改資料。所有事實欄位逐值保留；僅新增 metadata、降級審核狀態與重算 counts。
- 缺證據時 verified 降為 needs_review，complete=false；官方來源標記需主 URL 與全部 evidence URL 都符合公司配對。原 validation 存入 `legacy_validation`，新 validation 的 scope=`retained_after_migration`，total/pass_rate 僅反映保留項；隔離數量與原件以 sidecar 為準，不保留與已降級項目矛盾的舊成功率。
- 回退資料使用未改動 input；不要反向推算缺欄位。程式回退以 AH-01 提交的 revert 在獨立分支驗證，保留 AH-00 規劃及之後每日資料；不得 reset/force-push。

## AH-02 metadata schema

`latest.schema.json` 新增 `_checked_at`（各分類含時區 ISO date-time）與 `_update_outcome`（各分類必填 attempt、serving，拒絕未知 enum／欄位）。兩者為 additive，舊封存可缺；AH-02 發布器總是輸出 outcome。跨欄位時間先後、無可靠資料不填 updated、no_change 不改 payload 由分類品質閘驗證；不靠 schema 單獨宣告發布合格。
