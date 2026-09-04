---
name: reversibility-check
description: 檢查 rollback 是否成立、是否與 canary 中提案衝突、medium 風險是否有兩晚證據（ChangeEvaluator CE-2、CE-3、CE-4 專項）
---

# 可逆性、衝突與風險門檻

## 這個技能對應的失敗模式

**放行了一個回不去的變更。** canary 三晚只能告訴你「指標掉了」，回滾靠的是 `rollback` 欄與
apply-change 的快照。`rollback` 空、或寫成「重跑一次」，掉了就沒人知道怎麼還原。

第二個失敗模式：**同分類兩個變更同時在 canary。** 指標掉了不知道回滾哪一個，只能兩個都退。

## CE-2 rollback 對照

| `change_type` | 合法的 rollback 內容 |
|---|---|
| `add_query`、`add_keyword`、`add_domain` | 移除新增的那一行／那一項 |
| `drop_query`、`drop_keyword`、`rephrase_query` | 還原 apply-change 套用前的區段快照 |

`rollback_source` 為 `derived` 表示由 builder 依 change_type 產生，視同合法；為 `upstream` 則逐字檢查是否對應。

## CE-3 衝突與配額

- `canaries_in_flight[]` 任一項 `category` 與本提案相同 → 不過。
- `quota.remaining` 為 0 → 不過；本輪 accept 數達 `quota.remaining` → 之後不過。
- 同分類本輪已 accept 一筆且 `quota.per_category_cap` 為 1 → 不過。

## CE-4 medium 風險兩晚

`risk: medium` → evidence 至少引用兩個不同日期，皆在 `metrics_window.dates` 內，且指標方向一致
（例如兩晚 `priority_hit_rate` 都低於其他分類）。只有一晚 → 不過，理由寫「只有 YYYY-MM-DD 一晚」。
