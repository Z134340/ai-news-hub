#!/usr/bin/env bash
# AI News Hub — repo 瘦身一次性清理
# 在你的 Mac 上於 repo 根目錄執行：bash scripts/repo-slim.sh
# 沙箱（Cowork）無法刪除既有檔案與操作 .git，故此步驟需在本機跑。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▶ 1/5 清除殘留的 git index.lock（若有）"
[ -f .git/index.lock ] && rm -f .git/index.lock && echo "  已移除 index.lock" || echo "  無殘留 lock"

echo "▶ 2/5 移除冗餘的 git bundle 備份"
git rm -q --ignore-unmatch ai-news-hub.bundle && echo "  ai-news-hub.bundle 已移除" || true

echo "▶ 3/5 移除 orphan 中繼檔 emerging.json"
git rm -q --ignore-unmatch data/emerging.json || true

echo "▶ 4/5 移除已追蹤的失敗擷取日誌 failed_*.txt"
git rm -q --ignore-unmatch 'data/logs/failed_*.txt' || true

echo "▶ 5/5 逾期 archive 改由冷封存處理（不在此直接刪）"
echo "  請先完成 Firebase 冷封存遷移再 prune，避免資料只在 git 被刪掉而遺失："
echo "    1) 依 ARCHIVE-SETUP.md 設定好 writer 帳號與 ~/.config/ai-news-hub/archiver.env"
echo "    2) node scripts/archive-to-firestore.mjs --older-than 7 --prune   # 上傳 Firestore 並刪本機"
echo "    （migration 成功後，git add -A 會把已 prune 的 archive 標記為刪除）"

echo
echo "✅ 完成。檢視變更：git status"
echo "   提交： git commit -m '🧹 repo 正規化：拆檔 + Firebase 書籤同步 + 瘦身'"
echo "   推送： git push origin main"
