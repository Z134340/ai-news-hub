# AH-02：分類品質閘與可靠資料沿用

本文件定義本機分類選擇與儲存交易；資料項目沿用 `data-formats.md` 的 v2 schemas、canonical URL、item_id 與 migration。`published` 在此指本機已選出的快照，不代表已 Git push、部署或線上驗收；外部發布仍依 `run-daily.md`。AH-03 release manifest 尚未實作。

## 分層與資料流

| 層 | 內容與位置 | 可信邊界 |
|---|---|---|
| incoming／raw | `~/.ai-news-hub/publication/category-quality-incoming/<date>.<random>/`；每分類 JSON、每次模型回應 `.attemptN.txt`、狀態檔 | 擷取只寫此區；不修改正式分類檔。中斷、失敗與重試原件均保留 |
| candidate | `store/attempts/<request-hash>/candidate.json` | 包含原始 bytes 的 base64、解析前／後來源位置與本次政策；先保存再驗證 |
| validated | `store/generations/<request-hash>/validated.json` | 每分類的新候選全數通過才列入；不把其他分類成敗混算 |
| quarantine | 同 generation 的 `quarantine.json` 與 `result.json.candidate_validation` | 完整分類原件、來源檔位置、原始陣列位置、原因與 validator 明細；不進 public data、Git 或網站 |
| last-known-good | `result.json.last_known_good[category]` | 只由已通過品質閘的新候選產生，含原項目、內容雜湊、更新／檢查時間；每次讀取重驗契約與可靠條件 |
| locally published | 同 generation 的 `published.json`，再輸出指定候選檔 | 合格分類的新內容與失敗分類的可靠前版組合；沒有可靠前版則空陣列＋明確狀態，不捏造替代內容 |
| public | daily 在品質閘正常完成後原子替換 `data/latest.json`，再依既有流程寫日封存／index／health | 不把未核准原件或 quarantine 送到 `git add data/`；Gate A 整體仍未完成 |

以下 `store` 指 `~/.ai-news-hub/publication/category-quality/`，與 `category-quality-incoming/` 為同層獨立目錄。`store/current` 是唯一原子切換點，指向不可變 generation。檔案先寫暫存、flush/fsync、rename；generation 完整後才切換 pointer。寫入失敗保留舊 generation，candidate 原件與未完成 stage 供追查。輸出候選檔失敗也不切換 pointer。私有 store、output 與來源目錄須互相隔離；CLI 拒绝 repo 內 store、正式 data output 與覆寫來源。

本機 latest、日期檔、index 與 Git push 仍不是跨檔／跨遠端交易；後續安裝或推送失敗可能留下未發布的合格 generation，但不破壞先前 generation，也不能把它稱為已部署。沿用資料僅要求先前品質合格，不要求曾成功部署。

## 政策與失敗行為

設定唯一來源：`scripts/category-quality-policy.json`。十二分類均明列 `min_items`、`min_verified_ratio`、`max_hard_errors`、`max_age_days` 與 `reason`；validator 和累積函式共讀日期時窗。

- 初始每分類最低 1 筆新候選；全部候選须合格（ratio=1），硬錯誤為 0。Top 20 是數量目標，不是湊滿才合格；移除舊「補至 20 筆」路徑。
- 沒有 schema／canonical／item_id／日期／官方公司域名問題；`contract_state=current`、`verified is True`、`complete is True`、無待複核原因、來源檢查 `url_status=verified`、有效且非未來的 `verified_at` 才計合格。
- legacy、needs_review、verified_no_title、布林以外的 truthy 值皆不合格。模型與官方資訊主 URL 及全部 evidence URLs 都須符合 AH-01 公司 registry。候選被 validator 移除、去重或部分畸形會使該分類不通過；不能丟掉錯誤項後假稱 100%。
- 新擷取且無版本的項目，只在明確提供全部 current 必填事實欄位時由後端賦予 current 身分；顯式 legacy 永不自動晉升。不補 source_title、模型能力、價格或分析。GitHub Skills 的雙標題取 API `full_name`（專案專有名稱）。
- official_info／models／tutorials 先驗新候選，再以既有 `merge-stack.merge_category` 純函式與可靠歷史累積；合併後再驗完整輸出。候選失敗不能用大量好歷史稀釋失敗率。
- 門檻未達：整個失敗分類沿用自己的 LKG，其他合格分類可前進。沒有、損壞、只有 legacy／needs_review 的前版都回 `no_reliable_data`，不從任意 latest 或分類舊檔自動 bootstrap。
- LKG 讀取驗證 hash、schema、身分、狀態、證據配對與時間次序。舊內容超過新收錄日期時窗仍可沿用，但保留原資料日期／`_updated_at` 並標明沿用；不能冒稱剛更新。
- 整份 store pointer／JSON 損壞時不猜測可用世代：`state_errors` 記原因，各分類無可靠資料；所有既有檔案保留供人工復原。個別 record 損壞只影響該分類。

此品質閘的 verified 代表通過既有機械來源檢查。既有 relaxed-domain 行為保留；不宣稱已人工核實摘要、翻譯、模型數值或次要證據頁全文。來源暫時無法驗證時保守沿用；AH-07 增量驗證／TTL／退避尚未實作。

## 時間與結果

`latest.schema.json` 新增 `_checked_at` 與 `_update_outcome`，不更換 schema_version 或書籤 key。

| 欄位 | 語意 |
|---|---|
| `_updated_at[cat]` | 本分類合格內容最近一次實質改變並被本機選入快照的時間；無可靠內容時不填。不再於每次擷取／合併無條件填 now |
| `_checked_at[cat]` | 最近一次該分類嘗試的時點（含失敗）；本輪未排程保留先前值。獨立於 LKG 保存，因此無可靠內容仍保有檢查紀錄 |
| `_update_outcome[cat].attempt` | `updated`／`no_change`／`fetch_failed`／`validation_failed`／`not_scheduled` |
| `_update_outcome[cat].serving` | `current`（新合格內容）／`last_known_good`（沿用可靠前版）／`no_reliable_data` |

`checked_at` 為本輪分類檢查作業時點，由 adapter 一次給定；fixture 可指定固定 ISO 時間（含時區）。LKG 內另有最後成功分類查詢／品質判定時間；失敗嘗試不刷新該成功時間。個別 item 的 verified_at 仍是原來源驗證時間，不因空結果或無變更自動刷新。

| 情境 | attempt | serving | 時間行為 |
|---|---|---|---|
| 新合格內容不同 | updated | current | checked／updated 都為本次 |
| 來源成功，內容相同 | no_change | last_known_good | checked 前進，updated 與原 payload 不變 |
| 明確空 JSON 成功，例如沒有新課程 | no_change | last_known_good 或 no_reliable_data | 同上；無前版不創造 updated |
| 非零 exit／解析失敗／缺結果／超時跳過 | fetch_failed | last_known_good 或 no_reliable_data | checked 前進，updated 不變／缺席 |
| 新候選結構或證據未通過 | validation_failed | last_known_good 或 no_reliable_data | 同上 |
| 非週一的課程／未指定補跑分類 | not_scheduled | last_known_good 或 no_reliable_data | 保留 checked／updated；從未檢查則不填 checked |

`extract-json.py --strict` 只將可解析且明確的 JSON items 陣列（包含 `[]`）當成功；不把無輸出、文字「沒有新聞」或修復失敗轉成成功空結果。舊寬鬆函式保留供相容使用，daily／supplement 不走它。

內容比對排除來源檢查 metadata、`is_new`、`last_seen`，其餘事實欄位、排序與 first_seen 保留；不因驗證時鐘更新就改 `_updated_at`。`validation.categories` 提供逐分類候選數、eligible 數、比例、政策、原因與實際 serving 狀態。根 pass_rate 只描述選出的內容，不能作 gate 或推論本輪全部成功；health 的 ok／partial／failed 來自逐分類 attempt 和可用性。

## 重跑、失敗與回退

- request hash 包含原件、來源位置、政策與指定 checked_at。相同 request／current 重跑不再驗網路、不新增世代，輸出一致；不同內容卻相同或更早時點拒絕，避免回滾。
- 中斷 generation 綁定 `base_generation`。只有前版指標未變才可接續；若其間已有成功更新，拒絕沿用舊結果，須以新 checked_at 建立新 attempt，重新合併最新可靠資料。
- 原件與 generations 不自動清除；磁碟保留／清理須另行明確管理，不能套用 public logs 的七天刪除規則。磁碟滿時停止寫入並保留可靠前版。
- 本工項未執行正式 capture／migration／部署。程式回退在獨立分支 revert AH-02 提交，保留 AH-00／AH-01 和後續每日提交；不得 reset／force-push。未來若要回退 store，先停 publisher、備份整個私有 store、逐分類核對指定世代，再經授權原子切換 pointer；不把任意舊 latest 當可靠前版。

離線入口：`python3 -B -m unittest discover -s scripts/tests -p 'test_*.py' -v`。I/O／網路檢查函式可注入 fixture；CLI 正常執行有新候選時會使用既有 validator 連來源網路，因此不可把正常 CLI 呼叫誤稱離線驗收。原件／報告不應放公開 repo。
