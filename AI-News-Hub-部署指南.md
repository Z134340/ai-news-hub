# AI News Hub 完整部署指南

## 專案概述

AI News Hub 是一個全自動 AI 新聞聚合平台，部署在 GitHub Pages 上。每天傍晚 18:00 自動擷取新聞（每日 8 類 + 每週一 3 類，共 11 大類別），經過真實 HTTP URL 驗證（含標題一致性檢測）後推送到 GitHub Pages。支援桌面與 iPhone 響應式瀏覽，每類別顯示獨立更新時間。

---

## 一、環境需求

**硬體：** macOS 電腦（排程主力）

**軟體：**
- Git（已安裝）
- Python 3.8+（macOS 內建）
- Node.js 18+（用於 Claude CLI）
- Claude CLI（`npm install -g @anthropic-ai/claude-code`）
- GitHub 帳號 + GitHub Pages 啟用

**網路：** 穩定的網路連線（擷取時需要存取 AI API 及新聞來源）

---

## 二、首次部署步驟

### Step 1：建立 GitHub Repository

```bash
# 建立本地專案
mkdir ~/ai-news-hub && cd ~/ai-news-hub
git init
git branch -M main

# 在 GitHub 網站建立名為 ai-news-hub 的 repository
# 然後連結遠端
git remote add origin https://github.com/你的帳號/ai-news-hub.git
```

### Step 2：複製專案檔案

確保專案結構如下：

```
ai-news-hub/
├── .nojekyll                      ← 必須！禁用 Jekyll
├── index.html                     ← 前端單檔（Vanilla JS）
├── SKILL.md                       ← 專案規範文件
├── .github/workflows/
│   ├── health-check.yml           ← 每日健康檢查
│   ├── keep-alive.yml             ← 每月保活
│   └── notify.yml                 ← 推播通知 Issue
├── scripts/
│   ├── run-daily.sh               ← 每日擷取主腳本（含 DOW 排程）
│   ├── validate.py                ← URL 驗證腳本
│   ├── extract-json.py            ← JSON 提取工具
│   ├── merge-stack.py             ← 模型/教學 累積合併（週一）
│   ├── setup-prompts.sh           ← 生成 11 個 prompt 檔案
│   ├── setup-scheduler.sh         ← 排程安裝腳本
│   └── prompts/                   ← 11 個類別提示詞
│       ├── papers.md
│       ├── topnews.md
│       ├── taiwan.md
│       ├── china.md
│       ├── usa.md
│       ├── techtrends.md
│       ├── governance.md
│       ├── tutorials.md
│       ├── models.md
│       └── courses.md
└── data/
    ├── latest.json                ← 最新資料（含 _updated_at）
    ├── index.json                 ← 歷史索引（保留 7 天）
    ├── health.json                ← 健康狀態
    ├── YYYY-MM-DD.json            ← 每日歸檔
    └── logs/                      ← 執行日誌（自動清理 7 天前）
```

### Step 3：啟用 GitHub Pages

1. 前往 GitHub Repository → Settings → Pages
2. Source 選擇「Deploy from a branch」
3. Branch 選擇「main」，目錄選「/ (root)」
4. 儲存後等待約 1-3 分鐘即可存取

### Step 4：Claude CLI 認證

```bash
# 安裝 Claude CLI
npm install -g @anthropic-ai/claude-code

# 登入認證
claude auth login

# 驗證認證狀態
claude auth status
```

### Step 5：安裝排程

```bash
cd ~/ai-news-hub
bash scripts/setup-scheduler.sh
```

腳本會自動完成：
- 設定 macOS 每日 17:55 自動喚醒（pmset）
- 安裝 launchd 排程（每日 18:00 執行）
- 建立日誌目錄

### Step 6：首次推送

```bash
cd ~/ai-news-hub
git add -A
git commit -m "🚀 AI News Hub 初始部署"
git push -u origin main
```

### Step 7：手動測試擷取

```bash
cd ~/ai-news-hub
bash scripts/run-daily.sh
```

觀察日誌輸出：
```bash
cat data/logs/$(date +%Y-%m-%d).log
```

### Step 8：驗證網站

開啟 `https://你的帳號.github.io/ai-news-hub/` 確認網站正常顯示。

---

## 三、11 大分類說明

| # | 分類 | ID | 筆數 | 排程 | 說明 |
|---|------|----|------|------|------|
| 1 | 論文研討 | papers | 10 | 每日 | 優先：LLM-as-a-Judge / Agent評估 / AI Agent 研究 |
| 2 | 全球熱門 | topnews | 20 | 每日 | 優先：AI Agent / LLM發布 / 技術大廠新產品 / 資安 |
| 3 | 台灣熱議 | taiwan | 30 | 每日 | 優先：AI Agent / LLM / 大廠新產品在台動態 / 資安 |
| 4 | 中國熱議 | china | 20 | 每日 | 優先：AI Agent / 中國LLM新模型 / 大廠新產品 / 資安 |
| 5 | 美國熱議 | usa | 30 | 每日 | 優先：AI Agent / LLM發布 / 技術大廠新產品 / 資安 |
| 6 | 技術趨勢 | techtrends | 20 | 每日 | 顧問公司報告與市場分析 |
| 7 | 科技治理 | governance | 18 | 每日 | AI 法規政策與治理討論 |
| 8 | AI 工具教學 | tutorials | 10 | 每週一 | 實戰工具教學與指南 |
| 9 | AI 課程/證照 | courses | 10 | 每週一 | 官方免費課程與證照資訊 |
| 10 | 模型快訊 | models | 15 | 每週一 | 近 3 個月模型發布訊息（累積合併） |

---

## 四、每日自動排程流程

```
17:55  macOS 自動喚醒
18:00  launchd 觸發 run-daily.sh
  ├→ 檢查 Claude CLI 認證
  ├→ 檢查網路連線
  ├→ git pull 最新程式碼
  ├→ 判斷星期幾（DOW）
  │   ├→ 週一：擷取全部 11 類別（含模型/教學/課程）
  │   └→ 其他：僅擷取 8 個每日類別
  ├→ 依序擷取各類別（每個最多重試 2 次，10分鐘 watchdog 逾時）
  ├→ 每類別注入 _updated_at 時間戳
  ├→ 週一：執行 merge-stack.py 模型/教學 累積合併
  ├→ 合併為 data/latest.json（含 _updated_at 各類別時間）
  │   └→ 非週一：每週類別保留上次 latest.json 資料與時間戳
  ├→ validate.py 八步驟驗證
  │   ├→ 每個 URL 發 HEAD/GET 請求
  │   ├→ 404/5xx/超時 → 移除該筆新聞
  │   ├→ 200-399 → 抓取頁面標題驗證一致性
  │   ├→ 標題 score=0 → 移除（幻覺 URL）
  │   ├→ 標題 score<0.3 → needs_review（保留）
  │   └→ 產生驗證報告 data/logs/validate-YYYY-MM-DD.json
  ├→ 歸檔為 data/YYYY-MM-DD.json + 更新 index.json（保留 7 天）
  ├→ git commit [verified] 或 [unverified] + push
  └→ 更新 data/health.json
~18:56  完成（正常）/ ~19:20（偶爾逾時）
19:30  GitHub Actions 健康檢查（若未更新則標記 missed）
```

---

## 五、URL 驗證機制

validate.py 執行八步驟驗證（含反幻覺標題一致性檢測）：

1. **URL 存活檢測** — HTTP HEAD/GET 請求，3 並發，0.5 秒批次間隔
2. **標題一致性** — 抓取頁面 `<title>`/`<h1>`，與新聞 title 計算相似度（SequenceMatcher）；score=0 移除，0<score<0.3 標記 needs_review，≥0.3 通過
3. **域名白名單** — 90+ 個信任域名（含新增的 AI Business, OWASP, Deloitte 等）
4. **欄位完整性** — 檢查每個類別的必填欄位
5. **日期合理性** — 新聞 today-90 至 today+1，模型允許未來日期
6. **重複檢測** — URL 完全匹配 + 標題相似度 > 0.8
7. **驗證報告** — 輸出至 data/logs/validate-YYYY-MM-DD.json
8. **自動修復** — 移除不合格項目，更新 verified 欄位；pass_rate = 100% 時 commit 標記 [verified]，否則 [unverified]

只有通過驗證的新聞才會顯示綠色 ✓ 打勾。

---

## 六、iPhone 響應式設計

網站針對 iPhone 做了全面優化：

- **安全區域** — `viewport-fit=cover` + `env(safe-area-inset-*)` 適配瀏海/Dynamic Island
- **觸控體驗** — `touch-action: manipulation` 消除 300ms 延遲，移除 tap highlight
- **Header 單列佈局** — 左側 Logo+標題，右側狀態膠囊+驗證率+更新時間（同一列）
- **分類 Tab** — 手機端改為橫向滾動，每個 tab 保持 64px 最小寬度
- **子分類 Tab** — 自動滾動到當前選中項，backdrop-filter 模糊背景
- **分類更新時間** — 每個類別標題下方顯示獨立更新時間，每週類別標示「每週一更新」
- **優先排序** — LLM/Agent 相關主題自動置頂（論文/新聞/模型）
- **卡片排版** — 字體、間距、圓角全面縮小適配小螢幕
- **Sticky 導航** — JS 動態計算 header + tabs 高度
- **斷點** — 768px（平板）→ 480px（手機）→ 370px（iPhone SE）

---

## 七、故障排除

### 排程沒有執行
```bash
# 確認排程是否載入
launchctl list | grep ainewshub

# 查看最新日誌
cat ~/ai-news-hub/data/logs/$(date +%Y-%m-%d).log

# 手動執行
bash ~/ai-news-hub/scripts/run-daily.sh
```

### Claude CLI 認證過期
```bash
claude auth login
claude auth status
```

### Git push 失敗
```bash
cd ~/ai-news-hub
git status
git push origin main
```

### 網站沒有更新
1. 確認 `data/latest.json` 的 date 欄位是否為今日
2. 確認 GitHub Pages 部署狀態（Repository → Actions）
3. 清除瀏覽器快取或加入 `?v=123` 參數

### 重新安裝排程
```bash
# 卸載舊排程
launchctl unload ~/Library/LaunchAgents/com.ainewshub.daily.plist

# 重新安裝
bash ~/ai-news-hub/scripts/setup-scheduler.sh
```

---

## 八、維護清單

| 項目 | 頻率 | 方式 |
|------|------|------|
| 確認網站更新 | 每日 | 打開網站查看「資料就緒」狀態 |
| Claude CLI 認證 | 每月 | `claude auth status` 確認 |
| GitHub Pages 狀態 | 偶爾 | Repository → Settings → Pages |
| 日誌清理 | 自動 | run-daily.sh 自動清理 7 天前日誌 |
| 歷史歸檔 | 自動 | index.json 自動保留 7 天 |
| 保活 | 自動 | keep-alive.yml 每月 1 號自動執行 |

---

## 九、版本歷程

| 日期 | 版本 | 變更 |
|------|------|------|
| 2026-04-05 | v1.0 | 初始 7 大類別建置 |
| 2026-04-07 | v4.0 | 每日/每週 DOW 分類排程、每類別 `_updated_at` 時間戳 |
| 2026-04-10 | v4.2 | 八步驟驗證：標題一致性檢測（反幻覺） |
| 2026-04-11 | v4.4 | 強化優先搜尋；topnews 10→20 筆；前端 PRIORITY_KW |
| 2026-04-14 | v4.5 | 排程調整 07:00（喚醒 06:55）；macOS watchdog 600s；max-turns 30；修復 openCards bug |
| 2026-04-16 | v4.6 | 修復 git push 分歧問題（fetch + reset --soft 確保 fast-forward）；watchdog 1500s→900s；新增 AI Agent Engineering 搜尋主題（Context Engineering、Harness Engineering、Agent Orchestration、Agent Memory）至 papers/topnews/taiwan/china/usa 五個 prompt；前端 PRIORITY_KW 同步新增對應關鍵詞 |
| 2026-04-16 | v4.7 | 新增 Agent 生態系搜尋（LangChain/LangGraph、CrewAI、OpenAI Agents SDK、Google ADK、Microsoft AutoGen/AGT、Semantic Kernel、LlamaIndex、Haystack、Pydantic AI、AWS Bedrock Agents、Vertex AI Agents、Dify）至全部 5 個 AI 新聞 prompt；前端 PRIORITY_KW 同步更新 |
| 2026-04-18 | v4.8 | 主分類 Tabs 移至 Header 同一列；hdr-inner width:100% + hdr-right margin-left:auto 修復狀態列固定靠右；主分類 5 個（含書籤）、子頁籤 8 個 |
