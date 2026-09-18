---
name: official-ai-ecosystem-research
description: Research first-party announcements from major LLM and multimodal AI companies, classify them as 官方資訊 or 模型快訊, verify dates and claims, deduplicate events, and produce structured Traditional Chinese research. Use for AI News Hub enterprise-ecosystem research or source review, not general media aggregation.
---

# 官方 AI 生態系調研

以官方一手來源建立可追溯的「企業生態系」研究資料，分為「官方資訊」與「模型快訊」。本 Skill 產出研究封包，不自行修改網站、正式資料、排程或發布狀態；只有使用者另行授權實作時才進入專案變更。

開始前依任務需要讀取：

- 查公司與官方入口時，讀 [references/sources.md](references/sources.md)；機器可讀名單在 `references/official-sources.json`。
- 分類或產出 JSON 時，讀 [references/item-contract.md](references/item-contract.md)。

## 調研流程

1. 確認時間範圍。未指定時，「官方資訊」查近 30 天，「模型快訊」查近 90 天；使用者問最新或目前狀態時必須即時瀏覽。
2. 從 `official-sources.json` 的官方入口探索候選；搜尋只能協助找到官方頁，不能把搜尋摘要當作最終證據。
3. 開啟每個候選的正式文章或文件，逐項核對原文標題、發布日期、公司、Canonical URL、發布狀態與可用性。找不到明確日期或直接連結就不收。
4. 模型事件另找 Model Card、System Card、技術報告、API 文件或官方模型庫頁面。只有官方明示的參數、Context Window、價格、授權與 Benchmark 才能寫入。
5. 依事件本體分類：具名模型的新家族、主要版本或實質能力升級歸「模型快訊」；產品、API、價格、合作、地區開放、安全政策與企業策略歸「官方資訊」。雲端平台上架第三方模型屬「官方資訊」。
6. 以 Canonical URL 為主鍵去重。模型發布保留在「模型快訊」；區域新聞或平台上架只保留不同事件角度，不複製原模型發布。
7. 以繁體中文撰寫摘要與分析，原文標題、公司、模型、產品和 Benchmark 名稱保留原文。把「官方公布」與「本站分析」分開；官方沒說的值使用 `null`，不要推測。
8. Benchmark 一律標為 `official_self_reported`，並保留測試名稱、數值、比較範圍與證據網址。不同版本、提示、工具或推理預算的數字不可直接宣稱全面勝出。
9. 輸出 `ecosystem-research-v1` JSON 後，從專案根目錄執行：

   ```bash
   python3 skills/official-ai-ecosystem-research/scripts/validate_items.py /path/to/research.json
   ```

10. 驗證器只檢查結構、官方網域、日期、排序與去重；仍須人工或瀏覽工具確認標題、日期和內容確實與原頁一致。

## 停止條件

- 官方頁無法證實名稱、日期或主張時，移除該筆，不用媒體報導補成已確認。
- Preview、Beta、GA、Open Weight 與 Deprecated 必須照官方狀態標示，不把預告寫成已全面推出。
- 使用者用假設模型名稱舉例時，只當版型案例；找到官方正式發布頁前不得建成新聞。
- 不執行正式擷取、覆寫 `data/`、修改 prompt、提交、推送或部署，除非本次請求另外明確授權。
