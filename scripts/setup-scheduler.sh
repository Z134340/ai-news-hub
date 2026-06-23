#!/bin/bash
# setup-scheduler.sh — 安裝 AI News Hub 每日排程
# macOS: pmset + launchd
# Linux: crontab
# Windows: 提供指引

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_PATH="$REPO_DIR/scripts/run-daily.sh"
PLIST_LABEL="com.ainewshub.daily"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"

echo "============================================"
echo "  AI News Hub 排程安裝程式"
echo "============================================"
echo ""
echo "📂 專案目錄: $REPO_DIR"
echo ""

# 偵測作業系統
OS="$(uname -s)"

case "$OS" in
  Darwin)
    echo "🍎 偵測到 macOS"
    echo ""

    # ── Step 1：自動喚醒 ──
    echo "── Step 1/3：設定自動喚醒 ──"
    echo ""
    echo "嘗試設定 pmset 自動喚醒 17:55..."
    if sudo -n pmset repeat wakeorpoweron MTWRFSU 17:55:00 2>/dev/null; then
      echo "✅ 已設定自動喚醒：每日 17:55"
    else
      echo "⚠️ pmset 需要管理員權限。請手動執行以下任一方案："
      echo ""
      echo "方案 A（手動執行一次）："
      echo "  sudo pmset repeat wakeorpoweron MTWRFSU 17:55:00"
      echo ""
      echo "方案 B（免密碼設定）："
      echo "  echo \"$USER ALL=(ALL) NOPASSWD: /usr/bin/pmset\" | sudo tee /etc/sudoers.d/pmset"
      echo "  sudo pmset repeat wakeorpoweron MTWRFSU 17:55:00"
      echo ""
      echo "方案 C（不需 sudo）："
      echo "  系統設定 → 電池 → 排程 → 啟動或喚醒：每日 17:55"
      echo ""
    fi

    # ── Step 2：安裝 launchd plist ──
    echo ""
    echo "── Step 2/3：安裝 launchd 排程 ──"
    echo ""

    # 卸載舊版（如果存在）
    if launchctl list 2>/dev/null | grep -q "$PLIST_LABEL"; then
      echo "移除舊排程..."
      launchctl unload "$PLIST_PATH" 2>/dev/null || true
    fi

    mkdir -p "$HOME/Library/LaunchAgents"
    mkdir -p "$REPO_DIR/data/logs"

    cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${SCRIPT_PATH}</string>
    </array>

    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>18</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>TZ</key>
        <string>Asia/Taipei</string>
    </dict>

    <key>WorkingDirectory</key>
    <string>${REPO_DIR}</string>

    <key>StandardOutPath</key>
    <string>${REPO_DIR}/data/logs/launchd-stdout.log</string>

    <key>StandardErrorPath</key>
    <string>${REPO_DIR}/data/logs/launchd-stderr.log</string>

    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>
PLIST

    echo "✅ plist 已建立: $PLIST_PATH"

    # ── Step 3：載入排程 ──
    echo ""
    echo "── Step 3/3：載入排程 ──"
    echo ""

    launchctl load "$PLIST_PATH"
    echo "✅ 排程已載入"

    echo ""
    echo "============================================"
    echo "  macOS 排程安裝完成"
    echo "============================================"
    echo ""
    echo "排程時間：每日 18:00（台灣時間）"
    echo "執行腳本：$SCRIPT_PATH"
    echo "Log 目錄：$REPO_DIR/data/logs/"
    echo ""
    echo "驗證排程："
    echo "  launchctl list | grep ainewshub"
    echo ""
    echo "手動執行測試："
    echo "  bash $SCRIPT_PATH"
    echo ""
    echo "卸載排程："
    echo "  launchctl unload $PLIST_PATH"
    echo ""
    ;;

  Linux)
    echo "🐧 偵測到 Linux"
    echo ""

    # 檢查 crontab 是否已設定
    if crontab -l 2>/dev/null | grep -q "run-daily.sh"; then
      echo "⚠️ 已有 AI News Hub 排程，更新中..."
      crontab -l 2>/dev/null | grep -v "run-daily.sh" | crontab -
    fi

    # 新增 crontab 條目（07:30 台灣時間）
    (crontab -l 2>/dev/null; echo "# AI News Hub 每日排程") | crontab -
    (crontab -l 2>/dev/null; echo "0 18 * * * TZ=Asia/Taipei /bin/bash ${SCRIPT_PATH} >> ${REPO_DIR}/data/logs/cron.log 2>&1") | crontab -

    echo "✅ crontab 已設定"
    echo ""
    echo "排程時間：每日 18:00（台灣時間）"
    echo ""
    echo "驗證排程："
    echo "  crontab -l"
    echo ""
    echo "手動執行測試："
    echo "  bash $SCRIPT_PATH"
    echo ""
    ;;

  MINGW*|CYGWIN*|MSYS*)
    echo "🪟 偵測到 Windows"
    echo ""
    echo "請使用工作排程器（Task Scheduler）手動設定："
    echo ""
    echo "1. 開啟「工作排程器」（Win+R → taskschd.msc）"
    echo "2. 建立基本工作 → 名稱：AI News Hub Daily"
    echo "3. 觸發程序 → 每天 → 18:00"
    echo "4. 動作 → 啟動程式"
    echo "   程式：bash"
    echo "   引數：${SCRIPT_PATH}"
    echo "   起始位置：${REPO_DIR}"
    echo "5. 條件 → ✅ 喚醒電腦以執行此工作"
    echo "6. 設定 → ✅ 如果錯過排定時間，儘快執行"
    echo ""
    ;;

  *)
    echo "❌ 不支援的作業系統: $OS"
    echo "請手動設定 cron 或工作排程器，每日 07:30 執行："
    echo "  bash $SCRIPT_PATH"
    exit 1
    ;;
esac

echo "🎉 安裝完成！"
