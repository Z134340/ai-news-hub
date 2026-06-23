# 冷封存設定指南 — 過期新聞搬進 Firestore

> 架構：**冷熱分層**。近 7 天 + latest 留在 repo（static JSON + Pages，熱層，每次開頁讀）；
> 逾 7 天的每日封存搬到 **Firestore `archives/{date}`**（冷層，僅點歷史時讀，1 read）。
>
> 前置：請先完成 `FIREBASE-SETUP.md`（同一個 Firebase 專案，書籤同步與冷封存共用）。
> 安全模型：**scoped writer 最小權限** — 一個專用帳號可寫 archives、規則限制其 uid；讀為公開。
> 無 service account、無專案級金鑰。傳輸用 Node 內建 fetch 走 REST，零 npm 依賴。

---

## A. 建立 writer 帳號並取得 uid

| 步驟 | 操作 |
|------|------|
| 1 | Firebase Console → **Authentication → Users → Add user**，輸入一組專用 Email/密碼，例如 `archiver@ainews.local` / 強密碼。這組**只給 run-daily 用**，不是你平常登入書籤的帳號。 |
| 2 | 在 Users 清單複製該帳號的 **User UID**（一串英數）。 |
| 3 | 開 `firestore.rules`，把 `archives` 區塊的 `'WRITER_UID'` 換成步驟 2 的 uid。 |
| 4 | 部署規則：Console → Firestore → Rules 貼上並 Publish，或 `firebase deploy --only firestore:rules`。 |

## B. 放 writer 憑證（off-repo，絕不進 git）

建立檔案 `~/.config/ai-news-hub/archiver.env`（路徑可用環境變數 `ARCHIVER_ENV` 覆寫）：

```bash
mkdir -p ~/.config/ai-news-hub
cat > ~/.config/ai-news-hub/archiver.env <<'EOF'
FB_API_KEY=AIza....            # 與前端 config.js 同一把（公開識別碼）
FB_PROJECT_ID=ai-news-hub-xxxx
WRITER_EMAIL=archiver@ainews.local
WRITER_PASSWORD=你的強密碼
EOF
chmod 600 ~/.config/ai-news-hub/archiver.env
```

> `.gitignore` 已擋 `*.env`；且此檔在 repo 外，雙重保險。

## C. 一次性遷移（把現有 43 個封存搬上去並從 repo 移除）

```bash
# 先 dry-run 確認清單
node scripts/archive-to-firestore.mjs --all --dry-run

# 正式：全部上傳 Firestore，成功者刪本機檔
node scripts/archive-to-firestore.mjs --all --prune

# 移除 bundle / failed log / emerging（沙箱無法刪，需在本機跑）
bash scripts/repo-slim.sh

git add -A
git commit -m "🧹 正規化：冷熱分層 + 冷封存遷移 Firestore + repo 瘦身"
git push origin main
```

完成後 `data/` 只剩 latest/health/index + 近 7 天封存；逾期封存都在 Firestore。

## D. 之後全自動

`run-daily.sh` 歸檔後會自動執行：
```
node scripts/archive-to-firestore.mjs --older-than 7 --prune
```
偵測到 `archiver.env` 存在才跑；上傳成功才刪本機；失敗不刪、下次重試（非致命）。
新到期的那天會自動進 Firestore 並從 git 移除——**封存零成長**。

## E. 驗收

| 項目 | 通過條件 |
|------|----------|
| 遷移 | Console → Firestore → `archives` 出現 43 筆 doc（doc id = 日期） |
| 前端歷史 | 開網站 → 歷史紀錄頁 → 列出完整封存（不再只有近 7 天）；點逾期日 → 從 Firestore 載入成功 |
| 熱層不變 | 近 7 天仍走 static JSON（速度不變、免登入） |
| 免登入可讀 | 未登入也能瀏覽歷史封存（公開讀規則） |
| 寫入權限 | 只有 writer 帳號能寫 archives（規則擋下其他人） |
| repo | `data/` 不再無限成長；逾期檔每日自動移出 |

---

### 文件格式（archives/{date}）
```
{ date, generated_at, item_count, pass_rate, source, payload }
```
`payload` 為當日完整 JSON 的字串（≤1MiB，實測最大 ~312KB）。前端讀取後 `JSON.parse(payload)` 還原。
此設計刻意不展開巢狀結構（避開 Firestore REST 型別格式與「陣列不可巢狀」限制），代價是無法在 Firestore 內查詢封存內文——歷史頁只需整日載入，不受影響。
