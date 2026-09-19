# AH-03：發布 manifest 與版本化讀取

本文件是 release 內容契約與失敗行為的唯一維護位置。項目與品質沿用 [data-formats.md](data-formats.md)、[category-quality.md](category-quality.md)。`scope=local_snapshot` 只證明本機選出的內容與 manifest 相符，**不是** Git push、production deployment、來源全文或翻譯的人工驗收證明。

## Schema、身分與 bytes

Schema：`schemas/release/manifest-v1.schema.json`（Draft 2020-12）。manifest 的整數版本 1 與 payload 的資料契約版本 2 分開；未知版本／多餘欄位拒絕。正常 manifest 約 500 bytes，不包含新聞、原件、路徑型私有證據或 quarantine。

| 欄位 | 精確定義 |
|---|---|
| `schema_version`／`data_schema_version` | 固定 `1`／`2` |
| `data_sha256` | AH-02 selected candidate 的完整 UTF-8 bytes（含空白、排序、換行）的 SHA-256，小寫 64 hex |
| `release_id` | `ahn-release-v1-` + `data_sha256`，完整 hash，不截短 |
| `data_path` | 固定 `data/releases/<data_sha256>.json`；只允許同站相對路徑，不允許自訂 URL／路徑穿越 |
| `data_bytes` | 原 bytes 的長度，不是字元數 |
| `snapshot_time` | selected snapshot 的 `time`，不是 manifest 建置／Git 推送／部署時刻 |
| `scope` | 固定 `local_snapshot` |

跨欄位身分／path／hash／size／time 的綁定由程式驗證，不能只跑結構 schema。manifest 不嵌入自身 hash，也不把 AH-02 request hash 冒充 release ID。此 ID 識別資料，程式碼改版而資料不變時 ID 不變。`code_sha`、Git `content_sha` 及 deployment receipt 的實際關聯留 AH-04／AH-11，不預填當前 HEAD 當作尚未產生的發布提交。

序列化完全沿用 AH-02 `encode`（sort_keys、indent=2、UTF-8、尾端 newline、禁止 NaN）；release installer 不重算時間、不正規化 URL、不改內容或 itemKey。相同 selected bytes 的 manifest 與 ID 可重現；包括 checked/outcome 等 metadata 在內的任一 byte 變更都產生新版本，因此「內容 no_change 但本次 checked 前進」仍是不同完整快照版本。

## 產生順序與提交點

每日／補跑共用同一鎖與流程：

1. AH-02 完成 private candidate／validated／quarantine／LKG generation，產生 selected candidate。
2. `release-manifest.py --store ... --candidate ... --data-dir .../data` 取得同一 quality store lock，核對 current 指向的 generation、可靠 records、selected bytes 與 candidate。過時或修改過的 candidate 拒絕，不從任意 latest 建立可靠 release。
3. 先以暫存檔、fsync、rename 安裝不可變 `data/releases/<hash>.json`；已存在時核對 bytes，相同可重用，衝突／損壞拒絕覆寫。
4. 原子更新相容用 `data/latest.json`；舊前端仍可照原協定讀取。
5. 最後原子更新 `data/release-manifest.json`，此為新前端的本機可見提交點。
6. daily 接著寫日期封存／index／health，再執行原有 Git 發布。任一步失敗回非零，不將本機產物宣稱已推送或部署。正式分類舊檔不重寫。

這不是跨檔或遠端交易：manifest 切換前失敗，舊 manifest 及其舊 blob 仍可用，latest 可能已是新版本；建置遇此不一致必須失敗。rename 後 fsync 出錯可能已完成切換但回報失敗，此時以檔案驗證判斷現場，不能假設一定仍是舊指標。所有已完整切換的 manifest 都只指向先前已核對的 blob。

相同 current selection 可冪等重跑修復 latest／manifest；若 quality current 已前進，不得使用舊 candidate 回滾。保留私有原件、LKG 與舊不可變 blob。此次不加入自動 retention；public release blob 會累積，磁碟／Git 容量是已知限制。不可直接清除仍被 manifest 引用的 blob。

## 前端與快取

`data.js` 為共用入口，首頁及 dashboard 的 latest 讀取合併進行中的請求。歷史 DATA 與原始 release cache 分離。每次載入與每 15 分鐘檢查只取得小型 manifest；同版本且有可驗證快取時不抓大型 payload。換版才抓 hash 路徑並驗 bytes／schema version／time；有效新版完成驗證後才提示重新載入。歷史檢視暫停輪詢。

快取使用 `ainews-release-v1:<release_id>` 儲存 `{manifest,text}`，`ainews-release-v1:current` 指向已完整寫入的版本。讀取快取重新核對 hash 與 metadata；UI 補缺分類、legacy Skills overlay 或書籤互動不修改原始 text。寫好新 record 才切 pointer，再清除先前 record；正常僅留目前一份，storage quota／停用不阻止記憶體內有效資料使用。中斷可能留下無指標 record，不影響個人書籤快取。重新載入時沒有可用快取屬必要重新下載例外。

| 情境 | 結果 |
|---|---|
| 同 manifest + 有效 memory/local cache | `verified`，只讀 manifest |
| 新版 + 精確 bytes 相符 | `verified`，保存新版本；輪詢僅提示，不覆蓋歷史畫面 |
| manifest 404／HTTP 失敗／網路逾時，已有有效快取 | `cached`，顯示先前已驗證快取與降級提示；不冒稱目前版本驗證成功 |
| manifest 缺失／傳輸失敗，無有效快取 | `legacy`，依舊協定讀 latest，顯示「相容讀取，未驗證發布版本」；不寫 release cache、不宣稱 hash 驗證成功 |
| manifest JSON 語法錯誤／畸形／未知版本 | 有有效快取則 `cached`；否則 `failed`，不繞回未驗 latest |
| hash／size／time 不符，manifest 與 blob 交錯、blob 404／逾時 | 有有效快取則 `cached`；否則 `failed`，不把錯誤 bytes 寫入快取或顯示新版成功 |
| cache JSON／hash／key 損壞 | 丟棄該 cache，依有效 manifest 重新下載；下載失敗且無可靠 cache 時失敗 |
| Web Crypto 不可用 | manifest 路徑失敗，不將未驗資料當成 verified；正常 HTTPS／localhost 支援 |
| 同 release ID 卻有矛盾 metadata | 拒絕新 metadata，保留有效舊 cache 並標降級 |

`verified` 在這裡僅指內容一致性驗證，不是 AH-02 來源品質的重新核實；hash 本身不提供來源簽章或抵禦整站被替換。health、歷史、agent artifacts 仍是各自獨立讀取，沒有被這份 latest manifest 綁成同一批資料。

## 建置、外部邊界與回滾

`build-site.mjs` 使用 Python 標準函式庫 verifier（CI 已備 Python）驗證來源，再複製唯一被 manifest 引用的 blob 與 manifest，最後對輸出再驗 hash 及 latest 一致性，以阻擋複製期間版本交錯。manifest 缺失維持舊快照建置；存在卻錯誤則停止。未引用 blob、private store、scripts/docs/schemas 不進 dist。Cloudflare headers、workflow、Firebase 與通知設定此次不變。

舊 tab 若持有某版 manifest、部署後該 blob 已不在新版 dist，會使用已驗 cache 或明確失敗；下次讀 manifest 再取新版本。CDN／部署原子性與線上同 SHA 驗收屬 AH-04，本次無 production 操作。

程式回退：在隔離分支 revert AH-03 提交並測試、push，保留 AH-00～AH-02 與每日資料，不 reset／force-push。舊前端仍讀 latest；AH-03 cache namespace 與書籤完全分離，可單獨清除。此次未改正式資料，無 production 資料回遷。將來內容回退須先停止 publisher、備份、驗證指定快照與相應 AH-02 可靠世代，再經授權執行；不能直接把 legacy latest 標為可靠前版。
