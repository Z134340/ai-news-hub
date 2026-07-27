# TrendAnalyst 判斷原則

- `principles_version`: 1.0.0
- 最後更新：2026-07-27
- 證據基礎：`ai-news-hub/data/agent/.preview/timeline.json`
  （`metrics_schema: trend-metrics-v0.1`、`generated_at` 2026-07-27T03:23:54.331Z、
   window 2026-04-04 → 2026-07-26、68 觀測日 / 114 日曆日、
   `continuity` 0.5965、`ma30.coverage` 0.6667、六個 cluster）

這五條不是抽象格言，每一條都是拿上面那份真實語料驗算出來、並且已經改寫進 `TREND_RUBRIC.md` 1.1.0 的東西。與判準衝突時以判準為準；但判準沒寫到的灰區，照這裡的方向判。

---

## 原則 1：一個把所有樣本都評成滿分的尺度，不是嚴格，是壞掉

`TREND_RUBRIC.md` 1.0.0 的四組門檻在真實語料上**同時飽和**：

| 判準 | 1.0.0 門檻 | 真實語料 | 後果 |
|---|---|---|---|
| TR-1 | `continuity ≥ 0.6` | 0.5965（差 0.0035） | 六個全判 `insufficient` |
| TR-2 | `effective_sources ≥ 4.0` 頂格 | 13.37 – 75.76 | 六個全頂格 |
| TR-3 | `cross_source_repeat_groups ≥ 3` 且 `duplicate_title_ratio ≥ 0.35` | 5–70、0.49–0.85 | 六個全判 `syndicated` |
| TR-5 | `active_day_rate ≥ 0.7` 頂格 | 全部 = 1 | 六個全頂格 |

一個尺度若無法排序，就無法決策。看到自己給出的六個判讀完全一樣時，先懷疑尺，不要先懷疑世界。

（同源原則見 `Hermes-Agent/curator/memory/principles.md` 原則 2。兩個代理人在不同語料上各自撞到同一個坑。）

## 原則 2：語料層的收縮，不等於主題層的衰退

六個 cluster 的 `ma30 / ma90` **全部 < 1**（0.627 / 0.635 / 0.695 / 0.735 / 0.801 / 0.921）。

這個「同向」本身就是訊號的來源在哪裡的證據：六個主題不會恰好在同一個月一起退燒，會一起降的只有**抓取量**。所以：

- 這種期間 `accelerating` 是空集合，是正確答案。
- 但**不得**因此把六個都判 `declining`。`declining` 是關於單一主題的事實陳述，門檻是自身 `ma7 < ma30` **且** `slope < 0` 兩者同時成立。實測只有 `developer_tooling_rag`（32.71 < 35.20、slope −0.4378）與 `ai_learning_and_enablement`（20.43 < 21.35、slope −0.3684）夠格。

金融業類比：整個大盤成交量萎縮時，不能說「所有個股都在下跌」。要判個股走弱，看的是個股自己的量價，不是大盤。

## 原則 3：`count == dates.length` 是 rolling archive 的指紋，不是洗版

本系統每天為語料做一次快照，同一篇文章只要還在來源站清單上就會被逐日重複收錄。結果是 `occurrences` 為 `unique_items` 的 2.4–7.5 倍，`duplicate_title_ratio` 被結構性推高到 0.49–0.85——**跟有沒有被轉載完全無關**。

判別指紋是 `repeat_density = count / dates.length`：

- 「使用 LangChain 建構 AI Agent：2026 初學者完整指南」27 次 / 27 天 → density 1.0，rolling archive。
- iThome 四則長青文各 53 次 / 53 天 → density 1.0，同一家、同一篇，逐日快照。
- 「中央网信办…專項行動」7 次 / 5 天 → density 1.4，**全語料唯一**一組帶跨網域證據的重覆。

density ≈ 1.0 一律不計為洗版證據，不論 count 有多大。

## 原則 4：`distinct_sources` 數的是字串，不是媒體家數

實測四組別名污染：`AI News` 三種寫法、`科技新報` 三種寫法、`OWASP` 三種寫法、arXiv 九種寫法（含 `未標示`）折起來都只是一家。有一組 `distinct_sources = 9`，正規化後是 **1**。

所以：

- 判洗版時，`distinct_sources ≥ 3` 這條線必須先正規化再套（步驟見 `skills/syndication-discrimination/SKILL.md` 步驟 3）。
- `rationale` 裡**永遠不要**寫「有 N 家獨立媒體報導」這種絕對陳述。要寫相對排序：「等效來源 43.1，六個主題中排第三」。
- `max_title_repeat` 六個 cluster 恆等於 53（來源是四則命中全部六個主題詞庫的長青文），per-cluster 資訊量為零，**任何情況下不得寫進 rationale**。

## 原則 5：週末不抓取是設計，不是故障

`window.continuity` 的分母是日曆天。46 個缺日中有 25 天是週末，這給了 continuity 一個約 0.71 的結構性天花板。

拿它當否決條件，等於拿「一年 365 天裡有幾天開盤」當資料品質指標——答案永遠是 0.66 左右，因為週末本來就休市。所以 1.1.0 把它降級為 confidence 的扣分因子（< 0.75 時上限 0.85），觀測充足性改看 `ma30.coverage`（實測 0.6667，過線）。

推論：看到缺日時，先分辨是「週末」還是「平日缺口」再寫 rationale。寫錯會讓人去查一個不存在的管線故障。
