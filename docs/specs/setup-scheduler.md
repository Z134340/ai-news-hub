<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

## setup-scheduler.sh 規範

### macOS
1. **設定自動喚醒（⚠️ Bug Fix #6）**：
   - 先嘗試：`sudo pmset repeat wakeorpoweron MTWRFSU 17:55:00`
   - 如果 sudo 需要密碼 → 提示使用者手動執行一次此命令
   - 或引導加入 sudoers 免密碼：`echo "$USER ALL=(ALL) NOPASSWD: /usr/bin/pmset" | sudo tee /etc/sudoers.d/pmset`
   - **替代方案（不需 sudo）**：使用 caffeinate 或 macOS 系統偏好設定「節能」→ 排定開機時間
   - 腳本中明確回報喚醒是否設定成功，未成功時提供替代方案

2. **安裝 launchd**：
   - plist 路徑：~/Library/LaunchAgents/com.ainewshub.daily.plist
   - StartCalendarInterval：18:00（僅傍晚班）
   - MisfiredPolicy：若錯過排程，開機後立即補執行
   - PATH 包含 /usr/local/bin:/opt/homebrew/bin
   - StandardOutPath/ErrorPath → data/logs/

3. **載入排程**：launchctl load

### Linux
- crontab：`0 7 * * * /bin/bash ~/ai-news-hub/scripts/run-daily.sh`

### Windows
- 顯示工作排程器設定指引（18:00，喚醒電腦執行）

---

