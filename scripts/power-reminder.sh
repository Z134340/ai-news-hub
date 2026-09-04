#!/bin/bash
# power-reminder.sh — 17:50 電源提醒（S-PWR P-1）
# 由 launchd `com.ainewshub.power-reminder` 每日 17:50 觸發。
# 為什麼要有這個：電池＋合蓋時 macOS 每 17–36 分鐘只暗醒幾秒，caffeinate 擋不住，
# 實測電池執行 4–6 小時、7 類別只成功 2 個；AC 執行 25–28 分鐘、7/7 成功。
# 行為：`pmset -g batt` 第一行不含 "AC Power" 就送 macOS 通知；AC 時不動作。
# 不改 pmset 睡眠設定，不補跑排程（HANDOFF S-PWR 紅線）。
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if ! command -v pmset >/dev/null 2>&1; then
    exit 0
fi

if pmset -g batt 2>/dev/null | head -1 | grep -q "AC Power"; then
    exit 0
fi

osascript -e 'display notification "18:00 擷取即將開始，請接電源" with title "AI News Hub"' 2>/dev/null || true
