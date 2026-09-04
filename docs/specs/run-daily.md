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
DAILY_CATS=(papers topnews taiwan china usa techtrends governance)
WEEKLY_CATS=(models tutorials courses)

if [[ "$DOW" -eq 1 ]]; then
    CATEGORIES=( "${DAILY_CATS[@]}" "${WEEKLY_CATS[@]}" )
else
    CATEGORIES=( "${DAILY_CATS[@]}" )
fi
```

每個類別成功擷取後，注入 `_updated_at` 時間戳至該類別 JSON：
```python
now = datetime.now(timezone(timedelta(hours=8))).isoformat()
if isinstance(d, list):
    d = {'items': d, '_updated_at': now}
elif isinstance(d, dict):
    d['_updated_at'] = now
```

### 擷取流程

**claude CLI 呼叫方式（⚠️ 關鍵 Bug Fix #1）：**
```bash
TODAY_DATE=$(date +%Y-%m-%d)
PROMPT_WITH_DATE="Today's date is ${TODAY_DATE}. Please prioritize news from today and the past 24-48 hours.

$(cat scripts/prompts/${CAT}.md)"

# macOS 相容 timeout（無 timeout 指令，用 watchdog 代替）
"$CLAUDE_BIN" -p "$PROMPT_WITH_DATE" \
  --max-turns 30 \
  --output-format text \
  --allowedTools "WebSearch" \
  2>>"$LOG_FILE" > "$TMP_FILE" &
CLAUDE_PID=$!
( sleep 600 && kill -TERM "$CLAUDE_PID" 2>/dev/null ) &
WATCHDOG_PID=$!
wait "$CLAUDE_PID" 2>/dev/null || true
kill -TERM "$WATCHDOG_PID" 2>/dev/null
wait "$WATCHDOG_PID" 2>/dev/null || true
```
- `--max-turns 30`：topnews 等需要 9+ 次搜尋的類別，15 turns 不足以完成並產出 JSON
- `--output-format text`：確保輸出純文字，方便 JSON 提取
- **macOS 無 `timeout` 指令**：必須用背景執行 + watchdog kill 模式（⚠️ Bug Fix #12）
- watchdog 600 秒（10 分鐘）：確保最壞情況下 8 類 × 20.5 分 = 19:14 前完成

**JSON 提取（⚠️ Bug Fix #7）：**
不要用單行 python，使用完整腳本處理 claude 的多段回應：
```python
import json, re, sys
raw = sys.stdin.read()
# claude 可能回傳多段文字（思考 + 搜尋 + 最終回答）
# 需要找到最後一個完整的 JSON 物件
matches = list(re.finditer(r'\{[^{}]*"items"\s*:\s*\[[\s\S]*?\]\s*\}', raw))
if matches:
    data = json.loads(matches[-1].group())
    items = data.get("items", [])
    json.dump(items, sys.stdout, ensure_ascii=False, indent=2)
else:
    # fallback：找任何 JSON 物件
    m = re.search(r'\{[\s\S]*\}', raw)
    if m:
        try:
            data = json.loads(m.group())
            items = data.get("items", [])
            json.dump(items, sys.stdout, ensure_ascii=False, indent=2)
        except json.JSONDecodeError:
            json.dump([], sys.stdout)
    else:
        json.dump([], sys.stdout)
```
將此邏輯存為 `scripts/extract-json.py`，擷取時用：
`cat tmp_file | python3 scripts/extract-json.py > data/${CAT}.json`

**重試與間隔：**
- 每個類別最多 2 次嘗試（初始 + 重試 1 次），重試等待 30 秒
- 2 次都失敗 → 記錄錯誤，echo '[]' > data/${CAT}.json，繼續下一個
- 類別間隔 10 秒

### 模型/教學 累積合併（僅週一）
- 週一：執行 `python3 scripts/merge-stack.py` 合併今日與歷史資料，dedup + 加入 is_new/is_expired/first_seen/last_seen 欄位
- 非週一：跳過，保留上次資料
- Dedup 鍵值：models=(model_name, version, institution)，tutorials=(title, source, url)
- tutorials 僅保留近 3 個月資料，按 date 最新排序
- 支援 `--dry-run` 模式

### 合併 latest.json
- python3 合併為 latest.json（含 source: "local"，含 `_updated_at` 各類別時間戳）
- 非週一：每週類別 (models/tutorials/courses) 從舊 latest.json 讀取，保留原始 `_updated_at` 時間戳
- 週一：所有 11 類別從當日擷取的 JSON 讀取

### 驗證 + 歸檔
- python3 scripts/validate.py 八步驟驗證
- 歸檔日期 JSON + 更新 index.json（保留 7 天）

### 健康狀態
- 每次執行後更新 data/health.json
- 成功時：status="ok"，consecutive_failures=0
- 部分成功：status="partial"
- 全失敗：status="failed"，consecutive_failures +1
- 記錄 categories_ok/failed、驗證率、錯誤訊息

### Log 清理（⚠️ Bug Fix #11）
```bash
find "$DATA_DIR/logs" -name "*.log" -mtime +7 -delete 2>/dev/null
find "$DATA_DIR/logs" -name "validate-*.json" -mtime +7 -delete 2>/dev/null
```
每次執行時自動清理 7 天前的 log 和驗證報告。

### Git 推送（⚠️ Bug Fix #8）
```bash
git pull --rebase origin main 2>/dev/null || git pull origin main
git add data/
git diff --staged --quiet && exit 0  # 無變更則結束

# 驗證率 100% → [verified]，否則 [unverified]
PASS_RATE=$(python3 -c "import json; d=json.load(open('data/latest.json')); print(d.get('validation',{}).get('pass_rate','0%').replace('%',''))" 2>/dev/null || echo 0)
TAG="[verified]"
python3 -c "exit(0 if float('${PASS_RATE}') >= 100 else 1)" 2>/dev/null || TAG="[unverified]"

git commit -m "📰 AI News YYYY-MM-DD ${TAG}"
# 推送重試 3 次
for i in 1 2 3; do
  git push origin main && break
  if [ $i -eq 3 ]; then
    echo "❌ Git push 失敗，可能需要重新設定認證" >> "$LOG_FILE"
  fi
  sleep 5
done
```

### Email 通知（全自動，零設定）

**機制：** Git push 成功後，GitHub Actions 自動觸發 `notify.yml`：
1. 偵測 `data/latest.json` 變更
2. 讀取 JSON，產生 Markdown 摘要
3. 建立 GitHub Issue（標題含日期/早午班/筆數/驗證率）
4. Issue 內容：十大類別各自的筆數 + 前 3 筆標題（含連結）+ 網站 CTA
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

