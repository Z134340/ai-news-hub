# HANDOFF.md — 交接狀態（2026-06-21）

> 給接手的 coding agent / 維護者。**先讀本檔與 `CLAUDE.md`，再讀 `assets/`、`scripts/`、`*.md`。
> 不要重做已完成的重構——只驗證與接續。**

---

## Step 0 — 先做這個（清 lock + 提交基線）

接手的第一件事，**先於任何規劃**：清掉殘留 lock、把目前所有正規化變更（含本檔與 `CLAUDE.md`/`AGENTS.md` 更新）提交成乾淨基線。這樣 agent 讀到的是正確版本、之後的 diff 也有明確起點。Firebase 未設定也可先提交——網站照常運作。

```bash
cd ~/ai-news-hub
rm -f .git/index.lock                      # 沙箱遺留，必清否則 git 寫入失敗
git status                                 # 預期：3 改 + 多個新檔，0 已暫存
git add -A
git commit -m "♻️ 正規化：前端拆檔 + Firebase 書籤同步 + 冷封存 + 文件更新"
```

> 註：此 commit **不含** Firebase 真實憑證（仍是 placeholder），且 `archiver.env` 在 repo 外，安全。
> 完成後再依第 4 節 checklist 接續（smoke test → Firebase 設定 → 冷封存遷移 → push）。

---

## 1. 已完成（已寫入磁碟，**尚未 commit**）

| 區塊 | 內容 | 狀態 |
|------|------|------|
| 前端拆檔 | `index.html` 1,049→107 行；`assets/css/app.css` + `assets/js/` 九模組（classic script，順序固定） | ✅ 已驗證 `node --check` + 本機 http 200 |
| 書籤雲端同步 | `assets/js/firebase.js`（Email/Password + Firestore `users/{uid}`，offline-first） | ✅ 程式完成；待填 config |
| 冷封存 | `archives/{date}` 設計；`scripts/archive-to-firestore.mjs`（Node 零依賴 REST，scoped writer）；`history.js` 冷熱合併；`run-daily.sh` 已注入每日上傳+prune | ✅ 程式完成；待設定 |
| 安全規則 | `firestore.rules`（users 本人寫、archives 公開讀/writer 寫）、`firebase.json` | ✅ 待填 `WRITER_UID` + 部署 |
| 防膨脹 | `.gitignore` +`failed_*.txt`/bundle/emerging/`*.env` | ✅ |
| 文件 | `FIREBASE-SETUP.md`、`ARCHIVE-SETUP.md`、`CLAUDE.md`（已更新新架構）、`AGENTS.md`（收斂為指標） | ✅ |

驗證紀錄：9 個 JS `node --check` 全過、串接 bundle 語法過、`run-daily.sh`/`repo-slim.sh` `bash -n` 過、`archive-to-firestore.mjs --dry-run` 正確（今日 cutoff 06-14：42 檔搬冷層、06-19 留熱層）。

## 2. 待辦（需「人」在 Mac + Firebase console，agent 無法代）

| # | 待辦 | 為什麼只能人做 |
|---|------|----------------|
| A | 清除殘留 `.git/index.lock`（`rm -f .git/index.lock`） | 先前沙箱無法刪；git 寫入被它擋住 |
| B | 建 Firebase 專案 → 填 `assets/js/config.js` 的 `FIREBASE_CONFIG` | 需 Google 帳號登入 console |
| C | 啟用 Email/Password、建 Firestore、部署 `firestore.rules` | 同上 |
| D | 建 writer 帳號 → 取 uid → 換掉 `firestore.rules` 的 `WRITER_UID` → 重部署 | 同上 |
| E | 建 `~/.config/ai-news-hub/archiver.env`（writer 帳密，off-repo） | 機密，不進 repo |
| F | 一次性冷封存遷移：`node scripts/archive-to-firestore.mjs --all --prune` | 需 E 的憑證 + 網路 |
| G | repo 瘦身刪除：`bash scripts/repo-slim.sh`（bundle/failed log/emerging） | 沙箱無刪除權限；Mac 原生 git 可 |
| H | commit + push | — |
| I | **pmset 每日喚醒**：`sudo pmset repeat wakeorpoweron MTWRFSU 17:55:00`（現況只有錯誤的 Saturday 8:55PM，無每日喚醒）→ `pmset -g sched` 應顯示 `wake ... every day` | 需 sudo 密碼，agent 非互動無法執行（2026-07-07 待辦） |

## 3. 勿動 / 勿誤判

- **勿重新內聯**：`assets/js/` 九模組是刻意拆分，別合回單檔。
- **placeholder 勿自填**：`FIREBASE_CONFIG`（`YOUR_*`）、`firestore.rules` 的 `WRITER_UID` 由人填，勿編造。
- **機密界定**：`firebaseConfig` apiKey **非機密**（公開前端 ID），可 commit；`archiver.env` 才是機密，已 gitignore + off-repo，**絕不 commit**。
- **後端擷取/驗證鏈**（`run-daily.sh` 主體、`validate.py`、`merge-stack.py`、`extract-json.py`、prompts/）運作中，除非明確要求只驗證不重寫。run-daily 僅新增了「冷封存上傳」一段。
- **未填 Firebase 前網站照常**：config 為 placeholder 時全部 no-op，書籤走 localStorage、歷史走 static——可安全先 push 再設定。

## 4. 上線 checklist（建議順序）

```bash
# 0+1) 清 lock + commit 基線 → 見上方「Step 0」，先完成它

# 2) 本機 smoke test
python3 -m http.server 8799   # 開 http://localhost:8799 點各頁/書籤/搜尋/歷史
node --check assets/js/*.js
node scripts/archive-to-firestore.mjs --all --dry-run

# 3) Firebase 設定（依 FIREBASE-SETUP.md + ARCHIVE-SETUP.md）→ 填 config / WRITER_UID / archiver.env → 部署 rules

# 4) 冷封存遷移 + repo 瘦身
node scripts/archive-to-firestore.mjs --all --prune
bash scripts/repo-slim.sh
git add -A && git commit -m "🧹 冷封存遷移 Firestore + repo 瘦身"

# 5) push
git push origin main
```

## 5. 已知小事
- `data/index.json` 目前僅 1 筆（舊歷史索引近乎空）；改用 Firestore 列表後歷史頁會恢復完整封存，run-daily 也會持續更新它。
- GitHub Pages 為 project page（base `/ai-news-hub/`）；前端全用相對路徑，勿改絕對路徑。
- **2026-07-06 事件（已處理）**：週一 models/tutorials/courses 抽 0 筆，根因非解析而是 Claude CLI 配額耗盡 + API Connection closed；當日 18:05 準時啟動但跑 87 分鐘（10 類 × 重試）中途撞 session limit，週類別排最後遭餓死。修正：①週一週類別優先擷取 ②配額/連線 sentinel 分級（硬性配額立即跳出、暫時性中斷保留重試）③extract-json.py 加 infra sentinel 診斷（見 commit `4664b31`）。同時發現並修 launchd plist 缺週末（僅 Weekday 1-5 → 已改每日觸發，解釋 07-04/05 的 missed）；pmset 每日喚醒仍待人設定（見第 2 節待辦 I）。
