<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

## data/latest.json 格式

```json
{
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

`_updated_at` 欄位為各類別最後一次成功擷取的時間戳。非週一時，每週類別 (tutorials/courses) 的時間戳保留自上一次週一擷取。`official_info` 與 `models` 每日更新並各自累積 30／90 天。

`data/skills.json` 為 `{items, _updated_at, source}`；items 欄位見分類規範。首頁載入時會讀取這份當前榜單，下一次每日合併也會把它寫進 `latest.data.skills`。歷史快照沒有 `skills`，或舊封存沒有 `official_info` 時，前端須視為空陣列，不得中斷載入。

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
