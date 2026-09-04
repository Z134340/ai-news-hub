---
name: metric-attribution
description: 把某分類的指標惡化歸因到「搜尋策略本身」或「上游／當晚環境」，只有前者才提案(SearchReviewer SR-1、SR-4 專項)
---

# 指標歸因

## 這個技能對應的失敗模式

**看到一個分類的 `verified_rate` 掉了就提案改 query。** 掉的原因至少有四種：query 抓到不對的來源(策略問題)、那晚某個大站不可達(環境問題)、`validate.py` 的日期上限把一批當日文章判成過期(管線問題)、或那晚是 `backfill` 補跑歷史(不是常態抓取)。四者裡只有第一種輪到你，而且第一種的特徵是**只有這個分類掉、而且連續掉**。

第二個失敗模式：**拿一晚的數字說話。** 單晚沒有對照組。

---

## 三步判定

| 步驟 | 看什麼 | 過不了時 |
|---|---|---|
| 1. 夠不夠晚 | `metrics.dates.length ≥ 3`，且該分類 `by_category.<cat>.length ≥ 3` | 停，`no_change`(SR-1) |
| 2. 持不持續 | 最近 2 晚(`drop_*` / `rephrase_query` 要 3 晚)該分類指標都比自身窗內中位數低 0.15 以上 | 停，`no_change`(SR-4 持續) |
| 3. 孤不孤立 | 同 2 晚，≥ 6 個其他分類同一指標**沒有**同向惡化；且該分類這 2 晚 `backfill == 0` | 停，`no_change` + `notes_zh` 寫「疑似上游／回補」(SR-4 孤立／非回補) |

三步都過 → 交給 `proposal-scoping` 決定落點與粒度。

---

## 指標對應哪種策略問題

| 惡化的指標 | 通常指向 | 對應 `region` |
|---|---|---|
| `verified_rate` 低、`needs_review` 高 | query 抓到來源不明或日期不對的文章 | `SEARCH_QUERIES`(`rephrase_query` 或 `drop_query`) |
| `priority_hit_rate` 低 | 抓回來的東西不是優先主題 | `PRIORITY`(該分類有區段時)或 `PRIORITY_KEYWORDS` |
| `title_low_match` 高 | query 太寬，標題與分類主題對不上 | `SEARCH_QUERIES` |
| `validation_pass_rate` 低但 `verified_rate` 正常 | 通常是格式／日期欄位問題，不是策略 | 不提，`notes_zh` |
| `human_rating_score` 低(`count ≥ 5`) | 人覺得內容不對味 | 只作輔助證據，不單獨支撐提案 |

`items` 單晚為 0 = 那晚沒跑，不計入任何判定。
