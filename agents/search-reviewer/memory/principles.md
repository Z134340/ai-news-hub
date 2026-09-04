# SearchReviewer 判斷原則

- `principles_version`: 1.0.0
- 最後更新：2026-09-05
- 證據基礎：`ai-news-hub/data/agent/.preview/search-review-input.json`
  (`schema: search-review-input-v0.1`、`window_days` 14、`metrics.dates` 只有 `2026-09-04` 一晚、
   十個分類、`canaries.weekly_cap` 3、`proposals.pending_review` 3)

這三條不是抽象格言，每一條都對應第一份真實輸入裡看得到的狀態。與判準衝突時以判準為準；判準沒寫到的灰區，照這裡的方向判。

---

## 原則 1：一晚的數字不是趨勢，是快照

`metrics-history.jsonl` 在 2026-09-04 才開始累積，第一份輸入只有 1 晚。那一晚 `papers` 的 `verified_rate` 是 1.0、`priority_hit_rate` 0.941、`validation_pass_rate` 96.15——看起來很好，但一晚的 1.0 和一晚的 0.6 同樣不能拿來提案：沒有對照晚，就分不出「query 壞了」和「那晚某個大站掛了」。

SR-1 的 3 晚門檻是這條原則的判準化。**這條門檻預期在累積 ≥ 14 晚後重校**：屆時要用實際分佈驗 SR-4 的「低於中位數 0.15」是否會讓十個分類全部通過或全部不過(同 trend-analyst 原則 1：一個把所有樣本評成同一級的尺是壞掉的)。

## 原則 2：積壓不是你的問題，但再提就是

第一份輸入的 `proposals.pending_review` 已經是 3，等於 `canaries.weekly_cap`。這 3 筆來自 Phase 1 的 `harvest-precedents.mjs`，還沒有人審。此時再提任何提案，只會讓人審隊伍更長，而且最新的提案永遠排在最後——等於白提。

SR-3 的積壓條款是這條原則的判準化。空 `proposals` 加上 `no_change` 列滿十個分類，就是正確輸出。

## 原則 3：空的 PRIORITY 區段是設計，不是缺漏

`techtrends`、`governance`、`tutorials`、`courses` 四個分類的 `priority_lines` 是 0(marker 存在，區段為空)。這是 Phase 0 加 marker 時的刻意狀態：這四個分類靠 `assets/js/config.js` 的 `PRIORITY_KEYWORDS` 全域關鍵字，不用分類專屬的 PRIORITY 區段。

`build-search-review-input.mjs` 的 T-3 一度因為把空字串當成「沒有 marker」而失敗——同一個誤判，程式會犯，你也會。SR-6 是這條原則的判準化：`priority_lines: 0` 不是提案理由；`search_queries_lines: 0` 才是異常。
