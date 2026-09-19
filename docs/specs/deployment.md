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
- Production URL：`https://ai-news-hub-7jk.pages.dev`（Cloudflare 配發；專案名稱仍為 `ai-news-hub`）
- 發布來源：GitHub repository `Z134340/ai-news-hub` 的 `.github/workflows/cloudflare-pages.yml`
- Production branch：`main`
- 發布閘門：相同 commit 的「離線自測」成功；人工部署必須同時指定完整 `target_sha`、該 SHA 的成功 CI run ID 與預期 release ID，不能使用 runner 當下模糊 checkout
- Build command：`node scripts/build-site.mjs`
- Build output directory：`dist`
- Root directory：repository root
- GitHub Actions secrets：`CLOUDFLARE_ACCOUNT_ID`、只含 Account / Cloudflare Pages / Edit 的 `CLOUDFLARE_API_TOKEN`
- Build secrets：無；不得把 Firebase writer 帳密放入 Cloudflare
- Firebase Authentication 授權網域：`ai-news-hub-7jk.pages.dev`；只授權穩定 production hostname，不加入每次部署產生的 hash hostname

`wrangler.jsonc` 記錄專案名稱、輸出目錄與 compatibility date。Cloudflare GitHub App 在 2026-09-18 完整重裝後仍由 Cloudflare callback 回報安裝失敗，因此改用 Cloudflare 官方 Direct Upload CI。部署 Action、Wrangler 與 Ubuntu runner 均固定版本；production workflow 只讀原始碼，token 不寫入 repository 或 Cloudflare build environment。GitHub App 若日後恢復，切換部署模式必須另行驗證，不能讓兩條 production 流程同時發布。

## 發佈包

`scripts/build-site.mjs` 每次先清空 `dist/`，再只複製：

- `index.html`、`assets/**`
- `data/latest.json`、`health.json`、`index.json`、`skills.json`；四檔完成後生成 `data/release-manifest.json`
- 近期香港日檔 `data/YYYY-MM-DD.json`
- 儀表板使用的已發布 `data/agent/*.json`
- `cloudflare/_headers` → `dist/_headers`

建置會解析必要 JSON 並拒絕 symlink／特殊檔案。release manifest 的穩定 ID、bytes hash、產生順序與前端 cache 只在 `release-manifest.md` 維護。`dist/` 不入版控；CI 重新建置並確認 `scripts/`、`docs/`、`schemas/`、規則、candidate／quarantine／private store 與維運檔不在 web root。

## 快取與安全 headers

- HTML：`no-store`，確保切版立即生效。
- `data/*`：每次重驗，避免每日資料被舊 CDN 內容遮蔽。
- `assets/*`：一小時後重驗；目前檔名未帶內容 hash，不能設 `immutable`。
- 全站：禁止 iframe、MIME sniffing、相機／麥克風／定位／付款／USB，限制 referrer 與 opener。

目前頁面仍有 inline event handler，因此本工項不加入會誤擋功能的強制 CSP。CSP 必須在移除 inline handler 且完成瀏覽器回歸後另行啟用，不能放一條看似安全但實際破站的規則。

## 發布身分與 deployment receipt

`.github/workflows/cloudflare-pages.yml` 將下列身分綁成同一個可稽核發布；任一不一致在 upload 前或 post-deploy verification 時 fail closed：

| 身分 | 來源／約束 |
|---|---|
| `DEPLOY_SHA` | 自動發布取成功「離線自測」的 `workflow_run.head_sha`；人工發布只接受完整 40 位 target SHA |
| CI | run ID、`head_sha`、workflow 名稱與 success 結果必須符合；不得用較早 SHA 的綠燈 |
| checkout | `git rev-parse HEAD` 必須等於 `DEPLOY_SHA` 與 CI SHA |
| build identity | `dist/data/release-manifest.json` 的 `release_id`、`content_set_sha256` 與四份 asset descriptors |
| Cloudflare | Direct Upload 產生的 deployment URL，加上固定 production URL `https://ai-news-hub-7jk.pages.dev` |
| live identity | 固定 production URL 實際回應的 manifest、四份資產 bytes／size／SHA-256 與 headers |

`schemas/deployment-receipt-v1.schema.json` 是 deployment／rollback receipt 結構；`scripts/post-deploy.mjs` 同時做 runtime 嚴格驗證。每次 workflow run／attempt 使用唯一 artifact 名稱，receipt 的 `events[]` 只能依序加入 `requested → uploaded → verified|failed`；失敗階段及安全錯誤碼保留，不能把後一次結果覆寫成前一次歷史。receipt 不進網站 allowlist，不含 token、response body 或秘密 header。

## Production post-deploy verification

Wrangler upload 或 workflow step 成功只代表 `uploaded`，不是上線成功。upload 後必須對固定 production URL 執行同一個 verifier：

1. 在每次 request 加 cache-busting query，先驗首頁 2xx，再驗 `data/release-manifest.json` 2xx。
2. 首頁與所有 data response 都須有 `_headers` 的 `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy`、`Cross-Origin-Opener-Policy`、`Cross-Origin-Resource-Policy`；首頁另須 `no-cache, no-store, must-revalidate`，data 須 `no-cache, must-revalidate`；production 必須有 `Cf-Ray`。
3. 線上 manifest 須通過 schema、集合 hash 與 release identity 重算，且 `release_id`、`content_set_sha256`、四份 descriptors 必須與本次 build 完全相同。舊 manifest 即使本身有效也不算本次成功。
4. 逐一下載 latest／health／index／skills 的實際 bytes；size、SHA-256、JSON 與各自 data headers 全部相符才可標 `verified`。缺檔、HTTP 非成功、混合新舊資產、錯誤 schema／identity／hash／size／header 一律失敗。
5. CDN 尚未收斂可重試 6 次，退避 2、4、8、15、15 秒，每個 request 10 秒 timeout；上限耗盡即 `failed`。不得無限等候或把舊 release 當本次成功。

Verifier 只接受 credential-free HTTPS production URL；receipt 只記 release／asset digest、嘗試狀態及錯誤碼，不記 response body。fixture 可模擬 CDN 延遲與錯誤，但只能算 offline validation。

## 通知順序與冪等

`.github/workflows/notify.yml` 只接受 `workflow_call`，不再由 main push 或 `data/latest.json` 變更直接觸發。caller 必須先上傳終態 receipt；通知 job 重新下載並驗 `final_status=verified`、deploy SHA 與 release ID，才可建立 GitHub Issue。

通知 marker 以 `kind + deploy_sha + release_id` 組成，並在 open／closed issues 全部查重；同一 deployment／release 的 workflow rerun 最多通知一次。通知列出 verified、部署 SHA、release ID、content set hash、receipt ID 與 production URL，不包含 secrets。build、Git push、upload、post-deploy 任一步失敗都不會進通知 job。

## Cloudflare 人工回滾

唯一入口是 `.github/workflows/cloudflare-rollback.yml`；GitHub Pages 不是回退路徑。回滾分成兩個明確的 `workflow_dispatch`：

1. `mode=plan`：指定完整 target SHA、expected release ID、既有 verified deployment receipt 的 run ID／attempt。下載既有證據、重新 checkout／build target、確認 bit-identical release identity，再以同一 verifier讀出目前 production identity。只產生 dry-run rollback receipt，列出目前／目標 identity 與 `checkout → rebuild → upload → verify` 動作；沒有 Cloudflare mutation。
2. `mode=execute`：除上述 target 證據外，必須指定先前 plan 的 run ID／attempt。若 production identity 自 plan 後已改變、target receipt 非 verified、SHA／release ID 不符、artifact 不可取得或 target 無法重建，upload 前拒絕。不得用 runner 當下 checkout 或只憑 commit 名稱推測。
3. execute upload 後仍只標 `uploaded`；固定 production URL 經同一 verifier 全部通過才標 `verified` 並可通知。發出 rollback 指令、Wrangler success 或 hash deployment URL 可讀都不等於回滾成功。

plan 與 execute 各有自己的不可覆寫 artifact；rollback receipt 保留 source verified receipt、source plan receipt、先前／目標 release identity 及 requested／uploaded／verified／failed 歷史。未知、未驗證或沒有既有證據的目標一律拒絕。

## 上線順序與完成證據

1. `main` 的離線自測建置 `dist/` 並通過現有測試。
2. production workflow checkout 該次 CI 的同一 SHA，重建 allowlist、建立 `requested` receipt，才可 Direct Upload。
3. upload 後對固定 production URL 完成上述驗證，保存終態 receipt；只有 verified 才呼叫通知。
4. 互動功能（趨勢、搜尋、歷史、Firebase 登入／登出與手機寬度）仍是另列 live/UAT 證據，不能由 hash verifier 代替。
5. Cloudflare production 曾在 2026-09-19 通過正常每日週期的舊版同 SHA 驗收；該歷史證據不代表 AH-04 新流程已部署或 live 驗證。
6. GitHub Pages 已停用；若日後加入自訂網域，先完成 hostname、Firebase 授權網域與 DNS 回退演練再切換。

AH-04 完成證據必須分開記錄：implementation、offline validation、repository workflow configuration、GitHub／Cloudflare external configuration、production mutation、deployment、live evidence、authorization。workflow 定義、fixture、本機 HTTP、CI 綠燈或 upload success 都不能稱為 production deployment／live validation；Firebase 規則與多帳號／多裝置測試亦是獨立證據。
