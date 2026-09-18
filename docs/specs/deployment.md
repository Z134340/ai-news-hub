# 部署與回退契約

## 目標拓撲

| 職責 | 權威系統 | 邊界 |
|---|---|---|
| 原始碼、審查、CI、正式分支 | GitHub | `main` 通過「離線自測」後才由 GitHub Actions 發布 production |
| 網站託管、TLS、CDN、HTTP headers | Cloudflare Pages | 只部署 `dist/` allowlist 產物，不把整個 repository 當 web root |
| 登入、書籤、回饋、冷封存 | Firebase Auth + Firestore | Firebase 前端 config 可公開；writer 帳密只留 off-repo |
| 每日擷取 | 本機 launchd | 擷取、驗證、發布證據與網站部署證據分開記錄 |

Cloudflare 不再承擔資料庫職責；Firebase 是唯一應用資料庫。新聞熱層仍是每日驗證後產生的唯讀 JSON，屬網站發佈資產，不是使用者交易資料。

## Cloudflare Pages 專案設定

- 專案名稱：`ai-news-hub`
- 發布來源：GitHub repository `Z134340/ai-news-hub` 的 `.github/workflows/cloudflare-pages.yml`
- Production branch：`main`
- 發布閘門：相同 commit 的「離線自測」成功；另保留人工 `workflow_dispatch` 供首次部署及故障復原
- Build command：`node scripts/build-site.mjs`
- Build output directory：`dist`
- Root directory：repository root
- GitHub Actions secrets：`CLOUDFLARE_ACCOUNT_ID`、只含 Account / Cloudflare Pages / Edit 的 `CLOUDFLARE_API_TOKEN`
- Build secrets：無；不得把 Firebase writer 帳密放入 Cloudflare

`wrangler.jsonc` 記錄專案名稱、輸出目錄與 compatibility date。Cloudflare GitHub App 在 2026-09-18 完整重裝後仍由 Cloudflare callback 回報安裝失敗，因此改用 Cloudflare 官方 Direct Upload CI。部署 Action、Wrangler 與 Ubuntu runner 均固定版本；production workflow 只讀原始碼，token 不寫入 repository 或 Cloudflare build environment。GitHub App 若日後恢復，切換部署模式必須另行驗證，不能讓兩條 production 流程同時發布。

## 發佈包

`scripts/build-site.mjs` 每次先清空 `dist/`，再只複製：

- `index.html`、`assets/**`
- `data/latest.json`、`health.json`、`index.json`、`skills.json`
- 近期香港日檔 `data/YYYY-MM-DD.json`
- 儀表板使用的已發布 `data/agent/*.json`
- `cloudflare/_headers` → `dist/_headers`

建置會解析必要 JSON 並拒絕 symlink／特殊檔案。`dist/` 不入版控；CI 重新建置並確認 `scripts/`、`docs/`、規則與維運檔不在 web root。

## 快取與安全 headers

- HTML：`no-store`，確保切版立即生效。
- `data/*`：每次重驗，避免每日資料被舊 CDN 內容遮蔽。
- `assets/*`：一小時後重驗；目前檔名未帶內容 hash，不能設 `immutable`。
- 全站：禁止 iframe、MIME sniffing、相機／麥克風／定位／付款／USB，限制 referrer 與 opener。

目前頁面仍有 inline event handler，因此本工項不加入會誤擋功能的強制 CSP。CSP 必須在移除 inline handler 且完成瀏覽器回歸後另行啟用，不能放一條看似安全但實際破站的規則。

## 上線順序與回退

1. `main` 的離線自測建置 `dist/` 並通過現有測試。
2. `workflow_run` 只取該次成功測試的 `head_sha`，重建 allowlist 發佈包後以 Wrangler Direct Upload 發布；比對 commit SHA 與發佈包。
3. 驗證首頁、趨勢、搜尋、歷史、Firebase 登入／登出與手機寬度。
4. 保留 GitHub Pages 原站，等待至少一個後續正常每日週期由 `main` 觸發同 SHA 的 Cloudflare production deployment。
5. 若有自訂網域，最後才切 DNS；錯誤時回滾 Cloudflare 前一 deployment 或切回 GitHub Pages。
6. 新站通過每日排程後，另開工項停用 GitHub Pages 專用 keep-alive；切換前不得刪除回退路徑。

## 完成證據

- GitHub commit SHA、CI run 與 Cloudflare production deployment SHA 相同。
- GitHub Actions deployment 只在 CI 成功後執行；憑證不存在時須在部署前明確失敗。
- production URL 回應 `Cf-Ray`，`_headers` 的安全與 cache headers 生效。
- `dist/` 檔案清單沒有非 allowlist 檔案。
- Firebase 規則版本與多帳號／多裝置測試另有證據；Cloudflare 部署成功不代表資料遷移完成。
