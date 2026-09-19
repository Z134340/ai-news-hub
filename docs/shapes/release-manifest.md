# AH-03 發布 manifest 與高效率讀取 shape

權威契約：`docs/specs/release-manifest.md`；資料內容：`data-contract-v2.md`；分類可靠前版：`category-quality.md`。

| 入口 | 責任 |
|---|---|
| `schemas/release-manifest-v1.schema.json` | 公開 manifest v1 的結構；不代表任意 JSON Schema runtime |
| `scripts/build-release-manifest.mjs` | 固定四檔 allowlist、bytes SHA-256、content set hash、穩定 release ID、必要時間、完整後才以暫存檔 rename；export build／validate／write 供測試與 build 使用 |
| `scripts/build-site.mjs` | 清空並建立 `dist/`、複製及解析 allowlist；最後才呼叫 manifest writer；任何受管理檔缺失即 build 失敗 |
| `assets/js/release.js` | manifest-first、版本／identity 驗證、只抓變更資產、版本化 localStorage cache、全數通過後原子切換、舊 release LKG 與 404 legacy 分流 |
| `assets/js/data.js` | 初載／十五分鐘輪詢使用 release bundle；legacy 404 才沿用舊直讀；不把舊 skills sidefile 蓋過 AH-02 selected latest |
| `assets/js/dashboard.js`、`history.js` | latest／index 優先共用 active release；日期封存與 agent artifacts 仍按需 legacy 讀取 |
| `scripts/tests/release-manifest.test.mjs` | 穩定重跑、未變不重抓、單 asset 改變、hash/schema/缺檔/中斷拒絕、舊 LKG、無 LKG 失敗、legacy 未驗證 |
| `.github/workflows/selftest.yml` | Node suite 收錄 manifest 測試；Cloudflare allowlist build 斷言 manifest 存在且私有／維運路徑不外洩 |

`release_id` 是 build artifact 的內容身分，不是 Git SHA、Cloudflare deployment ID 或 production 驗收 receipt。前端 `RELEASE_STATE.verified=true` 只表示目前 active 四檔通過 manifest hash；`degraded=true` 表示新 release 被拒絕而沿用舊 verified cache。
