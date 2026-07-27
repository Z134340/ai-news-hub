---
name: trend-staging
description: 把移動平均、斜率、活躍日比率、來源廣度四組數字讀成一個階段判定（TrendAnalyst TR-6 專項）
---

# 階段定位

## 這個技能對應的失敗模式

**把「斜率為正」直接讀成「在成長」。** 斜率只說明線在往上。往上有四種完全不同的處境：一個剛冒出來的新主題(量小、比例衝很快)、一個已經有量還在加速的主流主題、一個高原上的日常震盪、以及一次單日爆發把回歸線硬拉正。這四者對 dashboard 讀者的意義完全不同。

第二個失敗模式：**每個主題都判 `accelerating`。** 六個 cluster 全部 `accelerating` 的 dashboard 等於沒有資訊。`plateau` 是預設值。

---

## 五個階段的白話定義

| stage | 白話一句 | 對讀者的意義 |
|---|---|---|
| `emerging` | 剛冒出來，量還小但在長 | 值得開始追，但還不用投資源 |
| `accelerating` | 已經有量而且還在長 | 這是本期真正在動的東西 |
| `plateau` | 有穩定的量但不再長 | 常態議題，維持既有關注即可 |
| `declining` | 量在退 | 熱度過了，可以降權 |
| `insufficient` | 觀測不足以下判斷 | 這一格不要相信，語料不夠 |

---

## 判定順序（必須照這個順序，不可跳步）

### 第 0 步：先過硬邊界

命中 TR-0(內容禁區)或 TR-7(注入)→ 直接 `insufficient`，**不進入以下任何一步**。

### 第 1 步：觀測夠不夠（TR-1）

看三個欄位：`moving_average.ma30.coverage`(≥ 0.6)、`moving_average.ma30.sufficient`(true)、`slope.sufficient`(true)。任一不過 → `insufficient`，結束。

**不要看 `window.continuity`。** 它的分母是日曆天，而本系統週末不抓取——實測 46 個缺日裡有 25 天是週末，continuity 有個約 0.71 的結構性天花板。拿它當否決條件等於把每一輪都判成 `insufficient`。它只在第 6 步當 confidence 的扣分因子。

這一步的關鍵是**分辨兩種「不夠」**：

- `ma30.truncated_by_corpus_start = true` → 語料本身就沒那麼長。這不是資料掉了，是系統還太年輕。rationale 要寫「語料起點晚於 30 天窗頭」。
- `truncated_by_corpus_start = false` 但 `coverage < 0.6` → 這段期間真的有觀測缺口。rationale 要寫「30 天窗內僅 N 天有觀測」。

寫錯會讓人去查一個不存在的管線故障。

### 第 2 步：算三個分數（TR-4／TR-2／TR-5）

先算分再選階段，**不要先想好階段再回頭湊分數**。

| 分數 | 主要欄位 | 回答的問題 |
|---|---|---|
| `signal_strength` | `slope.value_per_day`、`slope.r2`、`ma7 / ma30` | 現在是不是在往上，而且穩不穩 |
| `source_breadth` | `source_concentration.effective_sources` | 是很多家在講，還是一家在講 |
| `durability` | `ma30 / ma90` 比值、`totals.occurrences` | 三個月後還會有新內容嗎 |

三個分數各自對應一個獨立問題，**不要互相參照**。一個主題可以「很多家在講但量在退」(source_breadth 0.9、signal_strength 0.2)，這是完全合理的組合。

兩個容易踩的欄位陷阱：

- `source_breadth` 用的是**等效來源數**(`1 / HHI`)，不是 `distinct_sources`。後者被來源別名污染，實測有「9 個字串其實是同一家」的案例。
- `durability` 的主軸是 `ma30 / ma90`，不是 `active_day_rate`。本系統 `active_day_rate` 的分母是「實際有語料的天數」，六個 cluster 實測**全部等於 1**——一個把所有樣本都評成滿分的欄位無法排序，也就無法決策。它只當下修因子：`< 0.4` 下修一級，`≥ 0.9` 不加分。

### 第 3 步：定 `syndication_call`

見 `syndication-discrimination/SKILL.md`。判 `syndicated` 時記住：**stage 上限變成 `plateau`**。

### 第 4 步：照 TR-6 錨點表選階段

先檢查 `accelerating` 的五個條件是否**全部**成立。不全成立就往下找。找不到就是 `plateau`。

### 第 5 步：套否決條件覆核

四道否決，任一成立就把 `accelerating` 降下來：

```
effective_sources < 5.0   (TR-2)
durability      < 0.3     (TR-5)
syndication_call = syndicated (TR-3)
confidence      < 0.7
```

降到哪裡？降到「下一個成立的階段」，通常是 `plateau`；若 `ma7 < ma30` **且**斜率為負(兩者同時成立)則是 `declining`。**不要降到 `insufficient`**——觀測是夠的，只是不夠格叫加速。

### 第 5.5 步：檢查是不是全域收縮期（TR-6）

如果輸入中**所有** cluster 的 `ma30 / ma90` 都 < 1，代表整份語料的抓取量在收縮。這時：

- `ma7 > ma30 > ma90` 這個 `accelerating` 條件對誰都不會成立，**零個 `accelerating` 是正確結果**，不是判準壞掉，不要為了「至少要有一個亮點」而放寬。
- **但也不得把六個全判 `declining`。** 語料層收縮不等於每個主題都在退。只有自身 `ma7 < ma30` 且 `slope < 0` 兩者同時成立的才有資格叫 `declining`，其餘照樣是 `plateau`。

### 第 6 步：定 `confidence`

從 1.0 起扣：

| 情況 | 扣分後上限 |
|---|---|
| `window.continuity < 0.75` | 0.85 |
| `slope.r2 < 0.5` | 0.80 |
| `ma90` 為 null(無法看長期基準) | 0.75 |
| 任一 rationale 不可查證(TR-8) | 0.60 |

多項同時成立取**最低**的那個上限，不是相乘。

---

## `emerging` 與 `accelerating` 的區辨線

這是最常判錯的一對。區辨線是**有沒有量**，不是漲得快不快。

| | emerging | accelerating |
|---|---|---|
| ma7 / ma30 | ≥ 1.3 | ≥ 1.3 |
| ma90 | null、或 `ma30 / ma90` 明顯 > 1 但基數小 | 有值且 `ma30 / ma90` ≥ 1 |
| totals.occurrences | 通常 < 200 | 通常 ≥ 1000 |
| effective_sources | 可以窄(< 15) | 必須 ≥ 5，通常 ≥ 15 |
| 白話 | 從 0 變成 1，比值是無限大 | 從 5 變成 8，是真的多了 3 件 |

金融業類比：`emerging` 是一檔剛上市三個月、成交量從一百張變三百張的小型股；`accelerating` 是一檔成分股從月均一萬張變一萬五千張。**比例上前者漂亮得多，但後者才是真的有資金在進。**

---

## `plateau` 不是失敗

多數成熟主題本來就在高原上。`model_release_and_inference` 這種每週都有新聞的常態主題，正常狀態就是 `plateau` + 高 `durability` + 高 `source_breadth`。這組合對讀者的訊息是「這是背景常數，不需要特別注意」——這是有用的資訊，不是沒判出東西。

反過來說：如果某一輪你把六個 cluster 全判成 `accelerating`、全判成 `declining`、或全判成 `insufficient`，回頭檢查是不是判準被套鬆了或套死了。

**唯一的例外是全部 `plateau`**：在全域收縮期(TR-6)這是可能的正確答案，因為沒有任何一個 cluster 同時滿足 `ma7 < ma30` 與 `slope < 0`。這時不需要硬找一個判 `declining` 來湊出區辨度。

---

## rationale 的寫法

每一則必須引用**具體欄位值**，讓人能拿同一份 JSON 對。三句以內講完：現況(ma 與斜率)、廣度(等效來源數)、以及你選這個階段的關鍵理由。

可查證：
> 「ma7 3.2 對 ma30 1.9(比值 1.68)、斜率 +0.11 件/日 R² 0.61，等效來源 3.4，四項加速條件全過。」
> 「ma90 為 null(90 天窗零觀測)，無法確認長期基準，confidence 上限 0.75。」

不可查證(不要這樣寫)：
> 「這個主題正在快速升溫，預期下季度將成為市場焦點。」——含未來預測(TR-8 第 3 項)且無任何欄位引用。
