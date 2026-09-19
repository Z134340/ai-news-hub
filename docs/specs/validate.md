<!-- 驗證規範權威入口；資料結構與版本定義見 data-formats.md。 -->

## validate.py 規範（AH-01／AH-02）

`schemas/data/v2/` 是結構權威；`scripts/contracts/data_v2.py` 提供離線相容 migration、canonical URL 與 item_id。程式定位見 `docs/shapes/data-contract-v2.md`。

### 輸入、版本與診斷

- 缺 input、根非物件、data 非物件／空分類集合、未知分類、分類非陣列、未知版本，回非零；不得把缺資料當成功。
- 無版本／整數 1 可相容轉成 v2，保留原始 URL、title、model_name 與日期。v2 根要求 v2 items；畸形 v2 不得降格成 legacy。
- `--input`／`--output` 指定候選；預設仍為 `data/latest.json`。只有全分類成功處理才把 root 升成 2；單分類時其他分類不改。
- 先 schema，再身分一致性、日期、官方來源、去重、網路；任何後續成功不能覆蓋先前缺陷。

| Report 欄位 | 意義與處理 |
|---|---|
| `schema_errors` | 錯型別、缺必要欄位、未知版本、非法 URL、ID／canonical 不符。記分類、index、reason；原件亦放 quarantine |
| `legacy_compatible` | 成功讀取的舊格式；不是 verified，也不免除日期／來源／網路檢查 |
| `evidence_needs_review` | 缺來源標題、明確繁中顯示標題、模型新欄位，或舊模型缺公司官方證據。原有內容保留；不能計入 verified |
| `quarantine` | schema／身分錯誤、當前格式公司網域不符、超出發布日期範圍、URL 硬失敗等；包含原因及原件供複核。CLI report 仍是診斷；AH-02 原件保留／私有儲存見 `category-quality.md` |

上述不是互斥計數：一筆可以同時 legacy_compatible 與 evidence_needs_review；schema_error 的原件也出現在 quarantine。AH-02 修正 URL 檢查失敗的原始 index／item，不再使用去重後位置或已注入 metadata 的副本。`details[category].items` 記錄移除／保留原因，`removed` 另包含既有去重計數。全量驗證後沒有可用 item 回非零並保留輸入檔。

### 舊模型與來源證據

- 舊模型核心欄位已存在且型別正確，只缺新版能力、限制、價格或分析時可保留；缺欄位不填虛構內容。已提供但型別錯誤的欄位仍隔離。
- 舊模型且缺新版欄位時，非官方媒體、舊公司名稱或公司證據不配對只降為 needs_review，不能標官方來源。完整當前模型／官方資訊若公司—網域不符仍隔離，沒有放寬新收錄來源規則。
- `official_source` 僅在主 URL 與全部 evidence_urls 都命中該公司核准網域時為 true；這只是網域身分，不是文章內容／數值已核實。
- HTTP 成功時仍需檢查缺證據原因；缺 source_title 或其他上述證據，verified=`needs_review`、complete=false。不會把 model_name／翻譯 title 複製成原文證據。
- 當前 prompt 已要求分開 source_title／display_title；既有封存不在本工項批次補證或重寫。

### 網路檢查與標題核對

1. HTTP HEAD timeout=10s；405 轉 GET；最多 3 workers、每三筆間隔 0.5 秒。
2. 403 為 needs_review；404/410/5xx、連線錯誤或非法 URL 移除並記原因。本文不把暫時性網路錯誤視為內容偽造；分類沿用已由 AH-02 實作，退避仍屬後續 AH-07。
3. 若有 `source_title`，抓頁面 title/h1 比對：相似度 ≥0.3 通過，介於 0 與 0.3 待複核，完全不符移除；TITLE_CHECK_RELAXED_DOMAINS 保留既有跳過標題比對規則。
4. 沒有 source_title 時只檢查連線，結果保持缺證據待複核。抓頁失敗但 HEAD 成功的既有處理仍在；不宣稱已完成內容級證據驗證。
5. 普通分類不在 TRUSTED_DOMAINS 只記 warning；官方資訊／模型另以公司網域配對判定。

### 網域 registry

- `scripts/tier-b-domains.json` 的 domains 在 import 時 add-only 併入硬編碼 TRUSTED_DOMAINS；小寫、去 www，缺失／壞檔記 warning，不刪既有白名單。
- 普通白名單以實際 hostname 精確比對，沒有子網域萬用；公司 registry 允許登錄網域及其子網域。
- 企業來源唯一名單：`skills/official-ai-ecosystem-research/references/official-sources.json`；company/institution 必須精確符合登錄公司名。
- `scripts/sources-registry.json` 管 11 個 editorial discovery 分類的官方站與 RSS/Atom feed；skills 為獨立 GitHub API 榜單，不在 feed registry。
- learning-loop、auto-apply 白名單、manual_only 與 promotion 規則未改。

### 日期、去重與保存

- YYYY-MM-DD 必須是真實日期。正式候選：topnews/taiwan/china/usa 1 天、techtrends/governance 7 天、official_info 30 天、papers/tutorials/courses/models/skills 90 天；不接受未來日期。
- 所有分類以共用 canonical URL 去重；企業兩分類保留既有完整名稱 tuple 的第二層去重，一般新聞保留標題相似度 >0.8 的既有規則。item_id 不使用陣列位置。
- Report 預設 `data/logs/validate-YYYY-MM-DD.json`，只有非 dry-run／非 offline 才寫。
- 成功輸出先寫暫存檔再原子替換指定 output/input；更新 stats、validation，pass_rate 分母是輸入總筆數、只計 verified=true。needs_review 與已移除項不計成功。
- validator 本身不覆寫日期封存；封存由既有每日流程在候選驗證後處理，本工項沒有執行。

### 離線與驗收入口

- `--dry-run`：不寫 output/report，但仍可能連網，不是離線模式。
- `--offline --input FILE`：只做契約／來源結構診斷，不連網、不寫 output/report、不以今日時窗淘汰歷史資料；所有未實測來源維持未驗證。有 schema_error/quarantine 回 1，只有相容／待複核回 0。禁止把退出 0 當發布核准。
- `--self-test`：不讀 latest、不連網；測 tier-b／registry／型別，相應 fixture 不受實際日期影響。
- `python3 -B -m unittest discover -s scripts/tests -p 'test_*.py' -v`：包含 AH-01 契約／migration 和既有 robustness；既有 Node／Shell 自測依 `.github/workflows/selftest.yml`。

## AH-02 發布接入

`category-publication.py` 逐分類呼叫 `validate_items`，保存 raw input 後才移除／去重；輸出的 needs_review 可留作診斷但不能發布或作 LKG。顯式 legacy 即使 HTTP 成功也降為 needs_review，不計 verified。新 producer 的完整欄位透過明確 adapter 建立 current；歷史 migration 不變。

日期時窗改由 `scripts/category-quality-policy.json` 共用；無新增網路驗證器、快取或 TTL。分類閘比通用 validator 更嚴格：verified_no_title 不合格、任何候選移除／去重都使該分類沿用前版。舊 CLI 的根結構錯誤／全無可用資料仍非零，daily 不再用整批 CLI exit 取代逐類發布判定。
