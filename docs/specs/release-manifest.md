# AH-03：發布 manifest、內容驗證與前端快取

本文件是 release manifest、發布資產 hash、release ID、前端 cache 與失敗降級的唯一權威規格。資料項目契約仍由 `data-formats.md` 維護，分類 LKG 仍由 `category-quality.md` 維護；本文件的「已驗證」只表示 manifest 身分及資產 bytes 的 SHA-256 一致，不代表新聞內容經人工查證、Git 已 push、Cloudflare 已部署或 production 已 live 驗收。

## 發布單位與產生順序

Cloudflare allowlist 的核心發布單位固定為下列四檔，全部 `required=true`：

1. `data/latest.json`
2. `data/health.json`
3. `data/index.json`
4. `data/skills.json`

`scripts/build-site.mjs` 先建立全新的 `dist/`、複製 allowlist、解析所有必要 JSON，再呼叫 `build-release-manifest.mjs` 逐檔讀取實際 bytes。四檔都存在、是 regular file、可解析且 hash／大小可重算時，才以暫存檔＋rename 最後寫入 `dist/data/release-manifest.json`，寫後立即重讀驗證。任何缺檔、symlink、特殊檔、JSON 錯誤或 manifest 自我驗證失敗都使 build 非零，舊 deployment 不受影響。

manifest 只存在於完整的 `dist/` 發布包，不由每日流程先寫到 public data，也不被當作跨 Git／Cloudflare 的交易承諾。Cloudflare 是否原子切換、線上 hash 與部署 SHA 的驗證屬 AH-04；AH-03 只保證同一個 build artifact 內 manifest 在受管理內容完成後產生。

## Manifest v1

權威 JSON Schema：`schemas/release-manifest-v1.schema.json`。程式除 schema 形狀外，還會重算集合 hash 與 release ID，不能只憑欄位看似存在就通過。

| 欄位 | v1 契約 |
|---|---|
| `schema_version` | 整數 `1`；未知版本拒絕，不降格猜讀 |
| `compatibility_version` | 固定 `ai-news-hub-web-data-v1`；前端只讀完全相符版本 |
| `cache_version` | 整數 `1`；同時釘住 localStorage key／record shape |
| `release_id` | `ahr1_` + 64 位小寫 SHA-256；由下列 identity canonical JSON 計算 |
| `created_at` | 從四份受管理內容內可用時間欄位取最晚有效 ISO date-time；不讀 build clock，因此相同輸入可重現 |
| `content_set_sha256` | 依 manifest 順序，對每檔 `{path,sha256,bytes,schema_version}` canonical JSON 計算 SHA-256 |
| `assets[]` | 精確四筆且 path 不重複；每筆含 `path`、bytes 的 `sha256`、`bytes`、`media_type=application/json`、資料 `schema_version`、`required=true` |

release identity 是 `{schema_version, compatibility_version, cache_version, created_at, content_set_sha256, assets}` 的遞迴 key-sort、無額外空白 JSON bytes。`release_id` 不包含自己，也不包含檔案 mtime、build 時鐘或絕對路徑。同一組輸入重跑必須得到 bit-identical manifest、content hash 與 release ID；任一受管理 bytes 或其版本改變都會改變集合 hash／release ID。

目前 repo 的實際 public `latest.json` 尚未做 production migration，因此 builder 如實標 `schema_version:1`；未來真正的 v2 root 才標 `2`。這不影響 bytes hash 驗證，也不能把 v1 內容冒稱已完成 AH-01 production migration。

## 前端讀取與原子切換

`assets/js/release.js` 必須先於 `data.js` 載入。每次初載與十五分鐘檢查依序：

1. 只以 `cache:no-store` 讀小型 `data/release-manifest.json`。
2. 驗 schema／相容版本／cache 版本／路徑集合，再重算 `content_set_sha256` 與 `release_id`。
3. 對 manifest 的每筆 required asset，先檢查目前或持久化 cache 是否有相同 path＋hash＋bytes；cache raw text 仍須重算 bytes 與 SHA-256，不能因 localStorage 存在就相信。
4. 只抓缺少、hash 改變或 cache 自驗失敗的資產；網路內容先驗大小、SHA-256、JSON parse，全部通過後才一次切換 `RELEASE_ACTIVE` 並更新持久 cache。
5. manifest 未變時只讀 manifest，不重新抓 `latest.json` 等大型內容；release ID 改變但個別 asset hash 未變時也沿用已重驗的該 asset。

`data.js` 使用切換完成的 latest／health／skills；dashboard 與 history 的 latest／index 讀同一份 active release，避免重複抓取。日期封存與 `data/agent/*.json` 不在 v1 核心集合，維持既有按需讀取與各自降級；不得把這些 legacy reads 稱為 manifest-verified。

## 版本化 cache 與失效

- 唯一 key：`ainews-release-cache-v1`；record 同時含 `cache_version=1`、`compatibility_version`、完整 manifest 與各 asset 的原始 JSON text／hash／bytes。
- 只有 manifest identity 與四檔內容全部重驗成功後才可寫 cache。cache 寫入額度失敗不破壞本頁已驗證的記憶體內容，但下次 reload 會重新下載；不能標成已持久化。
- cache 版本或 compatibility 不符、record 畸形、任何 bytes/hash/JSON 不符即失效；可重新向目前 manifest 指定的 path 抓取並驗證，不能把壞 cache 當可靠前版。
- 目前版本不設時間 TTL：失效由 manifest identity 與資產 hash 決定。十五分鐘 manifest polling 是更新偵測，不是內容可信期限。

## 失敗矩陣與 legacy 相容

| 情境 | 行為 | 可否稱目前 release 已驗證 |
|---|---|---|
| manifest 及四檔全通過 | 原子切換新 release | 可以，但僅限 manifest／bytes 一致性 |
| manifest 無變 | 只輪詢 manifest；重驗 cache，不重抓大型內容 | 保持原已驗證 release |
| 某 asset hash／bytes／JSON 不符、404、逾時 | 拒絕整個新 release；若舊 cache 全數重驗通過則沿用並標 degraded | 不可以；沿用的是舊 release |
| manifest JSON／schema／identity 錯誤或未知版本 | 同上，不降格套 legacy | 不可以 |
| 沒有可重驗的舊 cache | `loadData` 明確失敗／空狀態；不生成資料 | 不可以 |
| manifest 明確 404，且已有可重驗的舊 release | 保留舊 release 並標 degraded；不降格讀取 current paths | 新 release 不可以；舊 release 保持已驗證 |
| manifest 明確 404，且從未有可靠 release（舊 deployment／舊封存站） | 走既有 latest／health／skills 讀取，`mode=legacy_unverified`；不寫 release cache | 不可以 |
| browser HTTP cache、舊 manifest、legacy data | 只有通過目前 manifest identity＋content hash 才可成為 active；其他只是相容輸入 | 不可以 |

manifest 存在但錯誤時不得假裝「沒有 manifest」而讀未驗證 current paths；這會把部分發布或未知新版本誤當成功。只有明確 404 且沒有任何可靠前版時，才啟用 legacy 相容路徑。

## 測試與營運邊界

- builder／loader 正反例：`scripts/tests/release-manifest.test.mjs`。
- 前端既有相容：`scripts/tests/frontend.test.mjs`；AH-01／AH-02 Python 與其他 Node regression 仍是 Gate A 必跑項。
- Cloudflare build 必須存在 `dist/data/release-manifest.json`，且 forbidden path 檢查仍排除 candidate、quarantine、private store、`scripts/`、`docs/`、`schemas/` 與 `.git`。
- 本工項不改正式資料、不啟用 private quality store、不修改 Firebase、排程、通知、Cloudflare state、GitHub Pages、`ranking_only`／`manual_only` 或 promotion。離線 build／本機 HTTP／CI 成功都不等於 production deployment 或 live validation。
