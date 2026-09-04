<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

## .github/workflows/backup-fetch.yml → health-check.yml 規範

**目的：** 本機排程沒跑時，更新 health.json 讓網站顯示警告。不執行擷取、不呼叫 API。

```yaml
觸發：每天 UTC 12:17（台灣 20:17）＋ workflow_dispatch（手動驗證）
      · 避開整點：GitHub 排程整點壅塞，實測延遲 3–9 小時，常跨台灣午夜
邏輯：
  1. checkout repo
  2. 計算 SLOT_DATE（這次檢查對應哪一天的 18:00 擷取）：
     · 台灣時間 < 20:00 → 檢查已延遲到隔天，SLOT_DATE = 昨天
     · 否則 SLOT_DATE = 今天
     （2026-09-05 修正：舊邏輯用「latest.date == 今天」，cron 延遲跨午夜就誤判 missed，
       08-28／08-29／09-01／09-05 四次皆為誤判）
  3. 讀取 data/latest.json 的 date 欄位
  4. 如果 date >= SLOT_DATE → 輸出 "本機已完成" → 結束
  5. 否則更新 data/health.json（同一 SLOT_DATE 已標記過則略過，不重複累加）：
     · status: "missed"
     · last_missed: SLOT_DATE
     · consecutive_failures +1
     · note: "本機排程未執行，等待電腦上線後自動補跑"
  6. health.json 有變更才 git commit + push（讓網站讀到最新 health.json）
權限：contents: write
```

**費用：$0**（僅讀寫 JSON，不呼叫任何 AI API）
**補跑機制：** 電腦上線後，macOS launchd MisfiredPolicy 會自動補執行 run-daily.sh。

### 不再需要 backup-fetch.mjs
此版本不執行備援擷取，移除 scripts/backup-fetch.mjs。

---

## .github/workflows/keep-alive.yml 規範

**目的：** 防止 GitHub Pages 因 60 天無活動被停用。

```yaml
觸發：每月 1 號 UTC 00:00
邏輯：
  1. checkout
  2. 更新 data/health.json 的 keep_alive 時間戳
  3. git commit -m "🔄 Keep alive" + push
權限：contents: write
```

---

