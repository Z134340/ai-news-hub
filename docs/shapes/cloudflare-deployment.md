# Cloudflare Pages 施工入口

| 目的 | 檔案／設定 |
|---|---|
| allowlist 建置 | `scripts/build-site.mjs` |
| 核心資產 manifest／hash | `scripts/build-release-manifest.mjs`；契約與前端讀取見 `docs/specs/release-manifest.md` |
| response headers | `cloudflare/_headers` |
| Pages 設定真本 | `wrangler.jsonc` |
| CI 建置閘 | `.github/workflows/selftest.yml` 的 `Build Cloudflare Pages artifact` |
| 部署與回退契約 | `docs/specs/deployment.md` |

本 shape 只定位程式；正式／preview branch、建置參數、驗收與回退只在部署規格維護。
