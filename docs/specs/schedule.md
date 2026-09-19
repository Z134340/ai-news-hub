<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

## 時區與排程（每日 + 每週分類排程）

| 項目 | 時間 |
|------|------|
| macOS 喚醒 | 09:55 |
| 擷取排程 | 10:00 |
| 預期完成 | ~11:15（正常）/ ~11:40（偶爾逾時）|
| 你查看 | **中午 11:30 後 / 隔天** |

| 項目 | 設定 |
|------|------|
| 時區 | Asia/Taipei (UTC+8) |
| 健康檢查 | 12:17（GitHub Actions；UTC 04:17） |
| 保活 | 每月 1 號 |

### 每日 vs 每週分類排程（DOW-based）

依星期幾（`date +%u`）決定擷取範圍：

| 類型 | 分類 | 頻率 |
|------|------|------|
| 每日 | papers, topnews, taiwan, china, usa, techtrends, governance, official_info, models | 每天透過搜尋擷取 |
| 每日 | skills | 每天透過 GitHub REST API 更新星數與維護狀態 |
| 每週 | tutorials, courses | 僅週一擷取 |

**週一（DOW=1）：** 更新全部 12 個類別，`merge-stack.py` 累積官方資訊、模型快訊與工具教學
**週二至週日（DOW=2-7）：** 更新 10 個每日類別，`merge-stack.py` 累積官方資訊與模型快訊；教學與課程保留上次資料與時間戳

### 分類更新與檢查時間（AH-02）

`_updated_at[category]` 只記合格內容實質改變的時間；成功但無變更或沿用可靠前版均不改。`_checked_at[category]` 記本分類最近一次嘗試（含失敗）；未排程保留原值，包括從未有可靠內容的分類。沒有可靠內容不填 `_updated_at`。

`_update_outcome` 分開 `attempt` 與 `serving`，完整 enum／正反例／儲存語意見 `category-quality.md`。非週一的 tutorials／courses 為 not_scheduled；補跑明確指定分類則照常檢查。既有歷史快照的舊 `_updated_at` 保留原值，不推算內容更新時間，不自動當成 LKG。
