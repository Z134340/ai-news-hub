# Cloudflare Pages 施工入口

| 目的 | 檔案／設定 |
|---|---|
| allowlist 建置 | `scripts/build-site.mjs` |
| 核心資產 manifest／hash | `scripts/build-release-manifest.mjs`；契約與前端讀取見 `docs/specs/release-manifest.md` |
| response headers | `cloudflare/_headers` |
| Pages 設定真本 | `wrangler.jsonc` |
| CI 建置閘 | `.github/workflows/selftest.yml` 的 `Build Cloudflare Pages artifact` |
| production deploy／驗證 | `.github/workflows/cloudflare-pages.yml`；`scripts/post-deploy.mjs` |
| verified-only 通知 | `.github/workflows/notify.yml`；`scripts/deployment-notification.mjs` |
| 人工 rollback plan／execute | `.github/workflows/cloudflare-rollback.yml`；同一 `scripts/post-deploy.mjs` verifier |
| receipt schema／離線正反例 | `schemas/deployment-receipt-v1.schema.json`；`scripts/tests/post-deploy.test.mjs`、`deployment-workflows.test.mjs` |
| 部署與回退契約 | `docs/specs/deployment.md` |

本 shape 只定位程式；正式／preview branch、建置參數、驗收與回退只在部署規格維護。
