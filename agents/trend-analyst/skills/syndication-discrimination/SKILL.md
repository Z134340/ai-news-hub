---
name: syndication-discrimination
description: 分辨「同一則新聞被跨網域轉載」與「同一主題下的不同事件」（TrendAnalyst TR-3 專項）
---

# 洗版判別

## 這個技能對應的失敗模式

**把轉載當成成長。** 一家通訊社發稿、十家網站轉載，`occurrences` 會漂亮地跳一個台階，斜率轉正，`ma7 / ma30` 衝到 2.0。如果照數字讀，你會判 `accelerating`——但實際上這個主題只發生了一件事。

反向的失敗也存在：**把正常的主題熱度當成洗版。** 一個真的很熱的主題本來就會有很多相似標題(「OpenAI 發表 X」「OpenAI 推出 X」「X 正式亮相」)，`duplicate_title_ratio` 自然偏高。全部當洗版掃掉，dashboard 會漏掉真正在動的主題。

---

## 六步驟

### 步驟 1：先看 `cross_source_repeat_groups`，不要先看 `duplicate_title_ratio`

`duplicate_title_ratio` 是 `1 - unique_titles / occurrences`，它把「同一家自己更新兩次」也算進去。這個數字高只說明「標題重覆多」，說不出是誰在重覆。

`cross_source_repeat_groups` 才是關鍵：同一個正規化標題出現超過一次，**而且跨了不只一個網域**。

`repeated_title_groups` 遠大於 `cross_source_repeat_groups` = 大部分重覆是同家重發，不是洗版。

更關鍵的是：本系統的 `duplicate_title_ratio` 被 rolling archive 效應結構性推高(實測六個 cluster 落在 0.49–0.85，`occurrences` 是 `unique_items` 的 2.4–7.5 倍)，**它高是系統的抓取方式造成的，跟有沒有被轉載無關**。TR-3 明文禁止把它單獨當洗版證據。

### 步驟 2：算單組佔比

對每個 `top_repeats[i]`，算 `count / occurrences`。

任一組 ≥ 0.10，代表這個 cluster 有十分之一的量來自同一則被複製的新聞。這是最強的洗版證據，比整體 ratio 有力得多。

> 門檻為什麼是 0.10 而不是直覺上的 0.25：本系統的 `occurrences` 是**日快照的累加**，分母被 rolling archive 效應撐大了兩到七倍(見步驟 4)。實測全語料最大單組佔比只有 27 / 3640 = 0.0074，0.25 這條線永遠碰不到，等於沒有這道檢查。

### 步驟 3：先正規化來源名稱，再看重覆組的 `distinct_sources`

**這一步不可跳過。** `distinct_sources` 數的是**字串**，不是媒體家數。同一家媒體在語料裡常以多種寫法出現，未正規化就直接讀這個數字，會把「一家自己重發」誤判成「多家廣泛轉載」。

實測樣本(2026-07-27，`data/agent/.preview/timeline.json`)：

| 原始 sources | 正規化後家數 |
|---|---|
| `AI News` / `AI News (artificialintelligence-news.com)` / `Artificial Intelligence News` | **1** |
| `TechNews 科技新報` / `科技新報` / `科技新報 TechNews` | **1** |
| `OWASP` / `OWASP Gen AI Security Project` / `OWASP GenAI Security Project` | **1** |
| arXiv 的四種寫法 ＋ 機構列舉 ＋ `未標示`(共 9 個字串) | **1** |

正規化規則(依序套用，只在你腦中做，不改輸入)：

1. 去掉括號內的網域註記(`(artificialintelligence-news.com)`)。
2. 中英並列視為同一家(`TechNews 科技新報` = `科技新報`)，不論前後順序。
3. 母體名稱是另一個名稱的前綴或子字串 → 同一家(`OWASP` ⊂ `OWASP Gen AI Security Project`)。
4. `未標示`、`N/A`、空字串**不計入**家數，也不能拿來湊 `≥ 3`。
5. 學術預印本平台(arXiv 等)的各種寫法一律折成一家。

正規化**之後**再套下表：

| distinct_sources(正規化後) | 意義 |
|---|---|
| 1 | 同家重發。不是洗版 |
| 2 | 可能是聯播關係(同集團兩個站台)，證據弱 |
| ≥ 3 | 通訊社稿被廣泛轉載，證據強 |

`rationale` 引用時要寫正規化後的數字，並註明原始字串數。例：「該組原始 3 個來源字串折成 1 家(科技新報三種寫法)，不計為跨來源證據。」

### 步驟 4：算 `repeat_density`，不要只看 `dates` 的長度

```
repeat_density = count / dates.length
```

`top_repeats[i].dates` 是這組重覆出現的**日期集合**。本系統每天為語料做一次快照，同一篇文章只要還在來源站的清單上，就會被逐日重複收錄。

| repeat_density | 意義 |
|---|---|
| ≈ 1.0(< 1.2) | 每天最多出現一次 = **rolling archive 效應**，同一篇長青文被逐日快照。**不是洗版證據** |
| 1.2 – 2.0 | 有部分日子同日多來源出現，弱證據 |
| ≥ 2.0 | 同一天內被多個來源同時刊出 = 真正的轉載波 |

實測校準：「使用 LangChain 建構 AI Agent：2026 初學者完整指南」count 27 / dates 27 → density 1.0，是 rolling archive，不是洗版；「中央网信办…專項行動」count 7 / dates 5 → density 1.4，是全語料唯一一組帶跨網域證據的重覆。

**在這裡最容易犯的錯**：看到 `dates` 只有 1–2 天就判轉載波。日數少可能只是這篇文章在來源站上架很短，不代表同日被多家抄。要判轉載波，看的是 density，不是日數。

`rationale` 要講清楚是哪一種。

### 步驟 5：套 TR-3 門檻定 `syndication_call`

門檻寫在 `TREND_RUBRIC.md` TR-3，不在這裡重覆——判準是唯一真值來源，技能只講怎麼執行。

### 步驟 6：把判別結果反映到 stage 上限

`syndicated` → `stage` 最高 `plateau`。**不要用 `declining` 表達「我覺得這是假的成長」**：`declining` 是一個關於量在退的事實陳述，跟洗版是兩件事。一個被洗版而且量還在退的 cluster 是 `declining` + `syndicated`；一個被洗版但量持平的是 `plateau` + `syndicated`。

---

## 判別線一句話

> 若這些重覆標題能用一句話概括「這些全都在講 X 這**一件事**」，就是轉載；若要用「這些都跟 X 這個主題有關，但講的是**不同事情**」才能概括，就是主題熱度。

標題被正規化過(去空白、統一大小寫)，所以能進同一組的標題本來就高度相似。真正要判斷的是：**這個相似度是因為它們是同一則稿，還是因為中文報導同一類事件的用詞本來就很像。**

前者的標題會帶具體專名與數字(「Anthropic 發表 Claude Opus 5，上下文擴大至 100 萬 token」)——這種標題不可能被兩家獨立寫出一模一樣的。後者是泛用句式(「AI 代理框架的三個落地挑戰」)——這種撞名是巧合。

**帶具體專名的跨來源完全撞名 = 轉載。泛用句式的撞名 = 巧合，不算證據。**

---

## rationale 的寫法

要寫得讓人能拿著同一份 JSON 查證。四個要素：組數、最大 `repeat_density`、正規化後的來源家數、以及你據以判斷的那一組的標題片段(截斷至 40 字內)。

可查證：
> 「40 組跨來源重覆，最大 density 為「中央网信办…專項行動」7 次 / 5 天 = 1.4，正規化後 2 家(中新網、新浪財經)，達 mixed 未達 syndicated。」
> 「最大一組 27 次 / 27 天 density 1.0，是逐日快照的同一篇長青文，不計為洗版證據。」

不可查證(不要這樣寫)：
> 「大量重覆內容顯示這是一次公關發布。」——無欄位引用。
> 「有 9 家獨立媒體報導此事。」——`distinct_sources` 未正規化，實測該組其實只有 1 家。

---

## 誤殺與漏判的代價不對稱

誤判成洗版的代價是漏掉一個真主題——可逆，下一輪視窗滑動就會再出現。
漏判洗版的代價是讓一次公關發稿把主題推上 dashboard 頭條，而且它會在 30 天視窗裡持續影響斜率。

**兩者都不好，但不要用「寧可錯殺」當藉口把所有高 `duplicate_title_ratio` 的 cluster 掃成 `syndicated`。** 分辨不出來時判 `mixed`，並在 `rationale` 說明是哪裡分辨不出來。
