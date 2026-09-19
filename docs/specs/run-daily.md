<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

## run-daily.sh 規範

### 啟動前檢查（靜默，不中斷）
1. 檢查 Claude CLI 登入狀態：`claude auth status 2>/dev/null`
   - 已登入 → 繼續
   - 未登入/過期 → 記錄錯誤到 health.json，腳本結束
2. 檢查網路：`curl -s --max-time 5 https://api.anthropic.com > /dev/null`
   - 正常 → 繼續
   - 失敗 → 記錄錯誤，腳本結束
3. 檢查 Git 認證：`git ls-remote origin HEAD > /dev/null 2>&1`
   - 正常 → 繼續
   - 失敗 → 記錄「Git 認證過期，請執行 git credential approve 或重新設定 SSH key」

### 時區
`export TZ=Asia/Taipei`，所有 date 指令加 TZ。

### 星期判斷 & 分類排程

```bash
DOW=$(date +%u)  # 1=週一 7=週日
DAILY_CATS=(papers topnews taiwan china usa techtrends governance official_info models skills)
WEEKLY_CATS=(tutorials courses)

if [[ "$DOW" -eq 1 ]]; then
    CATEGORIES=( "${DAILY_CATS[@]}" "${WEEKLY_CATS[@]}" )
else
    CATEGORIES=( "${DAILY_CATS[@]}" )
fi
```

### AH-02 候選、驗證與分類發布

品質政策、狀態與私有儲存權威見 `category-quality.md`；程式定位见 `../shapes/category-quality.md`。

1. 擷取結果寫入私有 durable incoming 目錄；每次模型嘗試原件獨立保存。`skills` 以 `fetch-skills.mjs --output` 指定候選檔，不寫正式分類檔。
2. Claude 仍用 `-p --max-turns 30 --output-format text --allowedTools WebSearch`，watchdog 1200 秒與最多兩次嘗試／重試等待 30 秒不變。非零 exit 即失敗；`extract-json.py --strict` 明確區分成功空陣列和解析失敗。
3. OK／FAIL／SKIP 狀態保留到品質閘；失敗不把任意 latest 填回候選。未排程分類以 `not_scheduled` 表達。
4. `category-publication.py` 逐分類呼叫既有 validator。官方資訊／模型／教學由 `merge-stack.merge_category` 純函式，只與自己的可靠歷史累積。不再從任意舊快照補足 20 筆。
5. 合格分類前進，失敗分類沿用可靠前版；無可靠前版明確為空及 unavailable 狀態。正式歷史檔不在此流程自動升格為 LKG。
6. 私有 store 原子完成後輸出 selected candidate，daily 才原子替換 public latest。保留日封存／index／health 和既有 Git 發布流程；這些不構成跨檔／遠端交易。
7. 正式分類 JSON 不再作 daily 中間檔，保留相容用途；前端在 AH-02 latest 存在時不再用獨立 skills.json 覆蓋已選內容。書籤 ID 不變。
8. `supplement-run.sh [cat...]` 轉交 `run-daily.sh --categories ...`，與每日流程共用鎖、品質與 Git；預設補跑分類不變。這表示補跑同樣要求 main／乾淨工作目錄及 preflight。

### 驗證與歸檔

`_updated_at` 只在合格內容改變時前進；`_checked_at` 記嘗試；`_update_outcome` 分開 attempt 與 serving。有效空結果的課程可為 no_change；無可靠資料則不創造 updated 時戳。詳細正反例只在 `category-quality.md` 維護。

每日品質閘處理／儲存失敗回非零並保留舊 latest；單分類擷取／驗證失敗不阻止其他分類前進。selected latest 再寫日封存及 index（保留七天）。

### 健康狀態
- 通過前置檢查且完成資料處理後更新 data/health.json；前置失敗使用下方 off-repo local-health，不發布失敗候選
- 成功時：status="ok"，consecutive_failures=0
- 部分成功：status="partial"
- 全失敗：status="failed"，consecutive_failures +1
- categories_ok/failed 由品質閘結果計算；no_change 且有可靠內容才算 ok。保存逐類結果於 latest，總驗證率不能作分類閘門。

### Log 清理（⚠️ Bug Fix #11）
```bash
find "$DATA_DIR/logs" -name "*.log" -mtime +7 -delete 2>/dev/null
find "$DATA_DIR/logs" -name "validate-*.json" -mtime +7 -delete 2>/dev/null
```
每次執行時自動清理 7 天前的 log 和驗證報告。

### Git 發布與失敗恢復（2026-09-18）

`scripts/publish-daily.py` 是每日發布的唯一實作；不可使用 soft reset、強制推送或整樹覆蓋。

1. 取得程序鎖後才開啟每日 log；前置失敗記於 `~/.ai-news-hub/publication/local-health.json`，不弄髒 tracked health 而阻擋下一輪。
2. 正式 checkout 須位於 main、乾淨且無未完成 Git 操作。fetch 後先重試有可信 receipt 的推送候選，再 fast-forward；不能把未知本機提交當成每日產物。
3. 依上節 AH-02 分類品質閘產生 selected candidate；儲存或處理失敗停止。selected latest、日封存與索引各自原子替換；索引或 health 寫入失敗不得發布。
4. 發布前確認 HEAD 未被其他工具移動、index 原本為空。只 stage `data/`（尊重 ignore）及經程式 allowlist 驗證的自動修改 manifest；未知程式變更一律停止。
5. 先 commit 本輪差異，再 fetch／rebase 最新 origin/main／普通 push。遠端非重疊修改保留；衝突 abort 並保留本機候選，回非零。push 最多三次，每次重新三方整合。
6. 推送成功後寫 off-repo `~/.ai-news-hub/publication/last-run.json`，含結果、實際 SHA 與時間；不為更新已發布狀態再造第二次發布。
7. fetch／push 暫時失敗的 receipt 記 `candidate`、`retryable:true`。下輪僅在 main 乾淨且 HEAD 精確符合該候選時重試；不符合即停止。真正衝突、未知變更、commit 失敗或確定性處理失敗須人工核對現場，不自動 reset。

#### 人工恢復

先讀每日 log、上述 receipt 與 Git 差異。對衝突保留候選提交，於隔離 worktree 依雙方內容解決並驗證，再由單一整合者整合。對未提交的產物先另存候選並核對基準、分類完整性及驗證報告；只有確認是本輪失敗產物後才依明確範圍移出排程 checkout。不得為恢復而無差別清除工作目錄、index 或提示詞。

#### 鎖與退出碼

`run-locked.py` 使用 Python fcntl 原子鎖，子程序繼承鎖 FD；不 unlink 鎖 inode。正常退出、前置失敗、TERM／INT 都清理子程序；先 TERM，限時後 KILL。持鎖者結束後才允許下一輪。重複啟動回 75；TERM／INT 回 143／130。必要資料處理、Git 發布失敗或擷取 partial／failed 皆非零；可用的 partial 資料仍允許發布。

`health.last_success` 明確代表 `local_processing` 完整成功，並非網站部署；candidate health 的 `publication` 固定為 `pending`，實際推送查 off-repo receipt，網站部署查 Pages 證據。`needs_review` 不計入驗證率；只有 selected pass_rate=100 且本輪分類狀態為 ok 才標 `[verified]`。沿用可靠資料可能仍顯示 selected rate=100，但 failed／partial 的提交為 `[unverified]`。

### Email 通知（全自動，零設定）

**機制：** Git push 成功後，GitHub Actions 自動觸發 `notify.yml`：
1. 偵測 `data/latest.json` 變更
2. 讀取 JSON，產生 Markdown 摘要
3. 建立 GitHub Issue（標題含日期/早午班/筆數/驗證率）
4. Issue 內容：十二類別各自的筆數 + 前 3 筆標題（含連結）+ 網站 CTA
5. 自動關閉 7 天前的舊 Issue
6. GitHub 內建通知系統自動寄 Email 給 repo owner

**不需要：** App Password、Gmail 設定、任何額外帳號
**需要確認：** GitHub → Settings → Notifications → Email 已勾選 Issues

**通知 Issue 標題格式：**
`✅ AI News 2026-04-04 🌆 午班 · 68 筆 · 驗證 96%`

**Label：** `ai-news-daily`（自動建立）

### 完全靜默
- 所有輸出導向 data/logs/YYYY-MM-DD.log
- 不需要任何人工互動
- 不會彈出視窗或提示

---
