# AI News Hub 架構強化 v1 — Living Backlog

> 目的：將 2026-09-19 架構稽核拆成可逐 Session 實作、驗證與交接的工項。本文是工項範圍、相依與 release gate 的唯一維護位置；現況證據仍以程式、Git、GitHub Actions、Cloudflare 與 Firebase 實測為準。

## 1. 工作方式

- 一個 Session 只做一個 `AH-xx` 工項，不順手併做後續項目。
- 開始前讀 `CLAUDE.md`、`HANDOFF.md` §0–§1、本文件該工項，以及該工項引用的 spec／shape。
- 開始前確認工作目錄、`origin/main`、基準 commit 與既有變更；開發使用 `codex/ah-xx-*` 或同等隔離分支／worktree。
- 不以正式擷取、正式 Firebase 寫入、通知或 production mutation 當一般測試；工項明列外部驗收時才依既有授權與 gate 執行。
- 每次完成後更新本文狀態、`HANDOFF.md` §0、受影響 spec／shape，提交並 push 該工項分支。
- 最終回覆固定附下一個未完成且相依已滿足工項的完整 Prompt。Prompt 必須依當次真實結果重寫，不沿用可能過期的預填文字。

## 2. 目標架構與不變量

1. Cloudflare Pages 是唯一正式網站；GitHub 保存原始碼、審查與 CI，不同時維持第二個 production 網站。
2. Firebase Auth + Firestore 是應用資料庫；新聞熱層是經驗證的唯讀發布資產。
3. 資料依 `raw／candidate／validated／published／quarantine` 分層；候選不等於正式發布。
4. 品質閘以分類為單位；未達標分類沿用上一版可靠資料，不能拖累或污染其他分類。
5. 每次發布可用 `code_sha／content_sha／data_sha256／release_id` 追溯，通知只能發生在線上部署驗證成功後。
6. L3／模型判讀維持 advisory、preview、manual-only，且不延遲正式新聞發布。
7. 個人資料逐筆儲存、支援遷移與回滾；舊客戶端及多裝置行為必須經真實驗收。
8. 所有 production mutation、資料遷移與停用動作都須有回滾路徑和完成證據。

## 3. Session Backlog

| ID | 工項 | 主要範圍 | 前置 | 狀態 | 完成條件摘要 |
|---|---|---|---|---|---|
| AH-00 | 架構稽核與 Session 規劃 | 本文件、共用 Session 規則、目前基準與優先序 | 無 | ✅ 已完成 | living backlog 已建立；下一工項 Prompt 可直接執行 |
| AH-01 | 資料契約 v2 與相容遷移 | JSON Schema、`schema_version`、模型舊資料 migration、`source_title`、canonical URL、穩定 `item_id` | AH-00 | ⏭ 下一步 | 舊封存可讀；缺欄位不靠猜測補值；模型格式升級不再整批誤刪；離線正反 fixture 通過 |
| AH-02 | 分類級品質閘與可靠資料沿用 | candidate／published／quarantine、分類門檻、last-known-good、`_checked_at`／`_update_outcome` | AH-01 | ⬜ 未開始 | 未達標分類不覆蓋正式資料；其他分類可發布；課程可區分 no-change 與 failed |
| AH-03 | 發布 manifest 與高效率讀取 | `release-manifest` schema、release ID、內容 hash、前端只在版本改變時取大型資料、版本化 cache | AH-02 | ⬜ 未開始 | manifest 小型輪詢；內容與 manifest hash 綁定；舊前端相容與載入失敗降級通過 |
| AH-04 | 部署後驗證、通知與 Cloudflare 回滾 | CI post-deploy smoke/hash/header、通知改為部署成功後、指定已驗證 SHA 的人工回退 | AH-03 | ⬜ 未開始 | 通知不早於 production；錯誤 hash 阻擋成功；回退流程有 dry-run／驗收證據 |
| AH-05 | 單一正式入口與文件收斂 | 停用 GitHub Pages、移除 keep-alive、修正 CTA／README／架構與 Ops 文件 | AH-04 | ⬜ 未開始 | Cloudflare 正式 URL 正常；GitHub Pages 不再部署；無舊正式網址與 stale runbook |
| AH-06 | L3 判讀移出關鍵路徑 | `run-agents.sh` 改為發布後獨立排程／工作；狀態與新聞發布分離 | AH-02 | ⬜ 未開始 | 新聞發布不等待 L3；preview／manual-only 邊界、鎖、失敗降級與觀測維持 |
| AH-07 | 增量驗證與來源健康度 | 新資料完整驗證、內容 hash／TTL、needs-review 退避、來源 circuit breaker、7／30 日指標 | AH-01, AH-02 | ⬜ 未開始 | 不重驗未變且 TTL 有效資料；錯誤不被快取為成功；可重現、可清除、可觀測 |
| AH-08 | Firebase v3 個人資料模型 | bookmarks／feedback／tombstones 子集合、server timestamp、雙讀／雙寫、Firestore emulator rules tests | AH-01 | ⬜ 未開始 | v2 與 v3 可回滾共存；規則正反例通過；單文件容量與整張 map 重寫風險解除 |
| AH-09 | Firebase v3 切換與真實驗收 | 遷移 receipt、數量／hash 對帳、多帳號／多裝置、舊客戶端與離線重連 | AH-08 | ⬜ 未開始 | 真實 Firebase 證據齊全；失敗可回滾；觀察期前不移除 v2 |
| AH-10 | 冷封存分片與容量保護 | `archives/{date}` metadata、categories 子集合、size guard、前端按需讀取、遷移工具 | AH-08 | ⬜ 未開始 | 單文件不接近 1 MiB；舊 archive 相容；上傳後核 hash 才 prune；真實寫入另驗 |
| AH-11 | Git 控制面／資料面分離 | protected `main`、content release、專用 publisher identity、ruleset、雙 SHA release | AH-03, AH-04 | ⬜ 未開始 | 程式碼需 CI／審查；每日內容不與程式開發爭用 index；publisher 僅能發布允許產物 |
| AH-12 | 雲端原始證據備援 | 官方 RSS／API 輕量備援、冪等 raw evidence、主機未跑時沿用可靠資料 | AH-07, AH-11 | ⬜ 未開始 | 備援不自行生成無證據摘要；主／備不重複發布；本機失效仍有透明 freshness 狀態 |
| AH-13 | 前端安全與可維護性收尾 | 移除 inline handler、CSP、Firebase SDK 供應鏈控制、拆分 dashboard 大模組 | AH-03, AH-05 | ⬜ 未開始 | CSP 不依賴 unsafe-inline；功能與手機回歸通過；載入順序契約更新且無全域漂移 |

## 4. 分階段 Release Gates

### Gate A — 資料品質核心（AH-01～AH-03）

- schema 正反 fixture 與歷史相容測試通過。
- hard integrity error 必須為 0；官方資訊／模型的公司網域與證據一致率為 100%。
- 未達標分類不得覆蓋上一版可靠資料。
- release manifest 可重現並綁定精確內容 hash。

### Gate B — 正式發布收斂（AH-04～AH-07）

- 相同 SHA 的 CI、Cloudflare deployment 與線上 hash 一致。
- 通知只在 post-deploy 驗證成功後產生。
- Cloudflare 成為單一正式入口；L3 與增量驗證不破壞每日發布主路徑。

### Gate C — Firebase 資料層（AH-08～AH-10）

- Emulator 規則測試及真實多帳號／多裝置驗收分開記錄。
- v2 至 v3 migration 有 receipt、對帳及回滾；觀察期前保留舊讀取能力。
- archive 上傳先驗內容 hash／尺寸，成功後才 prune 本機檔。

### Gate D — 控制面與長期維護（AH-11～AH-13）

- `main` 有實際生效的 ruleset；自動 publisher 權限與可寫範圍可驗證。
- 主／備擷取冪等且 provenance 可追溯。
- CSP、供應鏈與前端模組化回歸完成，不以大量框架重寫取代漸進改善。

## 5. 每個 Session 的退出格式

1. 工項狀態：✅完成／🟡部分／❌受阻，附 commit、分支與是否 push。
2. 變更：只列本工項實際落地的程式、資料契約與文件。
3. 驗證：列離線測試、建置、live／external evidence，明確區分未執行項。
4. 風險與回滾：列仍存在限制及回退入口。
5. 下一個 Session Prompt：完整可複製，至少含專案路徑、必讀文件、工項 ID、前置／勿動、驗收、提交／交接要求。

## 6. Re-scan 紀錄

| 日期 | 基準 | 結果 |
|---|---|---|
| 2026-09-19 | `main` `1230eba` | AH-00 建立；線上 Cloudflare 與本機 latest hash 一致；GitHub Pages 仍啟用；repository ruleset 為空；下一工項 AH-01 |
