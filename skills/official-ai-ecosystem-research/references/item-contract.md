# 研究封包契約

輸出為單一 JSON 物件，`schema_version` 固定為 `ecosystem-research-v1`，兩類陣列皆按日期新到舊排序。

```json
{
  "schema_version": "ecosystem-research-v1",
  "generated_at": "2026-09-19T01:00:00+08:00",
  "window": {"official_info_days": 30, "model_news_days": 90},
  "official_info": [],
  "model_news": []
}
```

## `official_info` 欄位

必填：

- `title`：官方原文標題，不能翻譯或改寫。
- `company`、`date`、`event_type`、`summary`、`highlights`、`analysis`。
- `source_url`：單篇官方正式文章或文件。
- `evidence_urls`：其他官方證據，可為空陣列。

`event_type` 只能是 `product`、`api`、`pricing`、`partnership`、`availability`、`safety`、`policy`、`company` 或 `platform`。

## `model_news` 欄位

必填：

- `model_name`、`version`、`company`、`release_date`、`release_status`。
- `modalities`、`domain`、`summary`、`capabilities`、`access_channels`。
- `context_window`、`pricing`、`license`；官方未公布時使用 `null`。
- `benchmarks`、`limitations`、`analysis`、`source_url`、`evidence_urls`。

`release_status` 只能是 `preview`、`beta`、`ga`、`open_weight`、`research`、`updated` 或 `deprecated`。若同時 GA 與 Open Weight，以公告主要狀態填 `release_status`，其他狀態寫入 `access_channels` 或 `highlights`，不要自行組合新 enum。

每個 Benchmark 物件包含：

```json
{
  "name": "SWE-bench Verified",
  "result": "72.5%",
  "scope": "官方公告所述測試設定",
  "attribution": "official_self_reported",
  "source_url": "https://official.example/model-release"
}
```

## 分類判例

| 事件 | 分類 |
|---|---|
| 公司推出具名新模型或主要版本 | `model_news` |
| 現有模型新增實質模態、推理或 Agent 能力 | `model_news` |
| 純 API 參數、價格、區域或配額調整 | `official_info` |
| 雲端平台上架第三方模型 | `official_info` |
| 模型公司發布合作、投資或治理政策 | `official_info` |
| 模型發布同日附帶的 Model Card／System Card | 同一筆 `model_news` 的證據，不另建新聞 |

同一 `source_url` 不得同時出現在兩類。相同事件若有多篇官方文件，保留一筆並把其他網址放入 `evidence_urls`。
