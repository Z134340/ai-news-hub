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
| AH-01 | 資料契約 v2 與相容遷移 | JSON Schema、`schema_version`、模型舊資料 migration、`source_title`、canonical URL、穩定 `item_id` | AH-00 | ✅ 本工項離線驗收完成 | 舊封存可讀；缺欄位不靠猜測補值；模型格式升級不再整批誤刪；離線正反 fixture 通過 |
| AH-02 | 分類級品質閘與可靠資料沿用 | candidate／published／quarantine、分類門檻、last-known-good、`_checked_at`／`_update_outcome` | AH-01 | ✅ 本工項離線驗收完成 | 未達標分類不覆蓋正式資料；其他分類可發布；課程可區分 no-change 與 failed |
| AH-03 | 發布 manifest 與高效率讀取 | `release-manifest` schema、release ID、內容 hash、前端只在版本改變時取大型資料、版本化 cache | AH-02 | ✅ 本工項離線驗收完成 | manifest 小型輪詢；內容與 manifest hash 綁定；舊前端相容與載入失敗降級通過 |
| AH-04 | 部署後驗證、通知與 Cloudflare 回滾 | CI post-deploy smoke/hash/header、通知改為部署成功後、指定已驗證 SHA 的人工回退 | AH-03 | 🟡 implementation／offline validation／repository workflow configuration 完成；Gate A、activation、production authorization 與 live gate 受阻 | 通知不早於 production；錯誤 hash 阻擋成功；回退流程有 dry-run／驗收證據 |
| AH-05 | 單一正式入口與文件收斂 | 停用 GitHub Pages、移除 keep-alive、修正 CTA／README／架構與 Ops 文件 | 原規劃 AH-04；平台工項先行完成 | ✅ 已完成（`main` `d35ad49`） | Cloudflare 正式 URL 正常；GitHub Pages 已停用並回應 404；Pages 專用 keep-alive、舊網址與 Jekyll 遺留已移除。此狀態不代表 AH-04 或 Gate B 其他項完成 |
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

離線交付狀態：AH-01～AH-03 的實作與指定回歸已完成；AH-03 build artifact 的 manifest 可重現且四份受管理資產 hash 一致。Gate A 尚未成為 production release gate 通過：AH-01 v2 尚未遷移正式資料，AH-02 尚未整合／啟用正式 store，AH-03 尚未部署，且上述品質與 hash 尚無相同 release 的 production/live evidence 或啟用授權。2026-09-22 最新 live gate 唯讀核對時，`origin/main` 仍為每日資料提交 `5e63180cbf813763ec80fc77bcc6788b71b898bc`，舊版 workflow run `35555515973` 建立 GitHub deployment `6560744792`；但該 SHA 仍不含 AH-01～AH-04。固定 production URL 的四份受管理資產 required headers 均存在，bytes／SHA-256 全數與此 `origin/main` 一致，public `latest.json` 仍沒有 `schema_version`／`_update_outcome`／`_checked_at`，`data/release-manifest.json` 仍回傳與首頁完全相同的 `200 text/html` SPA fallback（5,809 bytes；SHA-256 `97907cf390663d809c2b3f7474aead6440b103cfe5ebe1560d2af74c6a20e7bf`），不是 manifest JSON。這是 AH-01～AH-03 前的 legacy production deployment，不是 Gate A 或 AH-03 的 production 驗收。

### Gate B — 正式發布收斂（AH-04～AH-07）

- 相同 SHA 的 CI、Cloudflare deployment 與線上 hash 一致。
- 通知只在 post-deploy 驗證成功後產生。
- Cloudflare 成為單一正式入口；L3 與增量驗證不破壞每日發布主路徑。

離線交付狀態：AH-04 verifier、append-only receipt、verified-only 通知與 Cloudflare rollback plan／execute 已完成實作與 fixture 驗證；AH-05 已完成。先前 HEAD 的 deploy run `35456640348` 與 rollback run `35456640876` 均為 0-job workflow file failure；修復後以 step-level `runner.temp` 初始化 runtime receipt path，並在「離線自測」加入固定版本／checksum 的 `actionlint v1.7.12`。最新已驗證遠端證據 HEAD `650fddf98405439becc74bbf5af0c2f06f32fa1c` 只有完整 SHA 相符且成功的「離線自測」run `35621226326`，semantic validation step 通過；本地以 macOS arm64 官方 checksum `aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f` 重新驗證相同 actionlint 版本後仍為 0 error，四處原 context error 為 0，workflow 防漂移測試 4/4，AH-04 verifier／workflow 正反例合計 21/21。該 SHA 沒有 GitHub deployment、artifact 或 production upload。`origin/main` 的 legacy workflow 於每日資料 SHA `5e63180cbf813763ec80fc77bcc6788b71b898bc` 建立 deployment `6560744792`，但 run 與 repository 都沒有 deployment／rollback receipt artifact；`Push Notification` run `35555495653` 在 deploy run `35555515973` 開始前已完成，未啟用 AH-04 verified-only 順序。AH-01～AH-03 仍未整合／啟用／部署，本次也沒有 production 授權，因此沒有 AH-04 live receipt、verified-only 通知或 rollback 證據；AH-06／AH-07 尚未開始。Gate B 尚未通過，下一個 Session 仍須處理 AH-04 的 Gate A／activation／authorization blocker，不得前進 AH-06。

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
| 2026-09-19 | AH-01 分支 `codex/ah-01-data-contract-v2`；規劃基準 `37947c2`；兩次 fetch 的 `origin/main` 均為 `1230eba`，已包含於基準 | 五份 v2 schemas、離線 migration／診斷、共用 URL／ID 與標題契約已實作且離線驗收通過；未改正式資料或部署，下一工項 AH-02。Gate A 整體尚未完成 |
| 2026-09-19 | `origin/main` `d35ad49`；AH-01 realigned 分支 `codex/ah-01-data-contract-v2-realigned`；實作 `a3a0f52`、反例補強 `6c516fc` | 重新對齊停用 GitHub Pages 後的最新基準；AH-05 依 main 與 `HANDOFF.md` 的既有外部證據改標完成。AH-01 doc×code re-scan、完整離線回歸、七份實際快照 migration 與明確偽造／canonical 重複反例通過；未做 production mutation／部署／live 驗收，下一工項 AH-02。Gate A 與 Gate B 整體均未完成 |
| 2026-09-19 | AH-02 分支 `codex/ah-02-category-quality-gates`；既有實作 `a2982ec`；以普通 merge `f6ab241d81df3faf66873e044bb557d4de5ea018` 納入指定 AH-01 `4ba34f492c3d4da320d9d0906cc33cba117feb0d`；worktree `/private/tmp/ai-news-hub-ah02-20260919` | 分類政策、私有 candidate／validated／quarantine／LKG 儲存、每日與補跑共同入口、時間與 outcome 已實作；doc×code re-scan 後補同批 mixed fixture，103 項 Python 與既有離線回歸通過。本工項離線驗收完成，下一工項 AH-03。未整合 main／部署／正式擷取；Gate A 整體尚未完成 |
| 2026-09-20 | AH-03 分支 `codex/ah-03-release-manifest-efficient-read`；指定 AH-02 基準 `697ac222ef14d87c873f5b02b100db945d6bc8c0`；實作 `8da8e1c9a4e666dc50227ddb51fc9588060ec92b`；worktree `/private/tmp/ai-news-hub-ah03-20260919` | manifest schema／穩定 identity、build-last 產生、前端最小讀取／逐資產驗 hash／版本化 LKG cache／legacy 分流已實作；re-scan 補上「曾有 verified release 後 manifest 404」不得降格 legacy 的正反例。指定 AH-01／AH-02 與全套離線回歸通過；未改正式資料、設定或外部 state，未部署／live 驗收／授權。Gate A production gate 仍未完成，下一工項 AH-04 |
| 2026-09-20 | AH-04 分支 `codex/ah-04-post-deploy-verify-notify-rollback`；指定 AH-03 基準 `e723741d1cc597ac141fa8e74413b995f8835180`；實作 `b7219c5`；worktree `/private/tmp/ai-news-hub-ah04-20260920` | fixed production URL verifier、append-only receipt、verified-only 冪等通知與 rollback plan／execute 已實作；doc×code re-scan 確認四資產／headers／SHA／release identity／workflow 與 allowlist 一致。AH-04 20 項、Node 67 項、Python 103 項及既有離線回歸通過；未整合 main、未變更 production／外部設定，未部署／通知／回滾／live 驗收／取得授權。工項為 partial，下一個 Session 先完成 AH-04 live gate，不前進 AH-06 |
| 2026-09-20 | AH-04 live gate preflight；遠端 HEAD `31598f1b646b2ea1d296a0462974a97f1977a423`；`origin/main` `d35ad49ee5b12d84cd5dd1dab94784985424a04e` | fetch 後遠端 AH-04 HEAD 與本機完全一致；「離線自測」run `35456015232` 對同 SHA 成功，但 AH-01～AH-04 SHA 均不在 `origin/main`。GitHub 對 deploy `35456014728`／rollback `35456014281` 產生 0-job workflow file failure，外部語意核對定位為 job-level `env` 不可使用 `runner.temp`。repo-level Cloudflare secrets 名稱存在；值／token scope 不可讀，`production` environment 無 protection rule 且 workflow 未綁定它；`main` 未保護、ruleset 空（屬 AH-11/Gate D，不能冒稱已完成）。固定 production URL 正常由 Cloudflare 回應，舊四資產 hash 與 main 一致，但 manifest URL 是 HTML fallback；沒有 AH-04 receipt artifact、release ID、通知或 rollback 證據。因沒有 main／production 明確授權且 Gate A、workflow configuration 均未過，只更新 blocker 與交接，未執行任何 production mutation；下一 Session 仍是 AH-04，不前進 AH-06 |
| 2026-09-20 | AH-04 workflow context blocker 修復；implementation `f2ec17b57f04b72e8a0b0970fca8e81b963edbfb`；驗證 HEAD `09a5a0440b4bd41b7c43fa304248ec53153310e1`；`origin/main` `d35ad49ee5b12d84cd5dd1dab94784985424a04e` | deploy 1 處、rollback 3 處 receipt path 改在 step-level `runner.temp` 解析後透過 `GITHUB_ENV` 提供後續 steps；selftest 新增固定 actionlint 版本與 checksum。首次 push run `35458079156` 已成功建立 job、證明 workflow parser blocker 清零，但因 actionlint 同時拾取既有非本工項 shellcheck 告警而失敗；收斂為 workflow semantic check 後 run `35458146815` 對完整 HEAD 成功，四處 context error 為 0。該 HEAD 只產生 selftest run且無 GitHub deployment，沒有 production upload。Gate A re-check 仍為未通過：AH-01 migration、AH-02 store activation、AH-03 deployment 均不存在且未獲授權；production 仍是 main 舊四資產，manifest URL 為 HTML fallback。AH-04 保持 partial，下一 Session 仍處理 Gate A／activation／authorization blocker，不前進 AH-06 |
| 2026-09-20 | AH-04 Gate A／runtime activation／authorization re-check；遠端 HEAD `49ad32c05800887bc5c93f84d3b54957576fb46f`；`origin/main` `1ebe19bcdb0e3fef7c40f4420270aeacb4856efc` | fetch 後本地／遠端 AH-04 HEAD 完全一致；「離線自測」run `35486192783` 成功且 head SHA 完全一致，該 SHA 只有此 selftest run、deployments 為空。AH-01 `4ba34f4`、AH-02 `697ac22`、AH-03 `e723741` 與 AH-04 HEAD 全數不在 `origin/main`。main 的 2026-09-20 每日資料提交以舊 workflow run `35484454661` 部署，GitHub deployment ID `6548240171`；該 run 無 artifact，repo 也無 deployment／rollback receipt artifact。固定 production URL 之 index 與四份資產 bytes／SHA-256 全數等於此 main，但 latest 仍無 v2／quality metadata，manifest endpoint 仍是 `200 text/html` SPA fallback；證明這只是 legacy deploy，不是 AH-03／AH-04 runtime activation。repo secrets 名稱仍只能確認存在，值／scope 不可見；`production` environment 無 protection／secret，Actions 啟用且 allowed actions=all／未強制 SHA pin／default token read，`main` 未保護、ruleset 為空，Cloudflare dashboard production branch／token scope 仍無可用 credential 直接核對。本 Session 明確未授權 main 整合、migration、store activation 或 deployment，也無 verified target receipt 可做 rollback plan；因此僅更新 blocker，AH-04 保持 partial，不開始 AH-06 |
| 2026-09-20 | AH-04 Gate A／runtime activation／authorization re-check；最新已驗證遠端證據 HEAD `f40633ff51492368d756cc41b5bdc6e583e57e51`；`origin/main` `1ebe19bcdb0e3fef7c40f4420270aeacb4856efc` | fetch 後本地／遠端 AH-04 HEAD 完全一致；「離線自測」run `35486353274` 成功且 head SHA 完全一致，該 SHA 只有此 selftest run，deployments 與 artifacts 均為空。AH-01 `4ba34f4`、AH-02 `697ac22`、AH-03 `e723741` 與 AH-04 HEAD 全數不在 `origin/main`；沒有新的 deploy／rollback run 或 workflow-file failure。main 的最新 production 仍是舊 workflow run `35484454661` 與 GitHub deployment `6548240171`；該 run 與 repo 都沒有 receipt artifact，舊 `Push Notification` run `35484436860` 仍早於 deploy。固定 production URL 之 index 與四份資產 bytes／SHA-256 全數等於 main，但 latest 仍無 v2／quality metadata，manifest endpoint 仍是與首頁 bytes 相同的 `200 text/html` SPA fallback；這仍只是 legacy deploy，不是 AH-03／AH-04 runtime activation。repo secrets 名稱、`production` environment、Actions permissions、main protection 與 rulesets 均未變；secrets 值／scope 與 Cloudflare dashboard production branch／token scope 仍不可由現有憑證核對。本 Session 明確未授權 main 整合、migration、store activation 或 deployment，也無 verified target receipt 可做 rollback plan；只刷新 blocker，AH-04 保持 partial，不開始 AH-06 |
| 2026-09-20 | AH-04 Gate A／runtime activation／authorization re-check；最新已驗證遠端證據 HEAD `948eb342c4c1d65d40197963728cfe423b46448e`；`origin/main` `1ebe19bcdb0e3fef7c40f4420270aeacb4856efc` | fetch 後本地／遠端 AH-04 HEAD 完全一致；「離線自測」run `35490153352` 成功且 head SHA 完全一致，該 SHA 只有此 selftest run，deployments 與 artifacts 均為空。AH-01 `4ba34f4`、AH-02 `697ac22`、AH-03 `e723741` 與 AH-04 HEAD 全數不在 `origin/main`；沒有新的 deploy／rollback run、workflow-file failure 或 receipt artifact。main 的最新 production 仍是舊 workflow run `35484454661` 與 GitHub deployment `6548240171`；該 run 無 artifact，舊 `Push Notification` run `35484436860` 仍早於 deploy。固定 production URL 之 index 與四份資產 bytes／SHA-256 全數等於 main，但 latest 仍無 v2／quality metadata，manifest endpoint 仍是與首頁 bytes 相同的 `200 text/html` SPA fallback；這仍只是 legacy deploy，不是 AH-03／AH-04 runtime activation。repo secrets 名稱、`production` environment、Actions permissions、main protection 與 rulesets 均未變；secrets 值／scope 與 Cloudflare dashboard production branch／token scope 仍不可由現有憑證核對。本 Session 明確未授權 main 整合、migration、store activation 或 deployment，也無 verified target receipt 可做 rollback plan；只刷新 blocker，AH-04 保持 partial，不開始 AH-06 |
| 2026-09-20 | AH-04 Gate A／runtime activation／authorization re-check；最新已驗證遠端證據 HEAD `6531c5286f064a6f1517792c37626395be81ad90`；`origin/main` `1ebe19bcdb0e3fef7c40f4420270aeacb4856efc` | fetch 後本地／遠端 AH-04 HEAD 完全一致；「離線自測」run `35514225784` 成功且 head SHA 完全一致，該 SHA 只有此 selftest run，deployments 與 artifacts 均為空。AH-01 `4ba34f4`、AH-02 `697ac22`、AH-03 `e723741` 與 AH-04 HEAD 全數不在 `origin/main`；沒有新的 deploy／rollback run、workflow-file failure 或 receipt artifact。main 的最新 production 仍是舊 workflow run `35484454661` 與 GitHub deployment `6548240171`；該 run 無 artifact，舊 `Push Notification` run `35484436860` 仍早於 deploy。固定 production URL 之 index 與四份資產 bytes／SHA-256 全數等於 main，但 latest 仍無 v2／quality metadata，manifest endpoint 仍是與首頁 bytes 相同的 `200 text/html` SPA fallback；這仍只是 legacy deploy，不是 AH-03／AH-04 runtime activation。repo secrets 名稱、`production` environment、Actions permissions、main protection 與 rulesets 均未變；secrets 值／scope 與 Cloudflare dashboard production branch／token scope 仍不可由現有憑證核對。本 Session 明確未授權 main 整合、migration、store activation 或 deployment，也無 verified target receipt 可做 rollback plan；只刷新 blocker，AH-04 保持 partial，不開始 AH-06 |
| 2026-09-20 | AH-04 Gate A／runtime activation／authorization re-check；最新已驗證遠端證據 HEAD `098ea71384d1929fcbb48293730a0d1ce3c48157`；`origin/main` `1ebe19bcdb0e3fef7c40f4420270aeacb4856efc` | fetch 後本地／遠端 AH-04 HEAD 完全一致；「離線自測」run `35515416808` 成功且 head SHA 完全一致，semantic validation step 通過，該 SHA 只有此 selftest run，deployments 與 artifacts 均為空。AH-01 `4ba34f4`、AH-02 `697ac22`、AH-03 `e723741` 與 AH-04 HEAD 全數不在 `origin/main`；沒有新的 deploy／rollback run、workflow-file failure 或 receipt artifact。main 的最新 production 仍是舊 workflow run `35484454661` 與 GitHub deployment `6548240171`；該 run 無 artifact，舊 `Push Notification` run `35484436860` 仍早於 deploy。固定 production URL 之 index 與四份資產 bytes／SHA-256 全數等於 main，但 latest 仍無 v2／quality metadata，manifest endpoint 仍是與首頁 bytes 相同的 `200 text/html` SPA fallback；這仍只是 legacy deploy，不是 AH-03／AH-04 runtime activation。repo secrets 名稱、`production` environment、Actions permissions、main protection 與 rulesets 均未變；secrets 值／scope 與 Cloudflare dashboard production branch／token scope 仍不可由現有憑證核對。本 Session 明確未授權 main 整合、migration、store activation 或 deployment，也無 verified target receipt 可做 rollback plan；只刷新 blocker，AH-04 保持 partial，不開始 AH-06 |
| 2026-09-20 | AH-04 Gate A／runtime activation／authorization re-check；最新已驗證遠端證據 HEAD `09b6bc67000e0097d227fe703db6771c0c7627e6`；`origin/main` `1ebe19bcdb0e3fef7c40f4420270aeacb4856efc` | fetch 後本地／遠端 AH-04 HEAD 完全一致；「離線自測」run `35516334404` 成功且 head SHA 完全一致，semantic validation step 通過，該 SHA 只有此 selftest run，deployments 與 artifacts 均為空。AH-01 `4ba34f4`、AH-02 `697ac22`、AH-03 `e723741` 與 AH-04 HEAD 全數不在 `origin/main`；沒有新的 deploy／rollback run、workflow-file failure 或 receipt artifact。main 的最新 production 仍是舊 workflow run `35484454661` 與 GitHub deployment `6548240171`；該 run 無 artifact，舊 `Push Notification` run `35484436860` 仍早於 deploy。固定 production URL 之 index 與四份資產 bytes／SHA-256 全數等於 main，但 latest 仍無 v2／quality metadata，manifest endpoint 仍是與首頁 bytes 完全相同的 `200 text/html` SPA fallback（5,809 bytes；SHA-256 `97907cf390663d809c2b3f7474aead6440b103cfe5ebe1560d2af74c6a20e7bf`）；這仍只是 legacy deploy，不是 AH-03／AH-04 runtime activation。repo secrets 名稱、`production` environment、Actions permissions、main protection 與 rulesets 均未變；secrets 值／scope 與 Cloudflare dashboard production branch／token scope 仍不可由現有憑證核對。本 Session 明確未授權 main 整合、migration、store activation 或 deployment，也無 verified target receipt 可做 rollback plan；只刷新 blocker，AH-04 保持 partial，不開始 AH-06 |
| 2026-09-20 | AH-04 Gate A／runtime activation／authorization re-check；最新已驗證遠端證據 HEAD `f6ac864217f72b828f7a62b9b83984a4560a2e95`；`origin/main` `1ebe19bcdb0e3fef7c40f4420270aeacb4856efc` | fetch 後本地／遠端 AH-04 HEAD 完全一致；「離線自測」run `35520642509` 成功且 head SHA 完全一致，semantic validation step 通過，該 SHA 只有此 selftest run，deployments 與 artifacts 均為空。AH-01 `4ba34f4`、AH-02 `697ac22`、AH-03 `e723741` 與 AH-04 HEAD 全數不在 `origin/main`；沒有新的 deploy／rollback run、workflow-file failure 或 receipt artifact。main 的最新 production 仍是舊 workflow run `35484454661` 與 GitHub deployment `6548240171`；該 run 無 artifact，舊 `Push Notification` run `35484436860` 仍早於 deploy。固定 production URL 的 index 與四份資產 bytes／SHA-256 全數等於 main；latest 仍無 `schema_version`／`_update_outcome`／`_checked_at`，manifest endpoint 仍是與首頁 bytes 完全相同的 `200 text/html` SPA fallback（5,809 bytes；SHA-256 `97907cf390663d809c2b3f7474aead6440b103cfe5ebe1560d2af74c6a20e7bf`）；這仍只是 legacy deploy，不是 AH-03／AH-04 runtime activation。repo secrets 只能確認 `CLOUDFLARE_ACCOUNT_ID`／`CLOUDFLARE_API_TOKEN` 名稱存在；`production` environment 無 protection rule／environment secret且 workflow 未綁定，Actions enabled／allowed actions=all／未強制 SHA pin／default token read，main 無 protection／ruleset。secrets 值／scope與 Cloudflare dashboard production branch／token scope仍無可用 credential 直接核對。本 Session 明確未授權 main 整合、migration、store activation 或 deployment，也無 verified target receipt 可做 rollback plan；只刷新 blocker，AH-04 保持 partial，不開始 AH-06 |
| 2026-09-21 | AH-04 Gate A／runtime activation／authorization re-check；最新已驗證遠端證據 HEAD `d628d628cbbc4d12c4d22a2dac0c026374594994`；`origin/main` `5e63180cbf813763ec80fc77bcc6788b71b898bc` | fetch 後本地／遠端 AH-04 HEAD 完全一致；「離線自測」run `35521305258` 成功且 head SHA 完全一致，semantic validation step 通過，該 SHA 沒有 deployment 或 artifact。AH-01 `4ba34f4`、AH-02 `697ac22`、AH-03 `e723741` 與 AH-04 HEAD 全數不在 `origin/main`。main 的最新 legacy production run `35555515973` 建立 deployment `6560744792` 但沒有 receipt artifact；push notification run `35555495653` 仍早於 deploy。production 首頁與四資產精確等於 main：index `97907cf…7bf`、latest `89f3b569…d22`、health `db90da5c…26b6`、data index `c5295dd9…7a50`、skills `16bb4b54…7c65`；latest 無 v2／quality metadata，manifest endpoint 仍是與首頁相同的 `200 text/html` fallback。repo secrets 只可見兩個名稱；`production` environment 無 protection／secret，Actions allowed actions=all／default token read，main 無 protection／ruleset；secrets 值／scope與 Cloudflare dashboard production branch／token scope未能核對。本 Session 沒有 main 整合、migration、store activation、deployment 或 rollback execute 授權，也無 verified target receipt；只刷新 blocker，AH-04 保持 partial，不開始 AH-06 |
| 2026-09-21 | AH-04 Gate A／runtime activation／authorization re-check；最新已驗證遠端證據 HEAD `b0258fa6502594a7fda8849f71f8dfc494df8bc9`；`origin/main` `5e63180cbf813763ec80fc77bcc6788b71b898bc` | fetch 後本地／遠端 AH-04 HEAD 完全一致；「離線自測」run `35619501887` 成功且 head SHA 完全一致，semantic validation step 通過，該 SHA 只有此 selftest run，deployments 與 artifacts 均為空。AH-01 `4ba34f4`、AH-02 `697ac22`、AH-03 `e723741` 與 AH-04 HEAD 全數不在 `origin/main`；沒有新的 deploy／rollback run、workflow-file failure 或 receipt artifact。main 的最新 legacy production run `35555515973` 建立 deployment `6560744792` 但沒有 receipt artifact；push notification run `35555495653` 仍早於 deploy。production 首頁與四資產精確等於 main：index `97907cf…7bf`、latest `89f3b569…d22`、health `db90da5c…26b6`、data index `c5295dd9…7a50`、skills `16bb4b54…7c65`；latest 無 v2／quality metadata，manifest endpoint 仍是與首頁相同的 `200 text/html` fallback。repo secrets 只可見兩個名稱；`production` environment 無 protection／secret，Actions allowed actions=all／default token read，main 無 protection／ruleset；secrets 值／scope與 Cloudflare dashboard production branch／token scope未能核對。本 Session 沒有 main 整合、migration、store activation、deployment 或 rollback execute 授權，也無 verified target receipt；只刷新 blocker，AH-04 保持 partial，不開始 AH-06 |
| 2026-09-22 | AH-04 Gate A／runtime activation／authorization re-check；最新已驗證遠端證據 HEAD `650fddf98405439becc74bbf5af0c2f06f32fa1c`；`origin/main` `5e63180cbf813763ec80fc77bcc6788b71b898bc` | fetch 後本地／遠端 AH-04 HEAD 完全一致；「離線自測」run `35621226326` 成功且 head SHA 完全一致，semantic validation step 通過，該 SHA 只有此 selftest run，deployments 與 artifacts 均為空。AH-01 `4ba34f4`、AH-02 `697ac22`、AH-03 `e723741` 與 AH-04 HEAD 全數不在 `origin/main`；沒有新的 deploy／rollback run、workflow-file failure 或 receipt artifact。main 的最新 legacy production run `35555515973` 建立 deployment `6560744792`，但 run 與 repository 都沒有 deployment／rollback receipt artifact；push notification run `35555495653` 仍早於 deploy。production 首頁與四資產 required headers 均存在且 bytes／SHA-256 精確等於 main：index `97907cf…7bf`、latest `89f3b569…d22`、health `db90da5c…26b6`、data index `c5295dd9…7a50`、skills `16bb4b54…7c65`；latest 無 v2／quality metadata，manifest endpoint 仍是與首頁相同的 `200 text/html` fallback。repo secrets 只可見兩個名稱；`production` environment 無 protection／secret，Actions allowed actions=all／default token read，main 無 protection／ruleset；secrets 值／scope與 Cloudflare dashboard production branch／token scope未能核對。本 Session 沒有 main 整合、migration、store activation、deployment 或 rollback execute 授權，也無 verified target receipt；只刷新 blocker，AH-04 保持 partial，不開始 AH-06 |

### AH-01 驗收與邊界（2026-09-19）

- 隔離 worktree `/private/tmp/ai-news-hub-ah01-20260919`；分支以 `origin/main` `d35ad49` 為祖先，保留 AH-00 規劃與 AH-01 實作。原遠端分支已有舊歷史，依不得 force-push 規則改用 `codex/ah-01-data-contract-v2-realigned` 交付。main 工作目錄保持乾淨，未 reset／force-push；實作提交 `a3a0f52`、反例補強 `6c516fc`。
- 實作／migration SOP 與純函式入口：`docs/shapes/data-contract-v2.md`。原始 URL／title／model_name／日期保持不變，沒有切換前端 itemKey 或 Firebase key；既有 renderer 的 truthy verified 改成嚴格 true，needs_review 明確顯示待複核。

| 驗收 | 實際結果 |
|---|---|
| `test_data_contract.py` | 32/32：schema 正例、缺欄位／錯型別／未知 root/item version、偽造 primary/evidence URL、重複 canonical URL、legacy 正反例、保留事實／缺值、sidecar 原件、CLI 防覆寫、冪等、URL tracking/query、穩定 ID、真實前端 itemKey、四類診斷、source_title 核對、舊 validation 不冒充成功、prompt 同步 |
| `scripts/tests/test_robustness.py` | 27/27；合計 unittest discover 59/59 |
| `validate.py --self-test`、`merge-stack.py --self-test` | 24 項與 3 項通過，無網路／正式寫入 |
| 前端／trend-topics／fetch-skills Node 回歸 | 37/37；含 v2 顯示、needs_review 與書籤相容 |
| 既有離線 regression | 28 組命令通過：18 個 agent Node self-test、strict boundary、run-agents（68 項）、slack-notify self-test、4 個 Python model-wrapper selftest、Node suites、build、archive dry-run；未執行模型正式擷取／通知 |
| 語法與 build allowlist | 8 份受影響 Python AST、15 份 Node 逐檔、3 份 Shell 通過；Cloudflare build 成功，dist 有 index/headers/latest，沒有 scripts/docs/schemas/.git |
| 封存 dry-run | 成功退出，沒有符合上傳條件的 archive；不是 Firebase 寫入驗收 |
| 本機 Browser fixture | 外部連線封鎖、Firebase SDK 移除的測試副本：官方資訊繁中標題、舊模型原摘要、待複核、收藏新增／重載保留／移除均通過；未連正式 Firebase |
| 唯讀實際快照 migration re-scan | latest ＋ 9/14–9/19 六份封存，全數 schema_errors=0、quarantine=0；模型保留數 10、28、26、26、26、26、10。這是結構／保留驗證，不是內容真實性驗證 |
| 差異檢查與勿動範圍 | git diff --check 通過；data、Firebase、Cloudflare／Pages／CI 設定與 learning-loop 控制檔零差異 |

未執行：正式每日擷取、既有資料原文／翻譯與官方內容補證、production migration、Firebase 雲端驗收、main 整合、正式網站部署、AH-02 發布閘及後續工項。現有快照的來源／顯示標題仍不完整；例如 latest 199 筆、9/18 193 筆在純 migration 均是 needs_review，不能視為 Gate A 已完成。未來 producer 的雙標題提示已改，但須在另行核准的正常週期核實實際效果。

風險／回退：canonical 規則保留 ref/source 與尾斜線，可能使先前過度合併的資料分開；不自動推斷 redirect／同頁多事件身分。離線 schema evaluator 只支援已登錄 vocabulary，不是任意 schema 引擎。需要撤回時，在獨立分支依序 revert `6c516fc` 與 `a3a0f52`，保留 AH-00 與 `d35ad49` 之後每日資料；正式資料此次未改，無資料反向遷移。新 migration 輸出可捨棄，原 input 與 lossless report 保留。


### AH-02 驗收與邊界（2026-09-19）

- worktree `/private/tmp/ai-news-hub-ah02-20260919`，以指定 AH-01 `4ba34f492c3d4da320d9d0906cc33cba117feb0d` 為基準；保留 AH-00 規劃與最新每日資料。權威政策／失敗行為見 `category-quality.md`，程式與測試入口見 `../shapes/category-quality.md`。
- 十二分類各自評估，最低 1 筆、全候選合格、硬錯誤 0；成功空陣列另記 no_change。legacy／needs_review 不得成為新發布或 LKG。只使用經品質閘選出的前版，不自動相信既有 latest／分類檔。
- 每日與 supplement 先保存私有原件，再逐分類驗證與選擇；已通過的 skills 不再被前端舊 sidefile 蓋掉。保留 v2 schemas、canonical URL／item_id、migration 與原書籤 ID。

| 驗收 | 實際結果／fixture 證據 |
|---|---|
| 全分類、混合批次、單分類失敗、全部失敗 | `fixtures/category-quality/mixed-batch.json` 與 `test_category_quality.py`：同批 updated／fetch_failed／no_change 各自正確；合格分類前進；失敗分類精確沿用自己 LKG；整體比例不能代替分類決策 |
| 部分畸形／容器錯誤／標量 | 該分類整批失敗，其餘分類正常；validator schema pruning 後的原始位置仍正確 |
| 無前版／hash 損壞／只有待複核 | 明確 no_reliable_data；無 `_updated_at`；不把 legacy 或 needs_review 升級為可靠前版 |
| 課程 no-change 與 failed | 明確成功空陣列與非零 exit／缺檔／無法解析分開；無前版的 no_change 仍標不可用 |
| 三種時間／狀態 metadata | schema 正反例、無變更、失敗、未排程、未來或無效時點；無 LKG 的 checked 歷史亦跨世代保留 |
| 原件、寫入失敗與重跑 | raw bytes／每次 attempt／來源位置保留；generation／output／pointer 失敗均保護前版；相同 request 冪等；過時 attempt 與中斷後已有新世代的重跑拒絕；損壞 retry 不得偽造 updated |
| 真實 adapter／每日安裝接線 | 真實 daily 私有目錄初始化、注入來源回應、真實 validator＋品質 adapter＋daily 安裝／日期封存／狀態計數；所有 I/O 使用暫存目錄 |
| Python 全套 | 103/103：AH-02 44、AH-01 schema／migration／書籤相容 32、robustness 27 |
| validator／merge self-test | 24/24、3/3；共用分類日期政策，未連外驗來源 |
| Node 回歸 | 39/39：frontend／trend-topics／fetch-skills；新增品質閘 skills 不被覆蓋及舊快照相容 |
| 既有離線回歸 | 25 組命令全通過：18 個 agent Node、strict boundary、run-agents 68 項、slack-notify、4 個 Python wrapper；無正式模型或通知 |
| 語法、allowlist、HTTP、dry-run | 受影響 Python AST、15 份 Node 逐檔、2 份 Shell 通過；暫存 fixture Cloudflare allowlist build 排除 scripts/docs/schemas/.git/private-quarantine；本機 HTTP 首頁／data.js／latest 200；封存 dry-run 找到 1 個 fixture，未上傳 |
| 範圍與空白 | `git diff --check`；正式 data、Firebase、Cloudflare／Pages／CI 設定及 learning 控制檔零差異；main 工作目錄保持原狀 |

Re-scan：分類閘及補跑繞過問題已處理；既有複查發現的「中斷重跑覆蓋中間更新」與「無 LKG 時未排程遺失 checked」均已修復並納入回歸。本次以普通 merge 對齊 AH-01 `4ba34f4`，保留偽造 URL／重複 canonical URL 反例；doc×code 對賬另發現三種 outcome 雖分別有測試、但缺同批具名 fixture，已新增 mixed-batch fixture 與單批斷言。AH-03 release manifest／版本化讀取仍未開始；AH-04 之後項目、L3 關鍵路徑、Firebase v3、通知時機與 learning 人工邊界均未變。下一個 Session 只做 AH-03。

未執行：正式每日擷取／真實來源品質驗收、production migration／私有 store 啟用、正式 latest 或封存寫入、Firebase 雲端、多裝置、Cloudflare 部署／GitHub Pages 設定、真實通知、main 整合。本次未做互動瀏覽器 UI 驗收；前端行為由 Node 執行載入器與本機 HTTP fixture 驗證。GitHub CI 以推送後同 SHA 結果另行核對，不以本機通過冒稱遠端通過。上述限制不影響本工項要求的離線驗收完成，亦不代表 Gate A 完成或已獲 production 啟用授權。

風險／回退：既有快照沒有補證，初次啟用若無合格候選與私有 LKG，分類會明確為空而非沿用未核實資料；嚴格整批政策遇來源暫時失效會增加沿用率。verified 仍只代表既有機械來源檢查，不保證摘要／翻譯／數值經人工核實。私有原件／世代尚無自動清理，須管理磁碟；本機 generation、public 檔與 Git／部署非跨系統交易。需要撤回時，在隔離分支先依反向順序 revert AH-02 closeout 文件提交，最後執行 `git revert -m 2 f6ab241d81df3faf66873e044bb557d4de5ea018`，以保留指定 AH-01 第二父提交；不另 revert `a2982ec`，不 reset／force-push。此次未改正式資料，無 production 資料回遷。store 回退流程見 `category-quality.md`。

### AH-03 驗收與邊界（2026-09-20）

- worktree `/private/tmp/ai-news-hub-ah03-20260919`；分支 `codex/ah-03-release-manifest-efficient-read` 直接建立於指定 AH-02 `697ac222ef14d87c873f5b02b100db945d6bc8c0`，因該 SHA 尚未包含於 `origin/main`。實作提交 `8da8e1c9a4e666dc50227ddb51fc9588060ec92b`；main 工作目錄未作開發、未 reset 或 force-push。
- 唯一權威契約是 `release-manifest.md`，shape／程式入口是 `../shapes/release-manifest.md`。manifest v1 精確管理 latest／health／index／skills 四檔，以內容時間產生可重跑 `created_at`，並以 canonical descriptor SHA-256 產生 `content_set_sha256` 與 `ahr1_...` release ID。
- `build-site.mjs` 清空並完整產生 allowlist artifact、確認必要 JSON 後才最後寫 manifest；任何缺檔／非 regular file／JSON 或 identity 錯誤使 build 失敗。前端先輪詢 manifest，只抓 hash 改變、缺少或 cache 自驗失敗的資產，四檔全數通過才原子切換；壞新 release 沿用可重驗舊 release，沒有可靠前版則明確失敗。初次明確 404 才走 `legacy_unverified`，不冒稱已驗證。

| 驗收 | 實際結果／fixture 證據 |
|---|---|
| manifest／cache／loader 正反例 | 8/8：相同輸入 identity 穩定、缺檔拒絕、未變只抓 manifest、單一內容改變只抓一次、hash／schema／asset 404 拒絕且保留 LKG、無 LKG 明確失敗、初次無 manifest legacy 未驗證、未知版本／竄改 identity 拒絕、active 後 manifest 404 保留舊 verified release |
| Node 全套 | 47/47：frontend 27、trend-topics 9、fetch-skills 3、release manifest 8；保留 AH-01 新舊格式／書籤及 AH-02 skills 選擇相容 |
| Python 全套 | 103/103：AH-02 44（含 mixed batch、分類 LKG、quarantine）、AH-01 32（schema、migration 冪等、舊封存、canonical URL、item ID、書籤）、robustness 27 |
| validator／merge self-test | 24/24、3/3；未連外驗來源、未寫正式資料 |
| 既有 agent 離線回歸 | 18 個 Node self-test、strict boundary、run-agents 68 項、Slack self-test、4 個 Python wrapper 全通過；未執行模型正式擷取、promotion 或通知 |
| 語法、build 與 allowlist | 14 份前端 JS、release builder／site builder、10 份 Shell 通過；Cloudflare artifact 成功且 manifest 4/4 bytes/hash 一致，排除 scripts／docs／schemas／candidate／quarantine／store／`.preview`；相同內容多次 build 的 release ID 固定為 `ahr1_e8a0c9bbda65e69121a5943f025cf54b8aa796231b3a6306b14dbe0cf14b5546` |
| 本機 HTTP 與冷封存 | 首頁、release loader、data loader、manifest 及四份內容皆 200，HTTP bytes 與 manifest 4/4 相符；archive dry-run 無合格檔而正常結束。兩者都不是 production／Firebase 驗收 |
| 勿動範圍 | 正式 `data/`、Firebase、排程、通知、Cloudflare／GitHub Pages state、learning／manual-only 控制檔零修改；main 工作目錄保持原狀 |

Re-scan：文件所列四份 managed assets 與 builder／browser allowlist 一致；manifest schema、runtime 額外欄位拒絕、集合 hash 與 release identity 均由程式重算。對照「缺檔不得降格成功」時發現 active release 後 manifest 404 原會轉 legacy，已改為重驗並沿用舊 release、標 degraded，且新增具名測試。現有 tracked `data/latest.json` 沒有 v2 root 欄位，build manifest 因而如實標 `schema_version:1`；這不冒稱 AH-01 已做 production migration。日期封存與 agent artifacts 不在 manifest v1 集合，仍是 legacy 按需讀取，不得稱 manifest-verified。

未執行：正式每日擷取／正式資料改寫、private store 啟用、Firebase／Authentication／rules／writer、排程或發布權限變更、Cloudflare deployment、線上 hash／header／rollback、真實通知、main 整合或 production 啟用授權。implementation 與 offline validation 已完成；configuration、production data mutation、deployment、external/live validation、authorization 均未執行／未取得。這不代表 Gate A production gate 通過。

風險／回退：localStorage 有容量與瀏覽器可用性限制；寫 cache 失敗時當頁仍可用已驗證記憶體內容，但 reload 會重抓。manifest 驗證依賴 Web Crypto；不可用時 fail closed 或沿用可重驗前版，不能跳過 hash。需要完整撤回 AH-03 時，從 AH-03 最終 HEAD 在隔離分支執行 `git revert --no-commit 697ac222ef14d87c873f5b02b100db945d6bc8c0..HEAD` 後建立一般 revert commit；此方式把 tree 精確還原到指定 AH-02 SHA，保留 AH-01／AH-02 歷史，不改正式資料，不使用 reset／force-push。

### AH-04 驗收與邊界（2026-09-22）

- worktree `/private/tmp/ai-news-hub-ah04-20260920`；分支 `codex/ah-04-post-deploy-verify-notify-rollback` 直接建立於 AH-03 完成提交 `e723741d1cc597ac141fa8e74413b995f8835180`，該 SHA 尚未包含於 `origin/main`。核心實作提交 `b7219c5`；workflow context 修復 `f2ec17b57f04b72e8a0b0970fca8e81b963edbfb`、actionlint scope 修復／GitHub 驗證 HEAD `09a5a0440b4bd41b7c43fa304248ec53153310e1`、Gate re-check 證據提交 `49ad32c05800887bc5c93f84d3b54957576fb46f`、最新已驗證遠端證據 HEAD `650fddf98405439becc74bbf5af0c2f06f32fa1c`；main 工作目錄未作開發、未 reset 或 force-push。舊文件多寫一個尾碼 `b` 的 41 字元 AH-03 SHA 已依 Git object 更正為上述 40 字元 SHA。
- 唯一權威契約為 `deployment.md`；release identity 與四份 managed assets 仍引用 `release-manifest.md`。normal deploy 只接受已成功 CI 的完整 SHA，部署後以固定 production URL 重抓首頁、manifest 與四份資產，重算 identity／bytes／size／SHA-256 並核 headers；只有 `verified` receipt 可進通知。rollback 必須綁定既有 verified target receipt，先產生不 mutation 的 dry-run plan，execute 時再核目前 production identity 未漂移，並使用同一 verifier 驗收。

| 驗收 | 實際結果／fixture 證據 |
|---|---|
| AH-04 verifier／receipt／通知／rollback | 本次聚焦正反例 17/17：正確 receipt、stale retry 耗盡、CDN 收斂、manifest schema／identity、size／hash、HTTP／headers、request／body timeout、SHA 不一致、receipt／通知冪等、failed receipt 禁止通知、rollback target／dry-run／stale plan／同一 verifier 正反例 |
| workflow 結構與語法 | 舊 HEAD deploy run `35456640348`、rollback run `35456640876` 均為 0 jobs 的 workflow file failure；`actionlint v1.7.12` 指出 deploy 1 處、rollback 3 處 job-level `env` 不允許 `runner.temp`。修復後 receipt 仍位於 runner temp，不進 workspace／`dist/`；本次以 macOS arm64 官方 checksum `aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f` 驗證固定版本後重跑全部 workflows 為 0 error，四處原 context error 為 0，workflow 防漂移測試 4/4。GitHub run `35621226326` 對完整 SHA `650fddf98405439becc74bbf5af0c2f06f32fa1c` 成功且 semantic validation step 通過；該 SHA 沒有 GitHub deployment 或 artifact，repository workflow configuration 完成 |
| Node 全套 | 68/68：frontend、trend-topics、fetch-skills、release manifest 與 AH-04 suites 全通過；新增 actionlint pin 與 runtime path context 防漂移斷言 |
| Python 全套 | 103/103：AH-02 44、AH-01 32、robustness 27 |
| 既有離線回歸 | validator 24、merge 3、18 個 agent Node self-test、strict boundary、run-agents 68、Slack self-test、4 個 Python wrapper 全通過；未執行模型正式擷取、promotion 或通知 |
| build、allowlist 與封存 | Cloudflare artifact 成功；排除 scripts／docs／schemas／`.preview`／deployment receipt；archive-to-firestore dry-run 正常結束且沒有合格封存，未寫 Firebase |
| 勿動範圍 | 正式 `data/`、Firebase、排程、learning／manual-only 邊界、Cloudflare production、GitHub repository／environment 設定零 mutation；main 工作目錄保持原狀 |

Re-scan：文件、schema、scripts 與 workflow 的 asset set、header、SHA、release identity 與 receipt 狀態一致；新檔沒有 placeholder／TODO。AH-04 分支上舊的 main-push 資料通知觸發已移除，notify 只能由 deploy／rollback job 成功後呼叫，且仍須重新檢查 receipt 為 `verified`。四處 job-level context blocker 已移除；runtime paths 改在 GitHub 支援的 step-level context 解析，local 與 GitHub actionlint 均通過。但此實作尚未整合 main；`origin/main` 的 legacy `Push Notification` run `35555495653` 在 2026-09-21 仍於 production deploy run `35555515973` 開始前完成，不可當成 verified-only runtime evidence。repo-level `CLOUDFLARE_ACCOUNT_ID`／`CLOUDFLARE_API_TOKEN` 名稱存在，值與最小 scope無法由 GitHub API 讀取；`production` environment 存在但無 protection rule／secret，且 main workflow 沒有 `environment:` 綁定；Actions default token permission 為 read、repository Actions enabled／allowed actions 為 all／未要求 SHA pin，相關 job 另列精確寫權限，現有 actions ref 固定 SHA。`main` 仍未保護且 ruleset 為空，此為 AH-11/Gate D 缺口，不可混作 AH-04 已完成。Cloudflare dashboard 的當前 production branch／token scope 因本機無 Cloudflare credential 而未能直接核對。

未執行：main 整合、AH-01 正式 migration、AH-02 private store 啟用、AH-03／AH-04 production deployment、live verifier、真實 deployment receipt、AH-04 verified-only 通知或 Cloudflare rollback，以及任何外部設定／production mutation。implementation、offline validation 與 repository workflow configuration 已完成；external configuration 只核對到可見名稱／權限與 legacy deployment 證據，runtime activation、production mutation、AH-03／AH-04 deployment、live validation 與 authorization 均 pending。固定 production URL 的首頁與四份資產 bytes／SHA-256 和最新 `origin/main` `5e63180cbf813763ec80fc77bcc6788b71b898bc` 精確一致：index `97907cf390663d809c2b3f7474aead6440b103cfe5ebe1560d2af74c6a20e7bf`、latest `89f3b569b33bfed4411332d3dbcd45f2acad073162396c9bf37c4116632d8d22`、health `db90da5c40451a1fe4a12c96f217b853d69a177bebf6223abcf73c41ffe526b6`、data index `c5295dd90ff59902ed0c99c3afeec347774c0f99686e173ca44322ab971d7a50`、skills `16bb4b547266d9cf3189ad385b0dc23ee4abe765c46f28f85b6d54742f877c65`。manifest URL 仍是與首頁相同的 `200 text/html` fallback，live latest 無 v2／quality metadata；AH-03 production release ID、AH-04 receipt artifact 與 verified-only notification／rollback 證據皆為「無」。AH-04 因此為部分完成，Gate A／Gate B 均未通過；下一個 Session 必須先重新核對並取得 Gate A migration／store activation／deployment 與明確 production 授權，否則只記 blocker 並停止，不可開始 AH-06。

風險／回退：fixed production URL 與 Cloudflare CDN 收斂仍須實跑；verified receipt 只能證明該次被讀取資產與 identity／headers 一致，不替代內容真實性或 production 授權。完整撤回 AH-04 repository 變更時，在隔離分支從本工項最終 HEAD 執行 `git revert --no-commit e723741d1cc597ac141fa8e74413b995f8835180..HEAD` 後建立一般 revert commit，不使用 reset／force-push。production rollback 只能依 `deployment.md` 的 plan／execute 流程，在另行明確授權後進行；目前沒有可綁定的既有 verified target receipt，連 plan 都不可用 fixture 或歷史舊部署冒充。
