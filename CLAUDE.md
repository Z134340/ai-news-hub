# AI News Hub — Cowork 專案技能（全自動版）

> **設計目標：首次部署後，永遠不需要手動操作。每天傍晚 18:00 擷取後打開網站就有最新資料。**

## 角色定位
AI 發展趨勢研究員，每日自動獲取第一手 AI 新聞。所有產出具備研究深度及資訊含金量，附來源網址與發佈時間。

## 核心原則
1. **真實性最優先**：URL 必須來自搜尋結果，禁止捏造。找不到就少收。
2. **深度優於廣度**：摘要需有技術細節、數據佐證、產業意義。
3. **雙語搜尋**：台灣/中國類別使用中英文搜尋。
4. **時效性**：topnews/taiwan/china/usa 限今天+昨天（max 2 天），techtrends/governance 限 7 天。超出範圍一律排除。累積類別（模型/教學/課程）搜尋近 3 個月。
5. **繁體中文輸出**：除了新聞標題、公司/模型/產品/人名等專有名詞保留原文外，所有摘要 (summary)、重點 (highlights)、說明均翻譯成繁體中文。
6. **新聞優先主題**：全球/台灣/中國/美國新聞優先 Agent、LLM、技術大廠模型及產品發布、模型及產品應用、資安新聞。

---

## 架構正規化（2026-06 更新，權威現況）

> 本節描述前端與儲存的「正規化後」現況，**優先於下方任何仍以單檔 index.html 描述的舊段落**。

### 前端：單檔 → 模組化（vanilla，零 build）
`index.html` 從 1,049 行單檔拆為「結構（107 行）+ `assets/css/app.css` + `assets/js/` 九個模組」。
皆為 **classic script、共用全域作用域**（維持 inline onclick 行為），載入順序**不可調換**：
`config → firebase → bookmarks → search → render → ui → history → data → main`。
仍是純靜態，GitHub Pages 直接服務；相對路徑維持 project page base `/ai-news-hub/`；`.nojekyll` 保留。

### 儲存：混合冷熱分層（static + Firebase）
| 資料 | 儲存 | 說明 |
|------|------|------|
| 熱：latest + 近 7 天 archive | static JSON + Pages（不變） | 每次開頁讀，免費、已快取 |
| 冷：逾 7 天 archive | **Firestore `archives/{date}`** | 僅點歷史時讀；payload 為整日 JSON 字串 |
| 使用者：書籤 | **Firestore `users/{uid}`** | 跨 iPhone/桌面同步；Email/Password auth；offline-first（localStorage 為離線快取） |

Firebase 為**可選增強**：`assets/js/config.js` 的 `FIREBASE_CONFIG` 未填（`YOUR_*`）時全部優雅 no-op，網站照常以 localStorage 運作。設定見 `FIREBASE-SETUP.md`（書籤）、`ARCHIVE-SETUP.md`（冷封存）。
安全：`firestore.rules` — 書籤僅本人 uid 可讀寫；archives 公開讀、僅 writer uid 可寫（**scoped writer 最小權限**）。
冷封存寫入：`scripts/archive-to-firestore.mjs`（Node 零依賴 REST，writer 帳號登入）；`run-daily.sh` 歸檔後自動上傳逾 7 天並 prune 本機（偵測到 `~/.config/ai-news-hub/archiver.env` 才跑、失敗不刪）。
**機密界定**：`firebaseConfig` apiKey 是公開前端識別碼，**非機密**，可進 repo；`archiver.env`（writer 帳密）才是機密，off-repo + gitignore。

---

## 全自動架構

```
┌── 主力：本機排程（一天一次傍晚班，用 Claude 訂閱）──────┐
│                                                   │
│  17:55  macOS 自動喚醒（pmset）                    │
│  18:00  launchd 觸發 run-daily.sh                 │
│    ├→ 偵測 Claude CLI 登入狀態                     │
│    ├→ 擷取 7/10 類別（每個重試 1 次，10分鐘逾時）   │
│    ├→ 合併 latest.json                            │
│    ├→ validate.py 八步驟驗證（URL + 標題一致性）    │
│    ├→ git push [verified] / [unverified]          │
│    └→ 寫入 data/health.json                       │
│  ~18:56  完成（正常）/ ~19:20（偶爾逾時）           │
│                                                   │
├── 健康檢查：GitHub Actions（本機沒跑時標記）─────────┤
│                                                   │
│  19:30  檢查 latest.json 時間戳                    │
│    ├→ 近 1 小時內有更新 → 跳過                      │
│    └→ 超過 1 小時沒更新 → 標記 missed              │
│                                                   │
├── 保活：每月 1 號 keep-alive commit ───────────────┤
│                                                   │
└── 前端：自動載入 + 健康監控 + iPhone 響應式 ────────┘
│                                                   │
│  ~19:00  你打開網站（iPhone / 桌面）                 │
│    ├→ 自動載入 latest.json                         │
│    ├→ Header 顯示更新時間 + 驗證率 + 健康狀態       │
│    └→ 每 15 分鐘靜默檢查新版                       │
└───────────────────────────────────────────────────┘
```

---

## 專案結構

```
ai-news-hub/
├── .nojekyll                        ← 禁用 Jekyll（確保 JSON 直接送達）
├── index.html                       ← 只剩結構（107 行）+ link css + script src
├── firebase.json                    ← Firestore 規則部署設定
├── firestore.rules                  ← users（書籤）+ archives（冷封存）安全規則
├── FIREBASE-SETUP.md                ← 書籤雲端同步設定指南
├── ARCHIVE-SETUP.md                 ← 過期新聞冷封存設定指南
├── HANDOFF.md                       ← 交接狀態（done/pending/勿動/checklist）
├── CLAUDE.md  /  SKILL.md  /  README.md
├── assets/
│   ├── css/app.css                  ← 全部樣式
│   └── js/                          ← classic scripts，載入順序固定
│       ├── config.js                ← 常數/icons/helpers/state/FIREBASE_CONFIG
│       ├── firebase.js              ← 書籤雲端同步 + 冷封存讀取（可選）
│       ├── bookmarks.js  search.js  render.js  ui.js
│       ├── history.js               ← 冷熱合併歷史（static + Firestore）
│       ├── data.js                  ← 資料載入 + 自動更新偵測
│       └── main.js                  ← 啟動序列
├── .github/workflows/
│   ├── health-check.yml  keep-alive.yml  notify.yml
├── scripts/
│   ├── run-daily.sh                ← 每日擷取主腳本（含 DOW 排程 + 冷封存上傳）
│   ├── validate.py  extract-json.py  merge-stack.py
│   ├── setup-prompts.sh  setup-scheduler.sh  supplement-run.sh
│   ├── archive-to-firestore.mjs    ← 冷封存上傳（Node 零依賴 REST，scoped writer）
│   ├── repo-slim.sh                ← 一次性 repo 瘦身（本機跑）
│   └── prompts/  (10 個 .md，含 courses.md)
├── data/
│   ├── latest.json  index.json  health.json
│   ├── YYYY-MM-DD.json             ← 近 7 天熱層；逾期自動搬 Firestore archives/
│   └── logs/
└── （off-repo）~/.config/ai-news-hub/archiver.env  ← writer 帳密，絕不進 git
```

## 資料流完整路徑（從產出到你眼前）

```
run-daily.sh 產出 data/latest.json
       │
       ▼
git add data/ → git commit → git push origin main
       │
       ▼
GitHub 收到 push → 觸發 Pages 部署（約 1-3 分鐘）
       │
       ▼
GitHub Pages CDN 更新靜態檔案
       │
       ▼
你打開 https://你的帳號.github.io/ai-news-hub/
       │
       ▼
index.html 載入 → fetch("data/latest.json?v=" + Date.now())
       │                   ↑ cache-busting 參數，強制繞過快取
       ▼
JSON 解析 → 渲染十大類別卡片 → 你看到最新資料 ✅
```

### 關鍵防快取機制

1. **`.nojekyll` 檔案**（空檔案放在根目錄）：
   - 禁用 GitHub Pages 的 Jekyll 靜態網站產生器
   - 確保 JSON 檔案不被 Jekyll 過濾或延遲處理
   - 確保 data/ 目錄下的所有 .json 檔案直接作為靜態資源送達

2. **Cache-busting 請求**：
   - index.html 中所有 fetch JSON 的請求附加 `?v={timestamp}` 參數
   - 例：`fetch("data/latest.json?v=1743753600000")`
   - 每次開啟頁面產生新 timestamp，強制繞過瀏覽器和 CDN 快取
   - 歷史 JSON 也用相同機制：`fetch("data/2026-04-04.json?v=...")`

3. **30 分鐘自動重新檢查**也帶 cache-busting 參數

---

## 時區與排程（每日 + 每週分類排程）

| 項目 | 時間 |
|------|------|
| macOS 喚醒 | 17:55 |
| 擷取排程 | 18:00 |
| 預期完成 | ~18:56（正常）/ ~19:20（偶爾逾時）|
| 你查看 | **傍晚 19:00 後 / 隔天** |

| 項目 | 設定 |
|------|------|
| 時區 | Asia/Taipei (UTC+8) |
| 健康檢查 | 19:30（GitHub Actions） |
| 保活 | 每月 1 號 |

### 每日 vs 每週分類排程（DOW-based）

依星期幾（`date +%u`）決定擷取範圍：

| 類型 | 分類 | 頻率 |
|------|------|------|
| 每日 | papers, topnews, taiwan, china, usa, techtrends, governance | 每天擷取 |
| 每週 | models, tutorials, courses | 僅週一擷取 |

**週一（DOW=1）：** 擷取全部 10 個類別（含每週類別），執行 `merge-stack.py` 累積合併
**週二至週日（DOW=2-7）：** 僅擷取 7 個每日類別，每週類別保留上次 `latest.json` 中的資料與時間戳

### `_updated_at` 每類別時間戳

`latest.json` 新增 `_updated_at` 欄位，記錄每個類別最近一次實際擷取的時間：

```json
{
  "date": "2026-04-07",
  "time": "...",
  "data": { ... },
  "_updated_at": {
    "papers": "2026-04-07T07:35:00+08:00",
    "topnews": "2026-04-07T07:38:00+08:00",
    "models": "2026-04-07T07:50:00+08:00",
    ...
  }
}
```

非週一時，每週類別的 `_updated_at` 保留上週一的時間戳，前端據此顯示「（每週一更新）」提示。

---

## 十大分類規範

### 1. 📄 AI 論文發表 (`papers`)
**機構（12）：** Google DeepMind, OpenAI, Google Research/Brain, Meta AI (FAIR), Stanford, MIT CSAIL, UC Berkeley BAIR, Microsoft Research, Tsinghua, CMU, Anthropic, Apple
**頂會（12）：** NeurIPS, ICML, ICLR, CVPR, ICCV, ECCV, ACL, EMNLP, NAACL, SIGGRAPH, AAAI, IJCAI
**平台：** arxiv.org, Papers with Code, Hugging Face Papers, Semantic Scholar
**優先主題（排序固定）：** 🥇 LLM-as-a-Judge / LLM 評估 → 🥇 Agent 評估 / AgentBench → 🥇 AI Agent Engineering（Context Engineering / Harness Engineering / Agent Memory / Orchestration）→ 🥇 AI Agent / Multi-agent 研究 → 🥈 LLM 新架構/訓練 → 🥉 其他頂尖論文
**搜尋策略：** 先用具體 arxiv Query 搜尋優先主題（含 context engineering、agent harness、agent workflow、tool use），再擴大搜尋其他論文
**欄位：** title, authors, institution, venue, date, summary(4-5句技術摘要含數字), url, field, impact

### 2. 🔥 全球熱門 AI 新聞 Top 20 (`topnews`)
**來源：** TechCrunch, The Verge, VentureBeat, Wired, MIT Tech Review, Bloomberg, Reuters, Ars Technica, The Information, Hacker News, Latent Space, Import AI, The Gradient, Arxiv Sanity, 各大 AI 公司 Blog, LangChain blog, CrewAI blog, Microsoft AutoGen GitHub, Hugging Face, Papers with Code, AI Feed
**優先主題（排序固定）：** 🥇 AI Agent/Agentic/Multi-agent → 🥇 Agent Ecosystem & Frameworks（LangChain/LangGraph, CrewAI, OpenAI Agents SDK, Google ADK, Microsoft AutoGen/AGT, Semantic Kernel, LlamaIndex, Haystack, Pydantic AI, AWS Bedrock Agents, Vertex AI Agents）→ 🥇 AI Agent Engineering（Context Engineering / Harness Engineering / Agent Orchestration / Agent Memory）→ 🥇 LLM 新模型發布 → 🥇 技術大廠新產品/模型 → 🥈 AI 資安 → 🥉 其他
**搜尋策略：** 先以具體 Query 搜尋優先主題（含各 Agent 框架名稱、context engineering、harness engineering），再擴大搜尋其他新聞
**欄位：** title, source, date, domain, model_area, summary(4-6句), highlights, url

### 3. 🇹🇼 台灣 AI 熱議 Top 20 (`taiwan`)
**媒體：** 科技新報, iThome, 數位時代/SmartM, 中央社 CNA, DIGITIMES, INSIDE 硬塞的網路趨勢觀察, AI 郵報 (AI Post Hub), AI人工智慧網, 科技報橘, PanSci, AI Academy, 資策會 FIND/ITRI
**社群：** LinkedIn, Medium, YouTube(AI Reading Club/泛科學), PTT Tech_Job/Soft_Job, Dcard AI版, X 台灣 AI 工程師圈
**語言：** 繁中+英文搜尋，繁中摘要
**優先主題（排序固定）：** 🥇 AI Agent/Agentic/Multi-agent 在台灣 → 🥇 Agent Ecosystem & Frameworks（LangChain/LangGraph, CrewAI, OpenAI Agents SDK, Google ADK, AutoGen/AGT）→ 🥇 AI Agent Engineering（Context Engineering / Harness Engineering）→ 🥇 LLM 模型發布/更新 → 🥇 技術大廠新產品/模型在台灣動態 → 🥈 AI 資安 → 🥉 其他台灣 AI 產業
**搜尋策略：** 先以具體中英文 Query 搜尋優先主題（含各 Agent 框架、context engineering、agent 工程），再擴大搜尋其他新聞
**欄位：** title(繁中), source, date, topic, summary(繁中), relevance, discussion, url

### 4. 🇨🇳 中國 AI 熱議 Top 20 (`china`)
**來源：** 机器之心, 量子位, 36氪, Baidu/Alibaba/Tencent/ByteDance, SenseTime, Huawei, DeepSeek, Moonshot, Baichuan, 01.AI, MiniMax, Zhipu, Tsinghua, Zhihu, MIIT/MOST, Dify.AI
**語言：** 簡中+英文
**優先主題（排序固定）：** 🥇 AI Agent/智能體/Multi-agent → 🥇 Agent Ecosystem & Frameworks（LangChain/LangGraph, CrewAI, OpenAI Agents SDK, Google ADK, AutoGen/AGT, Dify, 國內 Agent 框架）→ 🥇 AI Agent Engineering（Context Engineering / 上下文工程 / Agent 編排 / Agent 記憶管理）→ 🥇 中國 LLM 新模型（DeepSeek/Qwen/GLM/Baichuan/Yi 等） → 🥇 技術大廠新產品/模型 → 🥈 AI 資安 → 🥉 其他中國 AI 動態
**搜尋策略：** 先以具體中英文 Query 搜尋優先主題（含各 Agent 框架、context engineering、智能體工程），再擴大搜尋其他新聞
**欄位：** title, source, date, company, topic, summary, discussion, url

### 5. 🇺🇸 美國 AI 熱議 Top 20 (`usa`)
**來源：** OpenAI, Google/DeepMind, Anthropic, Meta, Microsoft, Apple, AWS, NVIDIA, xAI, Cohere, LangChain, CrewAI, AI Business, AI Magazine, The Rundown AI, US AI 政策(White House/Congress/FTC/NIST), Stanford HAI, MIT, X/Reddit/HN, VentureBeat, TechCrunch, The Information
**優先主題（排序固定）：** 🥇 AI Agent/Agentic/Multi-agent → 🥇 Agent Ecosystem & Frameworks（LangChain/LangGraph, CrewAI, OpenAI Agents SDK, Google ADK, Microsoft AutoGen/AGT, Semantic Kernel, LlamaIndex, Haystack, Pydantic AI, AWS Bedrock Agents, Vertex AI Agents）→ 🥇 AI Agent Engineering（Context Engineering / Harness Engineering / Agent Orchestration / Agent Memory）→ 🥇 LLM 新模型發布 → 🥇 技術大廠新產品/模型 → 🥈 AI 資安 → 🥉 其他美國 AI 動態
**搜尋策略：** 先以具體 Query 搜尋優先主題（各 Agent 框架 blog/GitHub + agent engineering + context engineering + LLM + 資安），再擴大搜尋
**欄位：** title, source, date, topic, summary, highlights, discussion, url

### 6. 📈 技術趨勢 Top 20 (`techtrends`)
**來源：** Deloitte 勤業眾信, KPMG 安侯建業, PwC 資誠, EY 安永, BCG 波士頓諮詢, McKinsey 麥肯錫, IDC, Gartner, Forrester, 數位時代, TechCrunch, VentureBeat, MIT Technology Review
**欄位：** title, source, date, category, summary(4-6句), highlights, url

### 7. ⚖️ 科技治理 Top 20 (`governance`)
**來源：** MIT Technology Review, OWASP, 台灣金融監督管理委員會 (FSC), 數位發展部 (moda.gov.tw), 國發會 (NDC), Reuters, Bloomberg, iThome, 中央社 CNA, 科技新報
**焦點：** AI 治理, Agent/代理式 AI 治理, AI 安全標準, 金管會金融 AI 政策, 數位發展部政策, EU AI Act, NIST 指南
**語言：** 繁中+英文搜尋
**欄位：** title, source, date, category, summary(4-6句), highlights, url

### 8. 🛠️ AI 工具教學 Top 20 (`tutorials`)
**來源：** iThome, AI 郵報 (AI Post Hub), Medium, YouTube, 科技新報, 數位時代, INSIDE, OpenAI Blog, Anthropic Blog, Google AI Blog, Hugging Face Blog, LangChain Blog
**焦點：** AI 工具實戰教學, Prompt 工程, LLM 應用開發, AI Agent 建構, RAG 實作, 微調指南
**欄位：** title, source, date, tool_name, difficulty(beginner/intermediate/advanced), category, summary(4-6句), highlights, url

### 9. 🎓 AI 官方課程/證照 (`courses`)
**來源：** Coursera, edX, DeepLearning.AI, Google Cloud Skills Boost, Microsoft Learn, AWS Training, NVIDIA DLI, OpenAI, Anthropic, Meta AI, Stanford Online, MIT OCW, iThome, 科技新報
**焦點：** 免費官方 AI/LLM/Agent 課程, 專業 AI 證照, 大學 AI 課程
**欄位：** title, source, date, provider, is_free, cert_included, level, duration, topics, summary(4-6句), highlights, url

### 10. 🚀 最近模型發布快訊 (`models`)
**時間範圍：** 近 3 個月內發布的模型（不限於本週/本月）
**來源：** Papers with Code SOTA, Hugging Face, Latent Space, Import AI, The Gradient, 各大 AI Blog, AI Feed, LMSYS, Open LLM Leaderboard, GitHub Trending, 中國模型(DeepSeek/Qwen/Baichuan/GLM/Yi)
**筆數上限：** 20 筆
**欄位：** model_name, version, institution, release_date, domain, summary(5-6句), advantages, benchmarks(含數字), highlights, url

---

## data/latest.json 格式

```json
{
  "date": "YYYY-MM-DD",
  "time": "ISO 8601 (Asia/Taipei)",
  "generated_at": "07:48",
  "source": "local",
  "data": { "papers":[], "topnews":[], "taiwan":[], "china":[], "usa":[], "techtrends":[], "governance":[], "tutorials":[], "courses":[], "models":[] },
  "stats": { "papers":0, "topnews":0, "taiwan":0, "china":0, "usa":0, "techtrends":0, "governance":0, "tutorials":0, "courses":0, "models":0 },
  "_updated_at": { "papers":"ISO 8601", "topnews":"ISO 8601", ... },
  "validation": { "total":0, "verified":0, "warnings":0, "removed":0, "pass_rate":"95%" }
}
```

`_updated_at` 欄位為各類別最後一次成功擷取的時間戳。非週一時，每週類別 (models/tutorials/courses) 的時間戳保留自上一次週一擷取。

## data/health.json 格式

```json
{
  "last_run": "ISO 8601",
  "last_success": "ISO 8601",
  "last_date": "YYYY-MM-DD",
  "source": "local",
  "status": "ok|partial|failed|missed|not_run",
  "categories_ok": 7,
  "categories_failed": 0,
  "validation_pass_rate": "95%",
  "consecutive_failures": 0,
  "last_missed": null,
  "errors": []
}
```

---

## run-daily.sh 規範

### 啟動前檢查（靜默，不中斷）
1. 檢查 Claude CLI 登入狀態：`claude auth status 2>/dev/null`
   - 已登入 → 繼續
   - 未登入/過期 → 記錄錯誤到 health.json，腳本結束
2. 檢查網路：`curl -s --max-time 5 https://api.anthropic.com > /dev/null`
   - 正常 → 繼續
   - 失敗 → 記錄錯誤，腳本結束
3. 檢查 Git 認證：`git ls-remote origin HEAD > /dev/null 2>&1`
   - 正常 → 繼續
   - 失敗 → 記錄「Git 認證過期，請執行 git credential approve 或重新設定 SSH key」

### 時區
`export TZ=Asia/Taipei`，所有 date 指令加 TZ。

### 星期判斷 & 分類排程

```bash
DOW=$(date +%u)  # 1=週一 7=週日
DAILY_CATS=(papers topnews taiwan china usa techtrends governance)
WEEKLY_CATS=(models tutorials courses)

if [[ "$DOW" -eq 1 ]]; then
    CATEGORIES=( "${DAILY_CATS[@]}" "${WEEKLY_CATS[@]}" )
else
    CATEGORIES=( "${DAILY_CATS[@]}" )
fi
```

每個類別成功擷取後，注入 `_updated_at` 時間戳至該類別 JSON：
```python
now = datetime.now(timezone(timedelta(hours=8))).isoformat()
if isinstance(d, list):
    d = {'items': d, '_updated_at': now}
elif isinstance(d, dict):
    d['_updated_at'] = now
```

### 擷取流程

**claude CLI 呼叫方式（⚠️ 關鍵 Bug Fix #1）：**
```bash
TODAY_DATE=$(date +%Y-%m-%d)
PROMPT_WITH_DATE="Today's date is ${TODAY_DATE}. Please prioritize news from today and the past 24-48 hours.

$(cat scripts/prompts/${CAT}.md)"

# macOS 相容 timeout（無 timeout 指令，用 watchdog 代替）
"$CLAUDE_BIN" -p "$PROMPT_WITH_DATE" \
  --max-turns 30 \
  --output-format text \
  --allowedTools "WebSearch" \
  2>>"$LOG_FILE" > "$TMP_FILE" &
CLAUDE_PID=$!
( sleep 600 && kill -TERM "$CLAUDE_PID" 2>/dev/null ) &
WATCHDOG_PID=$!
wait "$CLAUDE_PID" 2>/dev/null || true
kill -TERM "$WATCHDOG_PID" 2>/dev/null
wait "$WATCHDOG_PID" 2>/dev/null || true
```
- `--max-turns 30`：topnews 等需要 9+ 次搜尋的類別，15 turns 不足以完成並產出 JSON
- `--output-format text`：確保輸出純文字，方便 JSON 提取
- **macOS 無 `timeout` 指令**：必須用背景執行 + watchdog kill 模式（⚠️ Bug Fix #12）
- watchdog 600 秒（10 分鐘）：確保最壞情況下 8 類 × 20.5 分 = 19:14 前完成

**JSON 提取（⚠️ Bug Fix #7）：**
不要用單行 python，使用完整腳本處理 claude 的多段回應：
```python
import json, re, sys
raw = sys.stdin.read()
# claude 可能回傳多段文字（思考 + 搜尋 + 最終回答）
# 需要找到最後一個完整的 JSON 物件
matches = list(re.finditer(r'\{[^{}]*"items"\s*:\s*\[[\s\S]*?\]\s*\}', raw))
if matches:
    data = json.loads(matches[-1].group())
    items = data.get("items", [])
    json.dump(items, sys.stdout, ensure_ascii=False, indent=2)
else:
    # fallback：找任何 JSON 物件
    m = re.search(r'\{[\s\S]*\}', raw)
    if m:
        try:
            data = json.loads(m.group())
            items = data.get("items", [])
            json.dump(items, sys.stdout, ensure_ascii=False, indent=2)
        except json.JSONDecodeError:
            json.dump([], sys.stdout)
    else:
        json.dump([], sys.stdout)
```
將此邏輯存為 `scripts/extract-json.py`，擷取時用：
`cat tmp_file | python3 scripts/extract-json.py > data/${CAT}.json`

**重試與間隔：**
- 每個類別最多 2 次嘗試（初始 + 重試 1 次），重試等待 30 秒
- 2 次都失敗 → 記錄錯誤，echo '[]' > data/${CAT}.json，繼續下一個
- 類別間隔 10 秒

### 模型/教學 累積合併（僅週一）
- 週一：執行 `python3 scripts/merge-stack.py` 合併今日與歷史資料，dedup + 加入 is_new/is_expired/first_seen/last_seen 欄位
- 非週一：跳過，保留上次資料
- Dedup 鍵值：models=(model_name, version, institution)，tutorials=(title, source, url)
- tutorials 僅保留近 3 個月資料，按 date 最新排序
- 支援 `--dry-run` 模式

### 合併 latest.json
- python3 合併為 latest.json（含 source: "local"，含 `_updated_at` 各類別時間戳）
- 非週一：每週類別 (models/tutorials/courses) 從舊 latest.json 讀取，保留原始 `_updated_at` 時間戳
- 週一：所有 11 類別從當日擷取的 JSON 讀取

### 驗證 + 歸檔
- python3 scripts/validate.py 八步驟驗證
- 歸檔日期 JSON + 更新 index.json（保留 7 天）

### 健康狀態
- 每次執行後更新 data/health.json
- 成功時：status="ok"，consecutive_failures=0
- 部分成功：status="partial"
- 全失敗：status="failed"，consecutive_failures +1
- 記錄 categories_ok/failed、驗證率、錯誤訊息

### Log 清理（⚠️ Bug Fix #11）
```bash
find "$DATA_DIR/logs" -name "*.log" -mtime +7 -delete 2>/dev/null
find "$DATA_DIR/logs" -name "validate-*.json" -mtime +7 -delete 2>/dev/null
```
每次執行時自動清理 7 天前的 log 和驗證報告。

### Git 推送（⚠️ Bug Fix #8）
```bash
git pull --rebase origin main 2>/dev/null || git pull origin main
git add data/
git diff --staged --quiet && exit 0  # 無變更則結束

# 驗證率 100% → [verified]，否則 [unverified]
PASS_RATE=$(python3 -c "import json; d=json.load(open('data/latest.json')); print(d.get('validation',{}).get('pass_rate','0%').replace('%',''))" 2>/dev/null || echo 0)
TAG="[verified]"
python3 -c "exit(0 if float('${PASS_RATE}') >= 100 else 1)" 2>/dev/null || TAG="[unverified]"

git commit -m "📰 AI News YYYY-MM-DD ${TAG}"
# 推送重試 3 次
for i in 1 2 3; do
  git push origin main && break
  if [ $i -eq 3 ]; then
    echo "❌ Git push 失敗，可能需要重新設定認證" >> "$LOG_FILE"
  fi
  sleep 5
done
```

### Email 通知（全自動，零設定）

**機制：** Git push 成功後，GitHub Actions 自動觸發 `notify.yml`：
1. 偵測 `data/latest.json` 變更
2. 讀取 JSON，產生 Markdown 摘要
3. 建立 GitHub Issue（標題含日期/早午班/筆數/驗證率）
4. Issue 內容：十大類別各自的筆數 + 前 3 筆標題（含連結）+ 網站 CTA
5. 自動關閉 7 天前的舊 Issue
6. GitHub 內建通知系統自動寄 Email 給 repo owner

**不需要：** App Password、Gmail 設定、任何額外帳號
**需要確認：** GitHub → Settings → Notifications → Email 已勾選 Issues

**通知 Issue 標題格式：**
`✅ AI News 2026-04-04 🌆 午班 · 68 筆 · 驗證 96%`

**Label：** `ai-news-daily`（自動建立）

### 完全靜默
- 所有輸出導向 data/logs/YYYY-MM-DD.log
- 不需要任何人工互動
- 不會彈出視窗或提示

---

## validate.py 規範

八步驟驗證（詳細規範）：

**前置檢查（⚠️ Bug Fix #2）：**
```python
import os, sys
path = "data/latest.json"
if not os.path.exists(path):
    print("⚠️ latest.json 不存在，跳過驗證")
    sys.exit(0)
try:
    data = json.load(open(path))
except json.JSONDecodeError:
    print("❌ latest.json 格式錯誤")
    sys.exit(1)
```

**Step 1 — URL 存活檢測（⚠️ Bug Fix #3）：**
- 優先 HTTP HEAD 請求，timeout=10s
- 若 HEAD 回傳 405 Method Not Allowed → 改用 GET + stream（只讀 header 不下載 body）
- User-Agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
- concurrent.futures.ThreadPoolExecutor(max_workers=5)
- 每批次間隔 0.5 秒
- 判斷邏輯：
  · 2xx/3xx → verified: true
  · 403 → needs_review（不移除，某些網站正常擋 bot）
  · 405 → 已用 GET 重試，依 GET 結果判斷
  · 404/410 → verified: false → 移除
  · 5xx → verified: false → 移除
  · 超時/DNS 錯誤/ConnectionError → verified: false → 移除
  · URL 格式不合法 → verified: false → 移除
```python
def check_url(url):
    try:
        req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': UA})
        resp = urllib.request.urlopen(req, timeout=10)
        return resp.status
    except urllib.error.HTTPError as e:
        if e.code == 405:
            # HEAD 不支援，改 GET
            try:
                req = urllib.request.Request(url, headers={'User-Agent': UA})
                resp = urllib.request.urlopen(req, timeout=10)
                return resp.status
            except:
                return e.code
        return e.code
    except Exception:
        return 0  # 連線失敗
```

**Step 2 — 標題一致性檢測（反幻覺核心）：**
- 對 verified URL 抓取頁面內容，提取 `<title>` 或 `<h1>` 標籤
- 計算頁面標題與新聞 title 欄位的相似度（SequenceMatcher）
- 評分規則：
  · score ≥ 0.3 → 通過（允許翻譯差異與摘要改寫）
  · 0 < score < 0.3 → needs_review（標記但不移除，paywall/動態頁面等）
  · score = 0（完全無法對應）→ verified: false → 移除
- needs_review 計入 pass_rate（不扣分）
- 特例：TITLE_CHECK_RELAXED_DOMAINS（arxiv, medium, 中文媒體等）跳過標題比對
```python
TITLE_CHECK_RELAXED_DOMAINS = [
    "arxiv.org", "medium.com", "ithome.com.tw", "technews.tw",
    "digitimes.com", "inside.com.tw", "cna.com.tw", "nikkei.com",
]
def title_similarity(title_a, title_b):
    from difflib import SequenceMatcher
    a = re.sub(r'[^\w\s]', '', title_a.lower())
    b = re.sub(r'[^\w\s]', '', title_b.lower())
    return SequenceMatcher(None, a, b).ratio()
```

**Step 3 — 域名白名單**（同前）

**Step 4 — 欄位完整性**（同前）

**Step 5 — 日期合理性**
- 格式驗證 YYYY-MM-DD（用 try/except datetime.strptime）
- 各類別分別設定 max_days（CATEGORY_DATE_LIMITS）：
  · topnews/taiwan/china/usa → max_days=2（今天+昨天）
  · techtrends/governance → max_days=7
  · papers/tutorials/courses → max_days=90
  · models → allow_future（允許未來日期，最多 2 年前）
```python
CATEGORY_DATE_LIMITS = {
    'papers': 90, 'topnews': 2, 'taiwan': 2, 'china': 2, 'usa': 2,
    'techtrends': 7, 'governance': 7, 'tutorials': 90, 'courses': 90, 'models': None,
}
def validate_date(date_str, allow_future=False, no_limit=False, max_days=90):
    ...
    if parsed_date > today + timedelta(days=1) or parsed_date < today - timedelta(days=max_days):
        return False, 'date_out_of_range'
```

**Step 6 — 重複檢測**（同前）

**Step 7 — 驗證報告** → `data/logs/validate-YYYY-MM-DD.json`

**Step 8 — 自動修復**
- 移除 verified: false 項目
- 注入 verified/verified_at/url_status/complete 欄位
- 更新 stats 和 validation 摘要
- 覆寫 latest.json + 日期歸檔

接受參數：無參數=完整驗證，--category X=單類別，--dry-run=只報告
全部 try/except 包裹，不因單一項目中斷。

---

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

## index.html 前端 UX 規範

### 載入
- 開啟 → 骨架屏 shimmer → fetch latest.json?v={Date.now()} → 淡入內容
- **health.json 並行載入，但 404 時靜默忽略（⚠️ Bug Fix #5）**：
  ```javascript
  const healthData = await fetch("data/health.json?v=" + Date.now())
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);
  // healthData 為 null 時，Header 不顯示健康指標，不影響主功能
  ```
- **latest.json 不存在（首次部署 / 404）→ 顯示友善提示「🕐 首次部署完成，等待明日 18:00 首次擷取」+ 手動擷取按鈕**
- **fetch 失敗（網路錯誤）→ 顯示「⚠️ 無法載入資料」+ 重試按鈕（3 秒後自動重試一次）**

### Header 健康儀表板（全寬單列佈局）
- 左側：Logo + 標題 + 日期
- 中間：主分類 Tab（sec-tabs，`flex:1` 置中）
- 右側（永遠靠右）：狀態膠囊 + 驗證率 + 更新時間 + 搜尋
- **CSS 關鍵**：`.hdr-inner{width:100%}` 確保容器全寬；`.hdr-right{margin-left:auto}` 固定靠右端
  · 🟢 綠色脈動 = 今日資料已就緒 + 驗證率 ≥ 90%
  · 🟡 黃色 = 今日資料已就緒但驗證率 < 90%
  · 🔴 紅色 = 資料非今日（排程可能沒跑）

### 優先排序規則
- 論文研討、AI 新聞（含子分類）、模型快訊啟用「主題優先排序」
- 優先關鍵字：LLM-as-a-Judge, LLM/Agent evaluation, AgentBench, SWE-bench, agentic, multi-agent, benchmark, 評測, cybersecurity/資安, model release/模型發布, 技術大廠名（OpenAI, Anthropic, Google, Meta, Microsoft, NVIDIA, Apple, AWS, Gemini, GPT, Claude, LLaMA, Mistral）
- 排序邏輯：先依優先主題分組（匹配者在前），組內依日期由新到舊
- 資料非今日 → 頂部固定橙色橫幅：「⚠️ 今日資料尚未更新（上次：YYYY-MM-DD），電腦上線後將自動補跑。」
- health.json status === "missed" → 紅色橫幅：「🔴 昨日排程未執行，請確認電腦是否有開機。」

### 自動更新偵測（⚠️ Bug Fix #9）
- 每 **15 分鐘**靜默 fetch latest.json?v={Date.now()}（排程每日傍晚一次，較頻繁檢查以利補跑後即時更新）
- **使用鎖定機制防止疊加**：
  ```javascript
  let isChecking = false;
  setInterval(async () => {
    if (isChecking) return;
    isChecking = true;
    try {
      const r = await fetch("data/latest.json?v=" + Date.now());
      if (!r.ok) return;
      const j = await r.json();
      if (j.time !== currentTime) showUpdateBanner();
    } catch {} 
    finally { isChecking = false; }
  }, 15 * 60 * 1000);
  ```
- time 變更 → 頂部滑入藍色提示「📰 新資料已到，點擊重新載入」
- 點擊 → 平滑更新，不閃爍
- **比對 time（非 date）**：若當日有補跑（supplement-run），time 會變而 date 不變，用 time 欄位才能偵測到該次更新

### 分類更新時間顯示
- 每個分類頁面標題下方顯示該類別的最後更新時間（`_updated_at`）
- 格式：`🕐 更新 MM/DD HH:mm`
- 每週類別若資料非今日，額外顯示「（每週一更新）」灰色提示
- 前端邏輯：`DATA._updated_at[catId]`，fallback 到 `DATA.time`

### 五大分類頁籤 + 八個子頁籤
📄 論文研討 ｜ 📰 AI新聞（🔥全球熱門·🇹🇼台灣熱議·🇨🇳中國熱議·🇺🇸美國熱議·📈技術趨勢·⚖️科技治理·🛠️AI工具教學·🎓AI官方課程/證照）｜ 🚀 模型快訊 ｜ 🔖 書籤 ｜ 📅 歷史紀錄

### 卡片設計
- 前 3 展開，其餘收合
- 展開：max-height transition 300ms + scroll to top (offset 80px)
- 右上角：✅ verified / ⚠️ needs_review
- 各類別色系：論文藍紫/全球金/台灣綠/中國紅/美國藍/模型紫線

### 響應式（iPhone 優化）
- 桌面 >768px / 平板 ≤768px / 手機 ≤480px / iPhone SE ≤370px
- `viewport-fit=cover` + `env(safe-area-inset-*)` 適配 iPhone 瀏海/Dynamic Island
- `apple-mobile-web-app-capable` + `theme-color: #06080f` PWA 支援
- 主分類 Tab 手機端改為橫向滾動，觸控優化（`touch-action: manipulation`）
- Sub-tab 自動 scrollIntoView 到當前選中項
- Sticky header + tabs 高度由 JS 動態計算（`updateStickyOffsets`）
- 消除 iOS 300ms 點擊延遲、tap highlight 閃爍
- Sub-tabs 加入 `backdrop-filter` 模糊效果

### 技術
- Vanilla JS，零依賴，SVG Sprite 內嵌（含 calendar icon）
- 色彩：bg #06080f, surface #0d1117, card #111822, accent #818cf8

---

## 常用指令（部署後通常不需使用）

| 指令 | 用途 | 何時用 |
|------|------|--------|
| `/preflight` | 部署前環境檢查 | 僅首次 |
| `/deploy` | 完整部署 | 僅首次 |
| `/schedule` | 安裝排程+喚醒 | 僅首次 |
| `/fetch` | 手動擷取 | 排程沒跑時 |
| `/fetch {cat}` | 擷取單一類別 | 臨時需要 |
| `/validate` | 手動驗證 | 可疑時 |
| `/validate --fix` | 驗證+修復 | 連結壞掉時 |
| `/status` | 查看狀態 | 排查問題時 |
