---
name: evidence-reconciliation
description: 把提案 evidence[] 的數字與 metrics_window.by_category 逐則對帳（ChangeEvaluator CE-1 專項）
---

# 證據對帳

## 這個技能對應的失敗模式

**證據有數字但數字是編的。** 上游 SR-8 只要求 evidence 含數字。模型在總結時常把「0.71」寫成「0.7」、
把 9/03 的值標成 9/04，甚至把別的分類的數字搬過來。你是唯一手上同時有提案與指標的人。

## 對帳步驟

1. 取提案的 `category`，找 `metrics_window.by_category[category]`；找不到 → CE-1 不過。
2. 每一則 evidence 抽出「指標名 + 數值」，指標名只認 `verified_rate`、`priority_hit_rate`、`needs_review`、
   `validation_pass_rate`、`human_rating_score`、`items`。
3. 在該分類的列裡找同指標、數值相等（四捨五入到小數第三位）的任一晚。evidence 若有寫日期，日期也要相符。
4. 至少一則對得上才過；對得上的那則寫進 `reasons_zh`（「evidence 第 1 則 verified_rate 0.941 與 2026-09-04 一致」）。

## 不要做的事

- 不要用「差不多」放行。0.71 與 0.7 是四捨五入內；0.71 與 0.65 不是。
- 不要替上游補算。evidence 寫「平均 0.8」而窗內沒有這個數，你不去算平均，直接不過。
- 不要因為 `metrics_window.dates` 很多晚就放寬；晚數多只是對帳機會多。
