---
name: proposal-scoping
description: 決定一筆提案的落點(target_files)、粒度(一個 region 一件事)、配額與風險標記(SearchReviewer SR-2、SR-3、SR-5 專項)
---

# 提案範圍

## 這個技能對應的失敗模式

**提案指向允許清單以外的檔案。** 「verified 率低是因為 `validate.py` 的日期上限太嚴」也許是對的，但 `validate.py` 不在你的允許清單，閘1 會整筆丟掉，而且這種提案一旦被放行，Phase 3 的自動套用就多了一個可改寫的檔案。你的允許清單只有三種目標，不在清單裡的問題寫進 `notes_zh` 給人看，不提案。

第二個失敗模式：**一筆提案改五處。** canary 三晚只能驗「這一個改動有沒有讓指標掉 10 個百分點」；五處一起改，掉了也不知道回滾哪一處。

---

## 落點對照(SR-2)

| 要改什麼 | `region` | `target_files`(唯一合法值) | 允許的 `change_type` |
|---|---|---|---|
| 某分類的搜尋 query | `SEARCH_QUERIES` | `scripts/prompts/<cat>.md` | `add_query`、`drop_query`、`rephrase_query` |
| 某分類的優先主題描述 | `PRIORITY` | `scripts/prompts/<cat>.md` | `add_query`(填入描述)、`rephrase_query` |
| 全域優先關鍵字 | `PRIORITY_KEYWORDS` | `assets/js/config.js` | `add_keyword`、`drop_keyword` |
| Tier B 可信網域 | `TIER_B_DOMAINS` | `scripts/tier-b-domains.json` | 只有 `add_domain` |

`<cat>` 必須是輸入 `prompt_regions` 裡 `present: true` 的鍵。不要猜檔名。

---

## 配額(SR-3)

```
可提上限 = min(canaries.weekly_cap - proposals.pending_review, 候選分類數)
每分類   ≤ canaries.per_category_cap
canaries.present == false → 上限 0
```

候選超過上限時，依「持續晚數 × 偏離中位數幅度」排序，只留前幾筆；其餘進 `no_change`，`notes_zh` 註明「本輪配額已滿，<cat> 下輪再看」。

---

## 風險與粒度(SR-5)

| `change_type` | `risk` | 額外門檻 |
|---|---|---|
| `add_query`、`add_keyword`、`add_domain` | `low` | `add_domain` 需該 hostname 在 `human_ratings.by_source_domain` 且 `count ≥ 5`、`score ≥ 0.6` |
| `rephrase_query`、`drop_query`、`drop_keyword` | `medium` | 持續門檻升為 3 晚；`drop_keyword` 需 `priority_hit_rate` 連續 3 晚 ≥ 0.95 |

一個分類同時有 `SEARCH_QUERIES` 與 `PRIORITY` 的問題 → 只提證據較強的一處。

---

## `patch` 契約(apply-change.mjs 唯一讀的改檔依據)

`summary_zh` 是給人看的，`patch` 是給機器套的；兩者都要有，缺 `patch` 的提案只會停在 `evaluated`、不改檔、不占配額。形狀依 `change_type` 固定：

| `change_type` | `patch` 形狀 | 字串規則 |
|---|---|---|
| `add_query` | `{"add": "- <一整行 query>"}` | 單行 ≤ 300 字；照輸入區段的行格式(通常以 `- ` 起頭)；不含 URL、不含 `<!--`／`-->` |
| `drop_query` | `{"remove": "<原行>"}` | `remove` 必須與輸入 `prompt_regions.<cat>.SEARCH_QUERIES` 的某一行**逐字相同**(含 `- ` 與尾端年份) |
| `rephrase_query` | `{"replace": {"from": "<原行>", "to": "<新行>"}}` | `from` 同 `drop_query` 的逐字規則；`to` 同 `add_query`；`from` ≠ `to` |
| `add_keyword` | `{"add": "<關鍵字>", "list": "latin｜cjk｜cjkPatterns"}` | ≤ 80 字；不含引號、反斜線、反引號、`$`；`list` 省略＝`latin`，CJK 關鍵字必須標 `cjk` |
| `drop_keyword` | `{"remove": "<關鍵字>", "list": ...}` | 同上；`remove` 必須與輸入 `priority_keywords.<list>` 內某一項逐字相同 |
| `add_domain` | `{"add": "example.com"}` | 小寫主機名，不帶 `https://`、路徑或萬用字元 |

不要把 diff 語法(`+`／`-` 前綴、`@@`)寫進 `patch`；不要在 `patch` 裡塞第二個改動——一筆提案只改一行，要改兩行就是兩筆提案(各吃一個配額)。

## 從 `emerging_candidates` 起草 `add_query`（L-6）

`emerging_candidates` 是探索管線從外部 RSS 抓到、與近期語料不相似的標題，經去標題後只剩 `topic_terms` 詞袋、`source_domain`、`category`、`tier`、`novelty`。它只回答「這分類最近冒出了什麼主題」，**不回答「要不要改」**——要不要改仍由 SR-4 決定。步驟：

1. 先確認該 `category` 已通過 SR-4（持續、孤立、非回補）。沒通過就停，候選再多也不提。
2. 只看 `category` 相同、`tier` 為 A 或 B、`novelty ≥ novelty_threshold` 的 items；至少 2 筆共用同一個或同一組 `topic_terms` 才算主題，單筆孤例不算。
3. 用共用的主題詞加上該分類慣用的來源詞（arXiv、OpenReview、GitHub 等）組成**一整行**新 query，年份照 SEARCH_QUERIES 既有慣例補在句尾。不要把某筆 `topic_terms` 整串照抄（那等於把標題還原成 query）。
4. `evidence` 兩則以上：一則是 SR-4 的指標數字，一則寫 `emerging_candidates.items[i..j]` 的索引、`novelty`、`tier` 與共用詞，例如「items[0..2] papers/arxiv.org tier A novelty ≥ 0.92 共用 pass@k／rollout／evaluation」。
5. `region` 固定 `SEARCH_QUERIES`、`change_type` 為 `add_query`、`risk` 為 `low`、`patch` 為 `{"add": "- <整行 query>"}`；不寫 `list`。同分類若已有 drop／rephrase 提案，add_query 要另占一個配額，先看 SR-3 剩多少。

`emerging_candidates.available` 為 `false` 或 `items` 為空時，本節整段不適用，照舊只用指標判斷。

## `summary_zh` 怎麼寫

40 字內，格式固定：「<cat> 的 <region> <動作> <對象>」。例如：「papers 的 SEARCH_QUERIES 改寫第 3 條 query，收窄到 arXiv 與 OpenReview」。不寫理由(理由在 `evidence`)，不寫 diff(實際改動寫在 `patch` 欄位，`summary_zh` 只用中文講一次)。
