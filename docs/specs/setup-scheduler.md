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

## 電源提醒（S-PWR P-1，2026-09-05）

`setup-scheduler.sh` 同時安裝第二個 LaunchAgent `~/Library/LaunchAgents/com.ainewshub.power-reminder.plist`（不入版控），每日 17:50 執行 `scripts/power-reminder.sh`：`pmset -g batt` 第一行不含 `AC Power` 就以 `osascript` 送 macOS 通知「18:00 擷取即將開始，請接電源」；AC 時不動作。PATH 同樣自帶 `/opt/homebrew/bin`，stdout/stderr 寫 `data/logs/power-reminder.log`。不改 `pmset -b sleep`、不做補跑排程。

驗證：`launchctl list | grep ainewshub` 應同時列出 `com.ainewshub.daily` 與 `com.ainewshub.power-reminder`；手動觸發 `launchctl kickstart -k gui/$(id -u)/com.ainewshub.power-reminder`，拔電源時應跳通知、接電源時無通知。
