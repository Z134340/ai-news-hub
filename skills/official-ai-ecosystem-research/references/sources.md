# 官方來源與使用方式

`official-sources.json` 是第一階段來源名單的唯一機器可讀版本。本檔只說明使用規則，不另外維護一份網址副本。

## 來源層級

1. **正式發布頁**：公司官網上的模型、產品或政策公告，作為 `source_url`。
2. **官方技術證據**：Model Card、System Card、技術報告、API 文件、官方 Changelog，用於核對能力、限制、價格與可用性。
3. **官方模型庫或程式庫**：用於核對權重、授權與版本；若只有第三方平台頁，必須確認頁面屬於公司的官方帳號。
4. **媒體、排行榜與社群**：只用來發現候選或補充外部觀點，不能成為本分類的 `source_url`，也不能單獨證明發布事實。

## 第一階段範圍

核心模型公司包含 OpenAI、Anthropic、Google DeepMind、Meta AI、Microsoft、NVIDIA、Mistral AI、xAI、Cohere、Qwen、DeepSeek 與 Stability AI。AWS、Google Cloud、Microsoft Azure／Foundry、Hugging Face 等平台事件可歸「官方資訊」，但第三方模型的原始發布仍以模型開發公司為主來源。

來源頁可能改版或轉址。每次使用前開啟 `discovery_url`；若網域、公司歸屬或官方身分改變，先提出名單修訂，不在研究輸出中偷偷替換來源。

## 搜尋策略

- 先看公司官方入口，再用 `site:<official-domain>` 搜尋模型名稱、`release`、`launch`、`model card`、`system card`、`API`、`pricing`、`availability`。
- 新聞列表頁只用於找候選；研究項目的 URL 要指向單篇正式文章或官方文件。
- 同一事件有公告、Model Card 與 API 文件時，以公告為 `source_url`，其餘放入 `evidence_urls`。
- URL 移除純追蹤參數後再去重；不要改寫無法確認的路徑。

## 官方說法與分析

- `summary` 僅整理官方可證實內容。
- `analysis` 可解釋企業影響、適用情境與限制，但不得把推論寫成官方結論。
- 官方 Benchmark 使用「官方自報」標籤；需要跨模型比較時，另找同條件的獨立評測並明確標成外部證據。
