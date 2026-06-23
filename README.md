# AI News Hub — 全自動 AI 新聞聚合平台

一個零成本、全自動的 AI 新聞聚合系統，每天自動收集、驗證、發佈 AI 相關新聞，展示於響應式 GitHub Pages 前端。

## 架構圖

```
本機排程 (每日 18:00)
    ↓
Claude CLI 擷取 10 類別
  ├─ 每日 7 類 (論文/全球/台灣/中國/美國/技術趨勢/科技治理)
  └─ 每週一 3 類 (模型/工具教學/課程)
    ↓
validate.py 八步驟驗證
    ↓
git push → GitHub Pages 自動部署
    ↓
GitHub Issues 通知 (Email)

健康檢查 (GitHub Actions 19:30)
    ↓
本機沒跑時標記 missed

前端 (index.html)
    ↓
自動載入 latest.json
    ↓
健康儀表板 + 驗證標記 + 分類更新時間
    ↓
每 15 分鐘靜默檢查更新
```

## 功能特性

- **十大類別聚合**：論文 / 全球新聞 / 台灣 / 中國 / 美國 / 技術趨勢 / 科技治理 / AI 工具教學 / AI 課程 / AI 模型
- **智慧排程**：每日 7 類 + 每週一 3 類（模型/教學/課程），非週一保留上次資料
- **八步驟自動驗證**：URL 存活、標題一致性、域名白名單、欄位完整、日期合理、重複檢測、驗證報告、自動修復
- **優先排序**：LLM-as-a-Judge、Agent evaluation 等主題自動置頂
- **每類別更新時間**：前端顯示各分類最後擷取時間，每週類別標示「每週一更新」
- **模型累積合併**：`merge-stack.py` 去重合併歷史+今日資料
- **macOS 自動喚醒**：使用 `pmset` 在排程時自動喚醒 Mac
- **GitHub Actions 健康檢查**：19:30 檢查本機是否成功執行
- **自動 Issue 通知**：Push 時自動建立 GitHub Issues，Email 直達收件箱（零設定）
- **響應式暗色前端**：Vanilla JS 零依賴，iPhone 全面適配
- **歷史紀錄**：保留近 7 天資料，可切換檢視
- **每月保活**：防止 GitHub Pages 因長期無活動而停用
- **Zero Cost**：使用 Claude Pro/Team 訂閱的 CLI 額度運行

## 快速開始

### 先決條件

- macOS 或 Linux 環境
- Git
- Claude CLI（已登入）：`claude --version`
- GitHub 帳號 + 個人令牌（用於 `gh` 命令）

### 部署步驟

#### 1. 建立 GitHub 倉庫

```bash
# 初始化本地倉庫
git init

# 設定遠程倉庫並推送
gh repo create ai-news-hub \
  --public \
  --source=. \
  --push \
  --description="全自動 AI 新聞聚合平台"
```

#### 2. 啟用 GitHub Pages

1. 進入 GitHub 倉庫設定：Settings → Pages
2. Source 選擇：`Deploy from branch`
3. Branch 選擇：`main`
4. Folder 選擇：`/(root)`
5. Save

> Pages 會在 https://yourname.github.io/ai-news-hub 上線

#### 3. 安裝本機排程

```bash
bash scripts/setup-scheduler.sh
```

此步驟會：
- 檢查 Claude CLI 登入狀態
- 安裝 launchd agent（macOS）或 cron job（Linux）
- 設置 18:00 自動執行（macOS 17:55 喚醒）

#### 4. 手動測試擷取流程

```bash
bash scripts/run-daily.sh
```

此步驟會：
- 擷取 11 類別新聞（依星期判斷每日/每週類別）
- 執行驗證
- 提交並推送至 GitHub
- 建立 GitHub Issue 通知

#### 5. 驗證自動化

檢查以下項目：

- **本機排程**：
  ```bash
  # macOS
  launchctl list | grep ai-news-hub

  # Linux
  crontab -l
  ```

- **GitHub Actions**：倉庫 → Actions 頁籤，檢查健康檢查工作流執行情況

- **GitHub Pages**：訪問 `https://yourname.github.io/ai-news-hub`

- **Email 通知**：GitHub Settings → Notifications → Email
  - ✅ 確保勾選 `Issues` 和 `Discussions`

## 專案結構

```
ai-news-hub/
├── README.md                    # 本檔案
├── SKILL.md                     # Claude 工作流定義（完整技術規範）
├── index.html                   # 前端單檔 (Vanilla JS, GitHub Pages)
├── .nojekyll                    # 禁用 Jekyll（確保 JSON 直達）
├── scripts/
│   ├── run-daily.sh             # 每日擷取主腳本（含 DOW 排程）
│   ├── validate.py              # 七步驟 URL 驗證
│   ├── extract-json.py          # Claude 回應 JSON 提取
│   ├── merge-stack.py           # 模型/教學 累積合併（週一）
│   ├── setup-prompts.sh         # 生成 11 個 prompt 檔案
│   ├── setup-scheduler.sh       # macOS/Linux 排程安裝
│   └── prompts/                 # 11 個類別提示詞 (.md)
├── data/
│   ├── latest.json              # 最新新聞資料（含 _updated_at）
│   ├── index.json               # 歷史索引（保留 7 天）
│   ├── health.json              # 健康狀態
│   ├── YYYY-MM-DD.json          # 每日歸檔
│   └── logs/                    # 執行日誌（自動清理 7 天前）
└── .github/
    └── workflows/
        ├── health-check.yml     # 每日健康檢查
        ├── keep-alive.yml       # 每月保活
        └── notify.yml           # 推播通知 Issue
```

## 常用指令

| 指令 | 說明 |
|------|------|
| `bash scripts/run-daily.sh` | 手動執行完整流程（擷取→驗證→推送→通知） |
| `claude list` | 列出已安裝的 Claude 工作流 |
| `python src/fetch.py` | 僅執行擷取 |
| `python src/validate.py latest.json` | 驗證最新的 JSON |
| `python scripts/notify-github.py` | 手動建立 GitHub Issue |
| `git log --oneline \| head -20` | 查看最近 20 次提交 |
| `gh issue list --state open` | 列出所有未關閉的 Issue |
| `launchctl start ai-news-hub` (macOS) | 手動觸發排程 |

## 故障排除

### Claude CLI 未登入

**症狀**：執行 `claude` 提示 "Not authenticated"

**解決方案**：
```bash
claude login
claude --version
```

### Git Push 失敗

**症狀**：`git push` 提示 "permission denied" 或 "fatal: Authentication failed"

**解決方案**：
```bash
# 檢查 GitHub 個人令牌
gh auth status

# 重新驗證
gh auth login
```

### 排程沒有執行

**症狀**：18:00 沒有新的 commit

**解決方案**：
```bash
# macOS：檢查 launchd agent
launchctl list | grep ai-news-hub
launchctl load ~/Library/LaunchAgents/com.ai-news-hub.plist

# Linux：檢查 cron
crontab -l
crontab -e  # 編輯並確認排程

# 查看系統日誌
# macOS
log stream --predicate 'eventMessage contains "ai-news-hub"'

# Linux
journalctl -u cron -f
```

### 驗證率偏低（< 80%）

**症狀**：許多新聞未通過驗證

**解決方案**：
1. 檢查 `data/whitelist.json` 是否需要新增域名
2. 執行 `python src/validate.py latest.json --debug` 查看詳細日誌
3. 查看 GitHub Issues 中的驗證報告（自動生成）
4. 檢查網路連線（驗證 URL 存活需要網路）

### GitHub Pages 沒更新

**症狀**：訪問 Pages 仍顯示舊資料

**解決方案**：
1. 檢查 Settings → Pages → Source 是否正確設置為 `main` 分支
2. 強制重新整理瀏覽器（Ctrl+Shift+R 或 Cmd+Shift+R）
3. 檢查 `latest.json` 是否已推送到 GitHub：
   ```bash
   git log --oneline --name-only | head -20
   ```
4. 檢查 GitHub Actions 部署狀態：Settings → Pages → Deployments

## 常見問題

### Q: 為什麼使用 Claude CLI 而不是 API？

A: Claude Pro/Team 訂閱用戶已支付額度，使用 CLI 完全免費。API 需另外計費。

### Q: 每天執行 2 次會不會過量？

A: 不會。每次擷取僅需 2-3 個 Claude API 呼叫（受限於額度，不計費）。

### Q: 如何修改擷取時間？

A: 修改 `~/Library/LaunchAgents/com.ainewshub.daily.plist` 的 Hour/Minute 欄位，並執行 `launchctl unload/load` 重新載入。

### Q: 資料會永久保存嗎？

A: 每月自動歸檔到 `data/archives/`，Pages 上始終顯示最新 30 天的資料。

## 監控儀表板

前端自動顯示：

- ✅ **健康狀態**：資料就緒/驗證率/更新時間一目了然
- 🕐 **分類更新時間**：每個類別顯示獨立的最後更新時間
- 📊 **驗證統計**：通過 / 失敗 / 略過的新聞數
- 🔔 **更新通知**：每 15 分鐘靜默檢查，有新資料時自動刷新
- 📱 **響應式設計**：桌面 / 平板 / iPhone 全面適配

## 貢獻

1. Fork 此倉庫
2. 編輯 `data/whitelist.json` 新增信任域名
3. 編輯 `src/config.py` 新增擷取來源
4. 提交 Pull Request

## 授權

MIT License

## 更新日誌

### v4.8 (2026-04-18)

- 修復 Header 狀態列靠右：`.hdr-inner{width:100%}` 填滿全寬 + `.hdr-right{margin-left:auto}` 固定靠右
- 主分類 Tabs 移至 Header 同一列；Logo 固定靠左
- 主分類調整為 5 個（新增書籤），子頁籤 8 個；完整移除新興技術（emerging）分類

### v4.7 (2026-04-16)

- 新增 Agent 生態系搜尋（LangChain/LangGraph、CrewAI、OpenAI Agents SDK、Google ADK、Microsoft AutoGen/AGT、Semantic Kernel、LlamaIndex、Haystack、Pydantic AI、AWS Bedrock Agents、Vertex AI Agents、Dify）至全部 5 個 AI 新聞 prompt；前端 PRIORITY_KW 同步更新

### v4.6 (2026-04-16)

- 修復 git push 分歧問題（fetch + reset --soft 確保 fast-forward）；watchdog 1500s→900s；新增 AI Agent Engineering 搜尋主題（Context Engineering、Harness Engineering、Agent Orchestration、Agent Memory）至 papers/topnews/taiwan/china/usa 五個 prompt；前端 PRIORITY_KW 同步新增對應關鍵詞

### v4.5 (2026-04-14)

- 排程時間調整：07:00 起跑（喚醒 06:55），確保 09:00 前資料就緒
- macOS 相容 watchdog（600s）取代 Linux-only `timeout` 指令
- max-turns 15→30，確保 topnews 等多搜尋類別能完整輸出 JSON
- 重試次數 3→2，間隔 60→30s，類別間隔 30→10s
- 修復 openCards 初始化矛盾（資料重載後前 3 張卡片不再自動關閉）
- 修復 dayName() 無效日期返回 undefined

### v4.0.0 (2026-04-07)

- 每日/每週智慧分類排程（DOW-based）
- 每類別 `_updated_at` 時間戳 + 前端顯示
- `merge-stack.py` 模型/教學 累積合併去重
- `setup-prompts.sh` 批量生成 prompt 檔案
- 優先排序（LLM-as-a-Judge/Agent 等主題置頂）
- 歷史紀錄改為保留 7 天

### v3.1 (2026-04-05)

- Bug 修復：calendar icon、orphaned drawer、prompt 檔案

### v3.0 (2026-04-05)

- iPhone 響應式全面優化（安全區域、觸控、橫向滾動 Tab）

### v2.0 (2026-04-05)

- 擴充至 12 大類別

### v1.0.0 (2026-04-04)

- 首次發佈
- 完整的自動化擷取、驗證、部署流程
- GitHub Pages 前端
- 健康檢查和 Issue 通知
