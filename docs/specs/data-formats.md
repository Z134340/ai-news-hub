<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

## data/latest.json 格式

```json
{
  "date": "YYYY-MM-DD",
  "time": "ISO 8601 (Asia/Taipei)",
  "generated_at": "07:48",
  "source": "local",
  "data": { "papers":[], "topnews":[], "taiwan":[], "china":[], "usa":[], "techtrends":[], "governance":[], "tutorials":[], "courses":[], "models":[] },
  "stats": { "papers":0, "topnews":0, "taiwan":0, "china":0, "usa":0, "techtrends":0, "governance":0, "tutorials":0, "courses":0, "models":0 },
  "_updated_at": { "papers":"ISO 8601", "topnews":"ISO 8601", ... },
  "validation": { "total":0, "verified":0, "warnings":0, "removed":0, "pass_rate":"95%" }
}
```

`_updated_at` 欄位為各類別最後一次成功擷取的時間戳。非週一時，每週類別 (models/tutorials/courses) 的時間戳保留自上一次週一擷取。

## data/health.json 格式

```json
{
  "last_run": "ISO 8601",
  "last_success": "ISO 8601",
  "last_date": "YYYY-MM-DD",
  "source": "local",
  "status": "ok|partial|failed|missed|not_run",
  "categories_ok": 7,
  "categories_failed": 0,
  "validation_pass_rate": "95%",
  "consecutive_failures": 0,
  "last_missed": null,
  "errors": [],
  "power_source": "ac|battery"
}
```

`power_source`（S-PWR，2026-09-05）：`run-daily.sh` 啟動時以 `pmset -g batt` 第一行是否含 `AC Power` 判定，只放 `ac`／`battery` 兩值，不放電量。電池模式時 `errors` 會多一筆「電池模式執行（合蓋週期睡眠），N 類別回退」（N 為 `categories_failed`）。`errors` 排序：配額備註在前、電池備註在後。

---

