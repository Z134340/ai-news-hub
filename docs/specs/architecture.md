<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

## 架構正規化（2026-09-18 核對載入順序）

> 本節描述前端與儲存的「正規化後」現況，**優先於下方任何仍以單檔 index.html 描述的舊段落**。

### 前端：單檔 → 模組化（vanilla，零 build）
`index.html` 已拆為頁面結構、全站共用主題 `assets/css/app.css`、儀表板布局 `assets/css/trend-briefing.css` 與 `assets/js/` 十三個本地模組（不含外部 Firebase SDK）；此處是模組清單與順序的唯一規範來源。
皆為 **classic script、共用全域作用域**（維持 inline onclick 行為），載入順序**不可調換**：
`config → personal-data → firebase → bookmarks → search → render → ui → history → data → trend-topics → trend-briefing → dashboard → main`。
仍是純靜態與相對路徑。正式站由 `scripts/build-site.mjs` 產生 allowlist `dist/`，再由 GitHub Actions 發布至 Cloudflare Pages。GitHub Pages 已於 2026-09-19 完成正常每日週期驗收後停用。正式部署狀態以 [deployment.md](deployment.md) 與 `HANDOFF.md` 證據為準；程式存在不代表已發布。

### 儲存：混合冷熱分層（static + Firebase）
| 資料 | 儲存 | 說明 |
|------|------|------|
| 熱：latest + 近 7 天 archive | static JSON + Cloudflare Pages | 每次開頁讀；屬唯讀發佈資產 |
| 冷：逾 7 天 archive | **Firestore `archives/{date}`** | 清單使用 REST 欄位投影與分頁；僅選擇日期才讀整日 payload |
| 使用者：書籤 | **Firestore `users/{uid}`** | 跨 iPhone/桌面同步；Email/Password auth；offline-first（localStorage 為離線快取） |

Firebase 為**可選增強**：`assets/js/config.js` 的 `FIREBASE_CONFIG` 未填（`YOUR_*`）時全部優雅 no-op，網站照常以 localStorage 運作。設定見 `FIREBASE-SETUP.md`（書籤）、`ARCHIVE-SETUP.md`（冷封存）。
安全：`firestore.rules` — 書籤僅本人 uid 可讀寫；archives 公開讀、僅 writer uid 可寫（**scoped writer 最小權限**）。
冷封存寫入：`scripts/archive-to-firestore.mjs`（Node 零依賴 REST，writer 帳號登入）；`run-daily.sh` 歸檔後自動上傳逾 7 天並 prune 本機（偵測到 `~/.config/ai-news-hub/archiver.env` 才跑、失敗不刪）。
**機密界定**：`firebaseConfig` apiKey 是公開前端識別碼，**非機密**，可進 repo；`archiver.env`（writer 帳密）才是機密，off-repo + gitignore。

---

## 全自動架構

```
┌── 主力：本機排程（一天一次早班，用 Claude 訂閱）────────┐
│                                                   │
│  09:55  macOS 自動喚醒（pmset）                    │
│  10:00  launchd 觸發 run-daily.sh                 │
│    ├→ 偵測 Claude CLI 登入狀態                     │
│    ├→ 每日更新 10 類，週一另加 2 類（單類逾時 20 分）│
│    ├→ 合併 latest.json                            │
│    ├→ validate.py 八步驟驗證（URL + 標題一致性）    │
│    ├→ 寫入 data/health.json（本機處理結果）       │
│    └→ git push [verified] / [unverified] ＋ receipt │
│  ~11:15  完成（正常）/ ~11:40（偶爾逾時）           │
│                                                   │
├── 健康檢查：GitHub Actions（本機沒跑時標記）─────────┤
│                                                   │
│  12:17  檢查 latest.json 日期                    │
│    ├→ 已涵蓋本次擷取日 → 跳過                      │
│    └→ 尚未涵蓋本次擷取日 → 標記 missed              │
│                                                   │
└── 前端：自動載入 + 健康監控 + iPhone 響應式 ────────┘
│                                                   │
│  ~11:30  你打開網站（iPhone / 桌面）                 │
│    ├→ 自動載入 latest.json                         │
│    ├→ Header 顯示更新時間 + 驗證率 + 健康狀態       │
│    └→ 每 15 分鐘靜默檢查新版                       │
└───────────────────────────────────────────────────┘
```

---

## 專案結構

```
ai-news-hub/
├── index.html                       ← 頁面結構 + link css + script src
├── firebase.json                    ← Firestore 規則部署設定
├── firestore.rules                  ← users（書籤）+ archives（冷封存）安全規則
├── wrangler.jsonc                   ← Cloudflare Pages 專案與輸出目錄
├── cloudflare/_headers              ← 靜態回應 cache／安全 headers
├── FIREBASE-SETUP.md                ← 書籤雲端同步設定指南
├── ARCHIVE-SETUP.md                 ← 過期新聞冷封存設定指南
├── HANDOFF.md                       ← 交接狀態（done/pending/勿動/checklist）
├── CLAUDE.md                       ← 共用開發規範與索引
├── AGENTS.md                       ← Codex 讀取共用規範的入口
├── README.md                       ← 專案介紹與操作入口
├── docs/specs/  docs/shapes/        ← 規格與程式速查
├── docs/legacy/                    ← 歷史文件（含舊 SKILL.md）
├── skills/                         ← Claude Code／Codex 共用專案技能；由 CLAUDE.md 索引
├── assets/
│   ├── css/app.css                  ← 共用色彩 tokens 與全站元件
│   ├── css/trend-briefing.css       ← 儀表板布局（引用共用 tokens）
│   └── js/                          ← classic scripts，載入順序固定
│       ├── config.js                ← 常數/icons/helpers/state/FIREBASE_CONFIG
│       ├── personal-data.js         ← 帳號快取、資料清理與刪除紀錄
│       ├── firebase.js              ← 書籤雲端同步 + 冷封存讀取（可選）
│       ├── bookmarks.js  search.js  render.js  ui.js
│       ├── history.js               ← 冷熱合併歷史（static + Firestore）
│       ├── data.js                  ← 資料載入 + 自動更新偵測
│       ├── trend-topics.js         ← 動態焦點純函式（公開新聞）
│       ├── trend-briefing.js        ← A 版畫面與互動
│       ├── dashboard.js            ← 趨勢儀表板
│       └── main.js                  ← 啟動序列
├── .github/workflows/
│   ├── health-check.yml  cloudflare-pages.yml  notify.yml
├── scripts/
│   ├── run-daily.sh                ← 每日擷取主腳本（含 DOW 排程 + 冷封存上傳）
│   ├── validate.py  extract-json.py  merge-stack.py
│   ├── setup-prompts.sh  setup-scheduler.sh  supplement-run.sh
│   ├── archive-to-firestore.mjs    ← 冷封存上傳（Node 零依賴 REST，scoped writer）
│   ├── build-site.mjs              ← 產生 Cloudflare allowlist dist/
│   ├── repo-slim.sh                ← 一次性 repo 瘦身（本機跑）
│   └── prompts/  (11 個 .md，含 official_info.md)
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
限定產物 commit → rebase origin/main → 普通 push（衝突停止）
       │
       ▼
GitHub 收到 push → 離線自測通過後觸發 Cloudflare Pages 部署
       │
       ▼
Cloudflare Pages CDN 更新 allowlist 靜態檔案
       │
       ▼
你打開 https://ai-news-hub-7jk.pages.dev/
       │
       ▼
index.html 載入 → fetch("data/latest.json?v=" + Date.now())
       │                   ↑ cache-busting 參數，強制繞過快取
       ▼
JSON 解析 → 渲染十二類資料卡片（企業生態系含兩個子分頁）→ 你看到最新資料 ✅
```

### 關鍵防快取機制

1. **Cloudflare cache headers**：
   - `cloudflare/_headers` 對 HTML 與 `data/*` 設定 `no-store`
   - `scripts/build-site.mjs` 只發布 allowlist 內的網站與資料檔

2. **Cache-busting 請求**：
   - index.html 中所有 fetch JSON 的請求附加 `?v={timestamp}` 參數
   - 例：`fetch("data/latest.json?v=1743753600000")`
   - 每次開啟頁面產生新 timestamp，強制繞過瀏覽器和 CDN 快取
   - 歷史 JSON 也用相同機制：`fetch("data/2026-04-04.json?v=...")`

3. **15 分鐘自動重新檢查**也帶 cache-busting 參數

---


## 個人資料與載入邊界（2026-09-18）

- 個人資料契約與相容限制只在 [personal-data.md](personal-data.md) 維護。
- `fetchJSON` 的逾時涵蓋 response body；靜態資料讀取獨立降級。新聞讀取失敗保留各新聞子頁容器，因此仍可切到歷史。
- 儀表板先呈現靜態資料，再補冷層摘要；冷層僅取最近最多 90 筆，完整歷史由歷史頁每次 31 筆逐頁載入。這是取得資料範圍，不能當作所有歷史總數。
- 冷層 REST 查詢只投影 `date/item_count/pass_rate/source`，以日期降冪和 exclusive cursor 分頁；摘要快取 5 分鐘。payload 不隨清單下載；服務失敗保留熱層並於歷史頁顯示重試。
- 每日 Git 整合、候選資料與失敗恢復見 [run-daily.md](run-daily.md)。CI 執行範圍見 [workflows.md](workflows.md)。
