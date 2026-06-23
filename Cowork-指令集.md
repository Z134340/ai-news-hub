# AI News Hub — Cowork 指令集

本文件記錄建置 AI News Hub 網站的所有關鍵指令與步驟，方便日後維護或重新部署。

---

## 一、初始環境設定

### 1.1 Claude CLI 安裝與認證
```bash
# 安裝 Claude CLI
npm install -g @anthropic-ai/claude-code

# 登入（使用瀏覽器 OAuth 認證）
claude auth login

# 確認認證狀態
claude auth status
```

### 1.2 Git 與 GitHub 設定
```bash
# 建立本地 repo
mkdir ~/ai-news-hub && cd ~/ai-news-hub
git init && git branch -M main

# 連結 GitHub remote
git remote add origin https://github.com/你的帳號/ai-news-hub.git

# 建立 .nojekyll（確保 JSON 不被 Jekyll 處理）
touch .nojekyll

# 首次推送
git add -A && git commit -m "🚀 初始部署" && git push -u origin main
```

### 1.3 啟用 GitHub Pages
```
GitHub → Repository Settings → Pages → Source: Deploy from branch → main / root
```

---

## 二、排程安裝指令

### 2.1 一鍵安裝排程（macOS）
```bash
cd ~/ai-news-hub
bash scripts/setup-scheduler.sh
```

### 2.2 手動設定自動喚醒（需 sudo）
```bash
# 每日 17:55 自動喚醒電腦
sudo pmset repeat wakeorpoweron MTWRFSU 17:55:00

# 或透過系統設定 → 電池 → 排程 → 啟動或喚醒：每日 17:55
```

### 2.3 排程管理指令
```bash
# 確認排程是否載入
launchctl list | grep ainewshub

# 手動載入排程
launchctl load ~/Library/LaunchAgents/com.ainewshub.daily.plist

# 卸載排程
launchctl unload ~/Library/LaunchAgents/com.ainewshub.daily.plist

# 查看 plist 內容
cat ~/Library/LaunchAgents/com.ainewshub.daily.plist
```

---

## 三、每日擷取指令

### 3.1 手動執行完整擷取
```bash
cd ~/ai-news-hub
bash scripts/run-daily.sh
```

### 3.2 查看擷取日誌
```bash
# 今日日誌
cat ~/ai-news-hub/data/logs/$(date +%Y-%m-%d).log

# 最近日誌
ls -lt ~/ai-news-hub/data/logs/*.log | head -5
```

### 3.3 手動擷取單一類別（透過 Claude CLI）
```bash
cd ~/ai-news-hub
claude -p "$(cat scripts/prompts/taiwan.md)" --max-turns 30 --output-format text --allowedTools "WebSearch"
```

可用類別（10 個）：
papers, topnews, taiwan, china, usa, techtrends, governance, tutorials, models, courses

分類排程：
- 每日類別（7）：papers, topnews, taiwan, china, usa, techtrends, governance
- 每週類別（3，僅週一擷取）：models, tutorials, courses

---

## 四、資料驗證指令

### 4.1 執行完整驗證（真實 HTTP 檢查）
```bash
cd ~/ai-news-hub
python3 scripts/validate.py
```

### 4.2 驗證單一類別
```bash
python3 scripts/validate.py --category taiwan
```

### 4.3 僅查看報告（不修改資料）
```bash
python3 scripts/validate.py --dry-run
```

### 4.4 查看驗證報告
```bash
cat ~/ai-news-hub/data/logs/validate-$(date +%Y-%m-%d).json | python3 -m json.tool
```

---

## 五、Git 操作指令

### 5.1 推送更新
```bash
cd ~/ai-news-hub
git add -A
git commit -m "📰 更新描述"
git push origin main
```

### 5.2 查看狀態
```bash
git status
git log --oneline -10
```

### 5.3 拉取最新變更
```bash
cd ~/ai-news-hub
git pull origin main
```

### 5.4 解決衝突
```bash
git pull --rebase origin main
# 若衝突：手動解決後
git add . && git rebase --continue
```

---

## 六、資料檢查指令

### 6.1 查看最新資料統計
```bash
python3 -c "
import json
with open('data/latest.json') as f:
    d = json.load(f)
print(f'日期: {d[\"date\"]}')
print(f'時間: {d[\"time\"]}')
for cat, items in d['data'].items():
    v = sum(1 for i in items if i.get('verified'))
    ts = d.get('_updated_at', {}).get(cat, '?')
    print(f'  {cat}: {len(items)} 筆, 驗證: {v}, 更新: {ts}')
print(f'驗證: {d.get(\"validation\", {})}')
"
```

### 6.2 查看健康狀態
```bash
cat ~/ai-news-hub/data/health.json | python3 -m json.tool
```

### 6.3 查看歷史索引（保留 7 天）
```bash
cat ~/ai-news-hub/data/index.json | python3 -m json.tool | head -30
```

### 6.4 查看各類別更新時間
```bash
python3 -c "
import json
with open('data/latest.json') as f:
    d = json.load(f)
for cat, ts in d.get('_updated_at', {}).items():
    print(f'  {cat}: {ts}')
"
```

---

## 七、故障排除指令

### 7.1 Claude CLI 問題
```bash
# 重新認證
claude auth login

# 確認版本
claude --version

# 測試 API 連線
claude -p "say hello" --max-turns 1 --output-format text
```

### 7.2 排程問題
```bash
# 查看 launchd 錯誤日誌
cat ~/ai-news-hub/data/logs/launchd-stderr.log

# 查看 launchd 標準輸出
cat ~/ai-news-hub/data/logs/launchd-stdout.log

# 檢查 pmset 喚醒設定
pmset -g sched
```

### 7.3 GitHub Pages 問題
```bash
# 確認 .nojekyll 存在
ls -la ~/ai-news-hub/.nojekyll

# 確認 GitHub Actions 狀態
gh run list --limit 5

# 查看最近部署
gh api repos/你的帳號/ai-news-hub/pages
```

### 7.4 網路問題
```bash
# 測試 Anthropic API 連線
curl -s --max-time 5 https://api.anthropic.com > /dev/null && echo "OK" || echo "FAIL"

# 測試 GitHub 連線
git ls-remote origin HEAD > /dev/null && echo "OK" || echo "FAIL"
```

---

## 八、Cowork 對話指令（用於 Claude Cowork 模式）

在 Cowork 模式中可直接下達以下指令：

| 指令 | 說明 |
|------|------|
| 手動擷取所有類別 | 執行 `bash scripts/run-daily.sh` |
| 擷取單一類別 | 執行 `claude -p "$(cat scripts/prompts/taiwan.md)"` |
| 驗證所有 URL | 執行 `python3 scripts/validate.py` |
| 查看今日日誌 | 查看 `data/logs/$(date +%Y-%m-%d).log` |
| 查看資料統計 | 解析 `data/latest.json` 並顯示統計 |
| 更新新聞來源 | 編輯 `scripts/prompts/*.md` |
| 新增類別 | 建立 prompt → 更新 run-daily.sh → 更新 index.html |
| 修改排程時間 | 編輯 `setup-scheduler.sh` 後重新執行 |
| 推送到 GitHub | 執行 `git add -A && git commit -m "..." && git push` |

---

## 九、重要檔案路徑一覽

| 檔案 | 路徑 | 用途 |
|------|------|------|
| 前端 | `~/ai-news-hub/index.html` | 網站主頁面（Vanilla JS 單檔） |
| 最新資料 | `~/ai-news-hub/data/latest.json` | 當前新聞資料（含 `_updated_at`） |
| 健康狀態 | `~/ai-news-hub/data/health.json` | 排程執行狀態 |
| 歷史索引 | `~/ai-news-hub/data/index.json` | 過往日期列表（保留 7 天） |
| 擷取腳本 | `~/ai-news-hub/scripts/run-daily.sh` | 每日執行主腳本（含 DOW 排程） |
| 驗證腳本 | `~/ai-news-hub/scripts/validate.py` | URL 驗證工具 |
| 累積合併 | `~/ai-news-hub/scripts/merge-stack.py` | 模型/教學 去重合併（週一） |
| 排程安裝 | `~/ai-news-hub/scripts/setup-scheduler.sh` | macOS/Linux 排程 |
| Prompt 生成 | `~/ai-news-hub/scripts/setup-prompts.sh` | 生成 11 個 prompt 檔案 |
| 提示詞 | `~/ai-news-hub/scripts/prompts/*.md` | 11 個類別提示詞 |
| launchd | `~/Library/LaunchAgents/com.ainewshub.daily.plist` | macOS 排程設定 |
| 專案規範 | `~/ai-news-hub/SKILL.md` | 完整技術規範 |
| 日誌 | `~/ai-news-hub/data/logs/` | 執行日誌目錄（自動清理 7 天前） |

---

## 十、版本歷程

| 日期 | 版本 | 變更 |
|------|------|------|
| 2026-04-05 | v1.0 | 初始 7 大類別建置 |
| 2026-04-05 | v2.0 | 擴充至 12 大類別，新增技術趨勢、新興技術、科技治理、AI 工具教學、AI 課程/證照 |
| 2026-04-05 | v2.1 | 台灣/美國擴充至 30 筆，新增 INSIDE、AI Post Hub、AI Business 等來源 |
| 2026-04-05 | v2.2 | 新聞依日期最新排序（sortByDate）|
| 2026-04-05 | v2.3 | 排程改為每日早班一次（取消午班）|
| 2026-04-05 | v2.4 | 資料驗證改為真實 HTTP URL 檢查 |
| 2026-04-05 | v3.0 | iPhone 響應式全面優化（安全區域、觸控、橫向滾動 Tab）|
| 2026-04-05 | v3.1 | Bug 修復（calendar icon、orphaned drawer、5 個 prompt 檔案）|
| 2026-04-06 | v3.2 | 優先排序（LLM/Agent 主題置頂）、iPhone Header 單列佈局 |
| 2026-04-06 | v3.3 | 歷史紀錄改為 7 天、修復 0 筆/0% bug、新增 merge-stack.py & setup-prompts.sh |
| 2026-04-07 | v4.0 | 每日/每週 DOW 分類排程、每類別 `_updated_at` 時間戳、前端分類更新時間顯示 |
| 2026-04-10 | v4.1 | 移除 EOL 快訊功能（精簡至 11 大類別） |
| 2026-04-10 | v4.2 | 八步驟驗證：新增標題一致性檢測（反幻覺），pass_rate<100% 標記 [unverified] |
| 2026-04-10 | v4.3 | 全 11 個 prompt 加入嚴格反幻覺規則（6 條）；補建 courses 全鏈路 |
| 2026-04-11 | v4.4 | 強化優先搜尋：新增 STEP1 具體 Query；topnews 10→20 筆；前端 PRIORITY_KW 補強中文關鍵詞 |
| 2026-04-14 | v4.5 | 排程 07:00（喚醒 06:55）；macOS watchdog 600s；max-turns 15→30；修復 openCards bug |
| 2026-04-16 | v4.6 | 修復 git push 分歧問題（fetch + reset --soft 確保 fast-forward）；watchdog 1500s→900s；新增 AI Agent Engineering 搜尋主題（Context Engineering、Harness Engineering、Agent Orchestration、Agent Memory）至 papers/topnews/taiwan/china/usa 五個 prompt；前端 PRIORITY_KW 同步新增對應關鍵詞 |
| 2026-04-16 | v4.7 | 新增 Agent 生態系搜尋（LangChain/LangGraph、CrewAI、OpenAI Agents SDK、Google ADK、Microsoft AutoGen/AGT、Semantic Kernel、LlamaIndex、Haystack、Pydantic AI、AWS Bedrock Agents、Vertex AI Agents、Dify）至全部 5 個 AI 新聞 prompt；前端 PRIORITY_KW 同步更新 |
| 2026-04-18 | v4.8 | 主分類 Tabs 移至 Header 同一列；hdr-inner width:100% + hdr-right margin-left:auto 修復狀態列固定靠右；主分類 5 個（含書籤）、子頁籤 8 個 |
