<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

## .github/workflows/backup-fetch.yml → health-check.yml 規範

**目的：** 本機排程沒跑時，更新 health.json 讓網站顯示警告。不執行擷取、不呼叫 API。

```yaml
觸發：每天 UTC 11:30（台灣 19:30）（僅傍晚一次）
邏輯：
  1. checkout repo
  2. 讀取 data/latest.json 的 date 欄位
  3. 如果 date === 今日 → 輸出 "本機已完成" → 結束
  4. 如果 date !== 今日 → 更新 data/health.json：
     · status: "missed"
     · last_missed: 今日日期
     · consecutive_failures +1
     · note: "本機排程未執行，等待電腦上線後自動補跑"
  5. git commit + push（讓網站讀到最新 health.json）
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

