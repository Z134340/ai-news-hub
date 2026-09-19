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
| AH-03 | 發布 manifest 與高效率讀取 | `release-manifest` schema、release ID、內容 hash、前端只在版本改變時取大型資料、版本化 cache | AH-02 | ⏭ 下一步（未實作） | manifest 小型輪詢；內容與 manifest hash 綁定；舊前端相容與載入失敗降級通過 |
| AH-04 | 部署後驗證、通知與 Cloudflare 回滾 | CI post-deploy smoke/hash/header、通知改為部署成功後、指定已驗證 SHA 的人工回退 | AH-03 | ⬜ 未開始 | 通知不早於 production；錯誤 hash 阻擋成功；回退流程有 dry-run／驗收證據 |
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
| 2026-09-19 | AH-01 分支 `codex/ah-01-data-contract-v2`；規劃基準 `37947c2`；兩次 fetch 的 `origin/main` 均為 `1230eba`，已包含於基準 | 五份 v2 schemas、離線 migration／診斷、共用 URL／ID 與標題契約已實作且離線驗收通過；未改正式資料或部署，下一工項 AH-02。Gate A 整體尚未完成 |
| 2026-09-19 | `origin/main` `d35ad49`；AH-01 realigned 分支 `codex/ah-01-data-contract-v2-realigned`；實作 `a3a0f52`、反例補強 `6c516fc` | 重新對齊停用 GitHub Pages 後的最新基準；AH-05 依 main 與 `HANDOFF.md` 的既有外部證據改標完成。AH-01 doc×code re-scan、完整離線回歸、七份實際快照 migration 與明確偽造／canonical 重複反例通過；未做 production mutation／部署／live 驗收，下一工項 AH-02。Gate A 與 Gate B 整體均未完成 |
| 2026-09-19 | AH-02 分支 `codex/ah-02-category-quality-gates`；既有實作 `a2982ec`；以普通 merge `f6ab241d81df3faf66873e044bb557d4de5ea018` 納入指定 AH-01 `4ba34f492c3d4da320d9d0906cc33cba117feb0d`；worktree `/private/tmp/ai-news-hub-ah02-20260919` | 分類政策、私有 candidate／validated／quarantine／LKG 儲存、每日與補跑共同入口、時間與 outcome 已實作；doc×code re-scan 後補同批 mixed fixture，103 項 Python 與既有離線回歸通過。本工項離線驗收完成，下一工項 AH-03。未整合 main／部署／正式擷取；Gate A 整體尚未完成 |

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

- worktree `/private/tmp/ai-news-hub-ah02`，以 AH-01 已推送提交為基準；保留 AH-00 規劃與最新每日資料。權威政策／失敗行為見 `category-quality.md`，程式與測試入口見 `../shapes/category-quality.md`。
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

風險／回退：既有快照沒有補證，初次啟用若無合格候選與私有 LKG，分類會明確為空而非沿用未核實資料；嚴格整批政策遇來源暫時失效會增加沿用率。verified 仍只代表既有機械來源檢查，不保證摘要／翻譯／數值經人工核實。私有原件／世代尚無自動清理，須管理磁碟；本機 generation、public 檔與 Git／部署非跨系統交易。需要撤回時在隔離分支 revert AH-02 merge／實作提交並 push，保留 AH-00／AH-01 與每日提交，不 reset／force-push；此次未改正式資料，無 production 資料回遷。store 回退流程見 `category-quality.md`。
