#!/bin/bash
# ============================================================
# AI News Hub — 每日自動擷取腳本
# 由 launchd / cron 排程執行，全程靜默
# ============================================================

set -uo pipefail

# Acquire the lock before opening daily logs or touching generated files.
if [[ "${ANH_DAILY_LOCK_HELD:-}" != "1" ]]; then
    exec python3 "$(dirname "$0")/run-locked.py" /tmp/ai-news-hub.lock bash "$0" "$@"
fi

export TZ=Asia/Taipei

# 確保 PATH 包含常見安裝路徑（launchd 環境可能缺少）
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:$PATH"

# ── 目錄設定 ──
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS_DIR="$REPO_DIR/scripts"
DATA_DIR="$REPO_DIR/data"
LOG_DIR="$DATA_DIR/logs"
TODAY=$(date +%Y-%m-%d)
LOG_FILE="$LOG_DIR/$TODAY.log"

mkdir -p "$LOG_DIR" "$DATA_DIR"

# 全部輸出導向 log
exec >> "$LOG_FILE" 2>&1

# ── 工具函式（須在 lock 檢查與 caffeinate 之前定義） ──
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# Cleanup runs on normal return, failed preflight and signals; the wrapper owns the lock.
_daily_cleanup() {
    local code=$?
    trap - EXIT
    [[ -n "${CAFFEINATE_PID:-}" ]] && kill "$CAFFEINATE_PID" 2>/dev/null || true
    [[ -n "${DAILY_TMP:-}" ]] && rm -rf -- "$DAILY_TMP"
    exit "$code"
}
trap _daily_cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
DAILY_TMP=$(mktemp -d "${TMPDIR:-/tmp}/anh-daily.XXXXXX") || exit 1
export LATEST_CANDIDATE="$DAILY_TMP/latest.json"

# ── 防止系統休眠（caffeinate）──
# 根本原因修復：pmset sleep=1 分鐘，無 caffeinate 則腳本啟動後不到 1 分鐘 Mac 就睡著，
# 導致 sleep 600 watchdog 計時器凍結，claude 進程也凍結，整個排程失效。
# -d 防螢幕關閉；-i 防 idle sleep；-m 防磁碟 idle sleep；-s 防蓋蓋休眠（需 AC 電源）
caffeinate -dims &
CAFFEINATE_PID=$!

# ── 電源來源偵測（S-PWR P-2）──
# caffeinate -s 只在 AC 電源下有效；電池＋合蓋時 macOS 每 17–36 分鐘只暗醒幾秒，
# 實測電池執行 4–6 小時、7 類別只成功 2 個。這裡只標記，不改 pmset、不補跑。
POWER_SOURCE="ac"
if command -v pmset >/dev/null 2>&1 && ! pmset -g batt 2>/dev/null | head -1 | grep -q "AC Power"; then
    POWER_SOURCE="battery"
    log "⚠️ 電池模式執行：macOS 合蓋會週期性睡眠，擷取可能逾時回退"
fi

INTERRUPTED=0

update_health_json() {
    local status="$1"
    local message="${2:-}"

    mkdir -p "$HOME/.ai-news-hub/publication"
    python3 - "$status" "$message" "$HOME/.ai-news-hub/publication/local-health.json" << 'PYEOF'
import json, sys, os
from datetime import datetime, timezone, timedelta

status = sys.argv[1]
message = sys.argv[2] if len(sys.argv) > 2 else ""
health_path = sys.argv[3] if len(sys.argv) > 3 else "data/health.json"

taipei_tz = timezone(timedelta(hours=8))
now = datetime.now(taipei_tz)

# 讀取既有值
old = {}
if os.path.exists(health_path):
    try:
        old = json.load(open(health_path))
    except:
        pass

consecutive = old.get("consecutive_failures", 0)
if status == "ok":
    consecutive = 0
else:
    consecutive += 1

health = {
    "last_run": now.isoformat(),
    "last_success": old.get("last_success") if status != "ok" else now.isoformat(),
    "last_date": now.strftime("%Y-%m-%d"),
    "source": "local",
    "status": status,
    "categories_ok": old.get("categories_ok", 0),
    "categories_failed": old.get("categories_failed", 0),
    "validation_pass_rate": old.get("validation_pass_rate", 0),
    "consecutive_failures": consecutive,
    "errors": [message] if message else []
}

with open(health_path, "w") as f:
    json.dump(health, f, indent=2, ensure_ascii=False)
PYEOF
}

# ── 啟動 ──
log "========== AI News Hub 每日擷取開始 =========="
log "REPO_DIR=$REPO_DIR"
log "PATH=$PATH"

# ── 前置檢查 1：Claude CLI ──
CLAUDE_BIN=$(which claude 2>/dev/null || echo "")
if [[ -z "$CLAUDE_BIN" ]]; then
    log "ERROR: claude 指令找不到 (PATH=$PATH)"
    update_health_json "failed" "claude command not found in PATH"
    exit 1   # 2026-09-06：前置檢查失敗回非零，讓 fleet/run.sh 記進 runs.jsonl、F-3 早報列為失敗（原 exit 0 會被記成成功）
fi
log "Claude CLI: $CLAUDE_BIN"

if ! "$CLAUDE_BIN" auth status > /dev/null 2>&1; then
    log "ERROR: Claude auth failed"
    update_health_json "failed" "Claude auth status failed"
    exit 1   # 2026-09-06：前置檢查失敗回非零，讓 fleet/run.sh 記進 runs.jsonl、F-3 早報列為失敗（原 exit 0 會被記成成功）
fi
log "Claude auth: OK"

# ── 前置檢查 2：網路 ──
if ! curl -s --max-time 5 https://api.anthropic.com > /dev/null 2>&1; then
    log "ERROR: API connectivity check failed"
    update_health_json "failed" "API connectivity check failed"
    exit 1   # 2026-09-06：前置檢查失敗回非零，讓 fleet/run.sh 記進 runs.jsonl、F-3 早報列為失敗（原 exit 0 會被記成成功）
fi
log "Network: OK"

# ── 前置檢查 3：Git remote（僅警告）──
if ! git -C "$REPO_DIR" ls-remote origin HEAD > /dev/null 2>&1; then
    log "WARNING: Git remote check failed, continuing..."
fi

# Refuse pre-existing work/conflicts; only fast-forward before collecting.
cd "$REPO_DIR" || exit 1
if [[ "$(git branch --show-current)" != "main" || -n "$(git status --porcelain)" ]]; then
    log "❌ 排程 checkout 必須位於 main 且乾淨，請先處理未完成工作"
    exit 1
fi
for _state in MERGE_HEAD rebase-merge rebase-apply CHERRY_PICK_HEAD; do
    if [[ -e "$(git rev-parse --git-path "$_state")" ]]; then
        log "❌ 有未完成 Git 操作，保留現場並停止"
        exit 1
    fi
done
git fetch origin main || exit 1
# Only a recorded, clean failed-push candidate may be retried automatically.
python3 "$SCRIPTS_DIR/publish-daily.py" --root "$REPO_DIR" --retry-pending \
    --receipt "$HOME/.ai-news-hub/publication/last-run.json" || exit 1
git merge --ff-only origin/main || exit 1
# Other local-only commits require recovery/review; never repackage them as today's news.
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || exit 1
RUN_BASE=$(git rev-parse HEAD) || exit 1

# ── 星期判斷 & 分類排程 ──
DOW=$(date +%u)  # 1=週一 7=週日
DAILY_CATS=(papers topnews taiwan china usa techtrends governance)
WEEKLY_CATS=(models tutorials courses)

if [[ "$DOW" -eq 1 ]]; then
    CATEGORIES=( "${DAILY_CATS[@]}" "${WEEKLY_CATS[@]}" )
    log "📅 今天是週一，擷取全部類別（含每週類別）"
else
    CATEGORIES=( "${DAILY_CATS[@]}" )
    log "📅 今天是週 ${DOW}，僅擷取每日類別（每週類別保留上次資料）"
fi

CATEGORIES_OK=0
CATEGORIES_FAILED=0

SCRIPT_START=$(date +%s)
HARD_DEADLINE=$(( SCRIPT_START + 9900 ))   # 2 小時 45 分鐘

# 狀態目錄：各 fetch_one 子程序寫入 OK/FAIL/SKIP，主程序統計用
STATUS_DIR="$LOG_DIR/.status_$$"
mkdir -p "$STATUS_DIR"

log "開始擷取 ${#CATEGORIES[@]} 個類別: ${CATEGORIES[*]}"
log "硬性截止時間: $(date -r $HARD_DEADLINE '+%H:%M:%S' 2>/dev/null || date -d @$HARD_DEADLINE '+%H:%M:%S' 2>/dev/null || echo '計算中')"

# ── fetch_one CAT：單一類別完整擷取（含重試、fallback）──
# 設計為背景執行（&），結果寫入 STATUS_DIR/$CAT
fetch_one() {
    local CAT="$1"
    local ATTEMPT=1
    local MAX_ATTEMPTS=2
    local SUCCESS=0
    local TMP_FILE="$REPO_DIR/tmp_${CAT}.txt"

    log "[$CAT] 開始"

    while [[ $ATTEMPT -le $MAX_ATTEMPTS ]]; do
        if [[ $ATTEMPT -gt 1 ]]; then
            log "[$CAT]   重試 $((ATTEMPT-1))/1 (等待 30s)..."
            sleep 30
        fi

        local TIMEOUT_SEC=1200
        local TODAY_DATE; TODAY_DATE=$(date +%Y-%m-%d)
        local PROMPT_WITH_DATE
        PROMPT_WITH_DATE="Today's date is ${TODAY_DATE}. Please prioritize news from today and the past 24-48 hours.

$(cat "$SCRIPTS_DIR/prompts/${CAT}.md")"

        : > "$TMP_FILE"
        "$CLAUDE_BIN" -p "$PROMPT_WITH_DATE" \
            --max-turns 30 \
            --output-format text \
            --allowedTools "WebSearch" \
            2>>"$LOG_FILE" > "$TMP_FILE" &
        local CUR_PID=$!
        (
            sleep "$TIMEOUT_SEC"
            local KILL_DL=$(( $(date +%s) + 120 ))
            if kill -0 "$CUR_PID" 2>/dev/null; then
                echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$CAT]   ⏱️ 逾時 ${TIMEOUT_SEC}s，發送 SIGTERM" >> "$LOG_FILE"
                kill -TERM "$CUR_PID" 2>/dev/null
                pkill -TERM -P "$CUR_PID" 2>/dev/null || true
                sleep 3
                local _R=0
                while kill -0 "$CUR_PID" 2>/dev/null; do
                    if [ $(date +%s) -gt "$KILL_DL" ]; then
                        echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$CAT]   ❗ 進程無法終止，放棄等待" >> "$LOG_FILE"
                        break
                    fi
                    _R=$(( _R + 1 ))
                    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$CAT]   💀 SIGKILL #${_R}" >> "$LOG_FILE"
                    kill -KILL "$CUR_PID" 2>/dev/null || true
                    pkill -KILL -P "$CUR_PID" 2>/dev/null || true
                    sleep 5
                done
            fi
        ) &
        local WD_PID=$!
        wait "$CUR_PID" 2>/dev/null || true
        kill -KILL "$WD_PID" 2>/dev/null
        wait "$WD_PID" 2>/dev/null || true

        if [[ -s "$TMP_FILE" ]]; then
            python3 "$SCRIPTS_DIR/extract-json.py" < "$TMP_FILE" > "$DATA_DIR/${CAT}.json" 2>>"$LOG_FILE" || true
            local COUNT
            COUNT=$(python3 -c "
import json
try:
    d = json.load(open('$DATA_DIR/${CAT}.json'))
    print(len(d) if isinstance(d, list) else 0)
except:
    print(0)
" 2>/dev/null || echo "0")
            if [[ "$COUNT" -gt 0 ]]; then
                log "[$CAT] ✅ $COUNT 筆 (嘗試 ${ATTEMPT}/2)"
                SUCCESS=1
                break
            elif grep -qiE 'session limit|usage limit|rate limit|hit your limit|reached your|quota' "$TMP_FILE" 2>/dev/null; then
                # 硬性配額耗盡：數小時後才 reset，秒級重試無效 → 記錄原因並跳出改用 fallback
                REASON=$(grep -iE 'session limit|usage limit|rate limit|hit your limit|reached your|quota' "$TMP_FILE" 2>/dev/null | head -1 | cut -c1-120)
                log "[$CAT] 🚫 配額耗盡（非解析問題，重試無效）：${REASON}"
                echo "$REASON" > "$STATUS_DIR/$CAT.reason" 2>/dev/null || true
                cp "$TMP_FILE" "$LOG_DIR/failed_${CAT}_attempt${ATTEMPT}_${TODAY}.txt" 2>/dev/null || true
                break
            elif grep -qiE 'API Error|Connection closed|overloaded' "$TMP_FILE" 2>/dev/null; then
                # 暫時性連線 / 過載：重試可能成功，保留重試機會（僅末次失敗才記錄原因）
                REASON=$(grep -iE 'API Error|Connection closed|overloaded' "$TMP_FILE" 2>/dev/null | head -1 | cut -c1-120)
                log "[$CAT] ⚠️ 嘗試 ${ATTEMPT}：暫時性連線/過載（非解析問題），將重試：${REASON}"
                [[ $ATTEMPT -ge $MAX_ATTEMPTS ]] && echo "$REASON" > "$STATUS_DIR/$CAT.reason" 2>/dev/null || true
                cp "$TMP_FILE" "$LOG_DIR/failed_${CAT}_attempt${ATTEMPT}_${TODAY}.txt" 2>/dev/null || true
            else
                log "[$CAT] ⚠️ 嘗試 ${ATTEMPT}：抽出 0 筆（解析失敗），保留 tmp 供除錯"
                cp "$TMP_FILE" "$LOG_DIR/failed_${CAT}_attempt${ATTEMPT}_${TODAY}.txt" 2>/dev/null || true
            fi
        else
            log "[$CAT] ⚠️ 嘗試 ${ATTEMPT}：Claude 無輸出"
        fi

        ((ATTEMPT++)) || true
    done

    if [[ $SUCCESS -eq 1 ]]; then
        python3 -c "
import json
from datetime import datetime, timezone, timedelta
now = datetime.now(timezone(timedelta(hours=8))).isoformat()
path = '$DATA_DIR/${CAT}.json'
try:
    with open(path) as f:
        d = json.load(f)
    if isinstance(d, list):
        d = {'items': d, '_updated_at': now}
    elif isinstance(d, dict):
        d['_updated_at'] = now
    with open(path, 'w') as f:
        json.dump(d, f, indent=2, ensure_ascii=False)
except:
    pass
" 2>/dev/null || true
        echo "OK" > "$STATUS_DIR/$CAT"
    else
        log "[$CAT] ❌ 2 次失敗，嘗試 fallback 到上次資料"
        local FB
        FB=$(python3 -c "
import json
from datetime import datetime, timezone, timedelta
now = datetime.now(timezone(timedelta(hours=8))).isoformat()
try:
    latest = json.load(open('$DATA_DIR/latest.json'))
    items = latest.get('data', {}).get('$CAT', [])
    ts = latest.get('_updated_at', {}).get('$CAT', '')
    if isinstance(items, list) and len(items) > 0:
        with open('$DATA_DIR/${CAT}.json', 'w') as f:
            json.dump({'items': items, '_updated_at': ts or now, '_fallback': True}, f, indent=2, ensure_ascii=False)
        print(len(items))
    else:
        print(0)
except:
    print(0)
" 2>/dev/null || echo "0")
        if [[ "$FB" -gt 0 ]]; then
            log "[$CAT] 🔁 fallback 成功，沿用 ${FB} 筆"
        else
            log "[$CAT] ⛔ 無 fallback，寫入空陣列"
            echo '[]' > "$DATA_DIR/${CAT}.json"
        fi
        echo "FAIL" > "$STATUS_DIR/$CAT"
    fi

    rm -f "$TMP_FILE"
}

# ── run_batch 批次標籤 cat...：並行啟動一批 fetch_one，等全部完成 ──
run_batch() {
    local label="$1"; shift
    local cats=("$@")

    if [[ "$INTERRUPTED" -eq 1 ]] || [[ $(date +%s) -gt "$HARD_DEADLINE" ]]; then
        log "⏰ 超過截止時間，跳過批次 $label (${cats[*]})"
        for CAT in "${cats[@]}"; do
            [[ ! -s "$DATA_DIR/${CAT}.json" ]] && echo '[]' > "$DATA_DIR/${CAT}.json"
            echo "SKIP" > "$STATUS_DIR/$CAT"
        done
        return
    fi

    log "── 批次 $label 開始: ${cats[*]} ──"
    local pids=()
    for CAT in "${cats[@]}"; do
        fetch_one "$CAT" &
        pids+=($!)
    done
    for pid in "${pids[@]}"; do wait "$pid" || true; done
    log "── 批次 $label 完成 ──"
}

# ── 批次執行 ──
if [[ "$DOW" -eq 1 ]]; then
    # 週一：最吃 token 的每週累積類別「先跑」，避免配額被日更類別耗盡（見 2026-07-06 事件）。
    # 每週類別每週僅一次擷取機會，日更新聞失敗尚可隔天補；故優先保護每週類別。
    run_batch "1/3" models tutorials courses
    run_batch "2/3" papers taiwan china
    run_batch "3/3" topnews usa techtrends governance
else
    run_batch "1/2" papers taiwan china
    run_batch "2/2" topnews usa techtrends governance
fi

# ── 彙總結果（讀取各類別狀態檔）──
QUOTA_NOTE=""
for CAT in "${CATEGORIES[@]}"; do
    VAL=$(cat "$STATUS_DIR/$CAT" 2>/dev/null || echo "MISS")
    if [[ "$VAL" == "OK" ]]; then
        ((CATEGORIES_OK++)) || true
    else
        ((CATEGORIES_FAILED++)) || true
        if [[ -f "$STATUS_DIR/$CAT.reason" ]]; then
            QUOTA_NOTE="${QUOTA_NOTE}${QUOTA_NOTE:+, }$CAT"
        fi
    fi
done
rm -rf "$STATUS_DIR"

if [[ -n "$QUOTA_NOTE" ]]; then
    QUOTA_NOTE="配額/連線耗盡: ${QUOTA_NOTE}（秒級重試無效，已回退舊資料）"
    log "🚫 $QUOTA_NOTE"
fi

log "擷取完成: OK=$CATEGORIES_OK, Failed=$CATEGORIES_FAILED"

# ── 模型快訊 & 工具教學 累積合併（僅週一） ──
if [[ "$DOW" -eq 1 ]]; then
    log "執行模型快訊 / 工具教學 累積合併..."
    python3 "$SCRIPTS_DIR/merge-stack.py" >> "$LOG_FILE" 2>&1 || log "⚠️ merge-stack.py 失敗，使用當日資料"
else
    log "非週一，跳過 merge-stack.py（保留上次資料）"
fi

# ── 合併 latest.json ──
log "合併 latest.json..."

python3 << 'MERGE_PYEOF'
import json, os
from datetime import datetime, timezone, timedelta

DATA_DIR = "data"
ALL_CATEGORIES = ["papers", "topnews", "taiwan", "china", "usa", "techtrends", "governance", "tutorials", "courses", "models"]
WEEKLY_CATS = {"models", "tutorials", "courses"}

now = datetime.now(timezone(timedelta(hours=8)))
dow = now.isoweekday()  # 1=Mon 7=Sun

# 讀取上一期 latest.json（用於非週一保留每週類別資料）
old_latest = {}
latest_path = os.path.join(DATA_DIR, "latest.json")
if os.path.exists(latest_path):
    try:
        old_latest = json.load(open(latest_path))
    except:
        old_latest = {}

old_data = old_latest.get("data", {})
old_updated = old_latest.get("_updated_at", {})

merged = {}
updated_at = {}

for cat in ALL_CATEGORIES:
    cat_file = os.path.join(DATA_DIR, f"{cat}.json")

    if cat in WEEKLY_CATS and dow != 1:
        # 非週一：保留上次的每週類別資料
        items = old_data.get(cat, [])
        ts = old_updated.get(cat, "")
        print(f"  {cat}: 保留舊資料 ({len(items) if isinstance(items, list) else '?'} 筆) [每週一更新]")
    else:
        # 從今日擷取的 JSON 讀取
        try:
            with open(cat_file) as f:
                raw = json.load(f)
            if isinstance(raw, dict) and "items" in raw:
                items = raw["items"]
                ts = raw.get("_updated_at", now.isoformat())
            elif isinstance(raw, dict) and "_updated_at" in raw and "items" not in raw:
                ts = raw["_updated_at"]
                items = {k: v for k, v in raw.items() if k != "_updated_at"}
                items = list(items.values())[0] if len(items) == 1 else []
            elif isinstance(raw, list):
                items = raw
                ts = now.isoformat()
            else:
                items = []
                ts = now.isoformat()
        except:
            items = []
            ts = now.isoformat()

    if not isinstance(items, list):
        items = []

    merged[cat] = items
    updated_at[cat] = ts or now.isoformat()

# ── 至少 20 則：若今日 topnews/taiwan/china/usa 不足，補入符合日期限制的舊資料 ──
MIN_ITEMS = 20
# 各類別允許的最大天數（需與 validate.py CATEGORY_DATE_LIMITS 一致）
NEWS_CAT_DAYS = {"topnews": 1, "taiwan": 1, "china": 1, "usa": 1, "techtrends": 7, "governance": 7}
for cat in ["topnews", "taiwan", "china", "usa", "techtrends", "governance"]:
    current = merged.get(cat, [])
    if len(current) < MIN_ITEMS:
        old_items = old_data.get(cat, [])
        if not isinstance(old_items, list):
            old_items = []
        cat_days = NEWS_CAT_DAYS.get(cat, 7)
        cutoff = (now - timedelta(days=cat_days)).strftime("%Y-%m-%d")
        existing_urls = {item["url"] for item in current if isinstance(item, dict) and isinstance(item.get("url"), str)}
        # 只補入日期在允許範圍內的舊項目（確保不會被 validate.py 移除）
        supplements = [x for x in old_items
                       if isinstance(x, dict) and isinstance(x.get("url"), str) and x["url"] not in existing_urls
                       and isinstance(x.get("date"), str) and cutoff <= x["date"] <= now.strftime("%Y-%m-%d")]
        needed = MIN_ITEMS - len(current)
        picked = []
        for x in supplements[:needed]:
            y = dict(x); y["is_backfill"] = True   # 標記補入項目，供 metrics/回饋分析區分「當日新鮮」與「舊料補位」
            picked.append(y)
        merged[cat] = current + picked
        if supplements[:needed]:
            print(f"  {cat}: 今日 {len(current)} 筆 < {MIN_ITEMS}，補入 {len(supplements[:needed])} 筆（≥{cutoff}）→ 共 {len(merged[cat])} 筆")

output = {
    "date": now.strftime("%Y-%m-%d"),
    "time": now.isoformat(),
    "generated_at": now.strftime("%H:%M"),
    "source": "local",
    "data": merged,
    "stats": {cat: len(merged.get(cat, [])) for cat in ALL_CATEGORIES},
    "_updated_at": updated_at
}

with open(os.environ["LATEST_CANDIDATE"], "w") as f:
    json.dump(output, f, indent=2, ensure_ascii=False)

total = sum(output["stats"].values())
print(f"Merged: {total} items (DOW={dow}, weekly={'included' if dow==1 else 'preserved'})")
MERGE_PYEOF
if [[ $? -ne 0 ]]; then update_health_json failed '資料合併失敗'; exit 1; fi

# ── 驗證 ──
log "執行七步驟驗證..."
VALIDATION_EXIT=0
python3 "$SCRIPTS_DIR/validate.py" --input "$LATEST_CANDIDATE" 2>&1 || VALIDATION_EXIT=$?
if [[ "$VALIDATION_EXIT" -ne 0 ]]; then
    update_health_json failed '資料驗證失敗；保留上一份 latest.json'
    exit 1
fi
# Validated candidate is installed atomically on the same filesystem.
cp "$LATEST_CANDIDATE" "$DATA_DIR/latest.json.tmp" && mv "$DATA_DIR/latest.json.tmp" "$DATA_DIR/latest.json" || exit 1

# 讀取驗證通過率
PASS_RATE=$(python3 -c "
import json
try:
    d = json.load(open('$DATA_DIR/latest.json'))
    v = d.get('validation', {})
    print(int(v.get('pass_rate', 0)))
except:
    print(0)
" 2>/dev/null || echo "0")

log "驗證通過率: ${PASS_RATE}%"

# ── 歸檔 ──
log "歸檔 $TODAY.json..."
cp "$DATA_DIR/latest.json" "$DATA_DIR/$TODAY.json.tmp" && mv "$DATA_DIR/$TODAY.json.tmp" "$DATA_DIR/$TODAY.json" || exit 1

# 更新 index.json（保留 7 天）
python3 << 'INDEX_PYEOF'
import json, os
from datetime import datetime, timezone, timedelta

DATA_DIR = "data"
now = datetime.now(timezone(timedelta(hours=8)))
TODAY = now.strftime("%Y-%m-%d")
INDEX_FILE = os.path.join(DATA_DIR, "index.json")

try:
    latest = json.load(open(os.path.join(DATA_DIR, "latest.json")))
    time_str = latest.get("time", "")
    stats = latest.get("stats", {})
    validation = latest.get("validation", {})
except:
    time_str = now.isoformat()
    stats = {}
    validation = {}

index = []
if os.path.exists(INDEX_FILE):
    try:
        index = json.load(open(INDEX_FILE))
    except:
        index = []

# 移除今日舊記錄
index = [x for x in index if x.get("date") != TODAY]

# 新增今日
item_count = sum(stats.values()) if isinstance(stats, dict) else 0
pass_rate = validation.get("pass_rate", validation.get("validation_pass_rate", 0)) if isinstance(validation, dict) else 0
index.append({
    "date": TODAY,
    "time": time_str,
    "source": "local",
    "item_count": item_count,
    "validation_pass_rate": pass_rate,
    "stats": stats,
    "validation": validation
})

# 保留 7 天
cutoff = (now - timedelta(days=7)).strftime("%Y-%m-%d")
index = [x for x in index if x.get("date", "") >= cutoff]
index.sort(key=lambda x: x.get("date", ""), reverse=True)

with open(INDEX_FILE + ".tmp", "w") as f:
    json.dump(index, f, indent=2, ensure_ascii=False)

os.replace(INDEX_FILE + ".tmp", INDEX_FILE)
print(f"Index: {len(index)} entries")
INDEX_PYEOF
if [[ $? -ne 0 ]]; then update_health_json failed '歷史索引更新失敗'; exit 1; fi

# ── 冷封存：上傳逾 7 天 archive 到 Firestore，成功後 prune 本機（避免 git 膨脹）──
ARCHIVER_ENV_FILE="${ARCHIVER_ENV:-$HOME/.config/ai-news-hub/archiver.env}"
if command -v node >/dev/null 2>&1 && [ -f "$ARCHIVER_ENV_FILE" ]; then
    log "冷封存逾 7 天 archive 到 Firestore..."
    if node "$SCRIPTS_DIR/archive-to-firestore.mjs" --older-than 7 --prune >> "$LOG_FILE" 2>&1; then
        log "冷封存完成"
    else
        log "⚠️ 冷封存失敗（已保留本機 archive，下次重試）"
    fi
else
    log "未設定 archiver.env 或無 node，跳過 Firestore 冷封存"
fi

# ── L3 判讀層（advisory，不參與主管線成敗）──
# 為什麼掛在這裡：擷取與驗證都已完成、git push 還沒開始。判讀層讀得到當日的完整
# 語料，而它的產物全部落在 data/agent/.preview/（.gitignore:26 擋住），下面的
# `git add data/` 掃不到，所以就算判讀寫出垃圾也不會上線。
#
# 為什麼是 `|| true`：模型會逾時、會被 rate limit、會回不合契約的 JSON。這些都不
# 該讓「今天的新聞沒推上去」。判讀層失敗只降級 health.json 的 agent 區塊，主管線
# 的成敗完全由上面的擷取與驗證決定。
AGENT_STATUS_FILE="$DATA_DIR/agent/.preview/agent-run-status.json"
if [[ "${SKIP_AGENTS:-0}" == "1" ]]; then
    log "SKIP_AGENTS=1，跳過 L3 判讀層"
elif [[ -x "$SCRIPTS_DIR/run-agents.sh" ]]; then
    log "執行 L3 判讀層（advisory，失敗不影響主管線）..."
    AGENT_T0=$(date +%s)
    bash "$SCRIPTS_DIR/run-agents.sh" 2>&1 || true
    log "L3 判讀層耗時 $(( $(date +%s) - AGENT_T0 ))s"
else
    log "找不到可執行的 run-agents.sh，跳過 L3 判讀層"
fi

# ── 清理舊 log ──
log "清理 7 天前的 log..."
find "$LOG_DIR" -name "*.log" -mtime +7 -delete 2>/dev/null || true
find "$LOG_DIR" -name "validate-*.json" -mtime +7 -delete 2>/dev/null || true
find "$LOG_DIR" -name "failed_*.txt" -mtime +7 -delete 2>/dev/null || true

# ── 判定整體狀態 ──
if [[ $CATEGORIES_OK -eq ${#CATEGORIES[@]} ]]; then
    OVERALL_STATUS="ok"
elif [[ $CATEGORIES_OK -gt 0 ]]; then
    OVERALL_STATUS="partial"
else
    OVERALL_STATUS="failed"
fi

# ── 更新 health.json（最終版）──
python3 - "$OVERALL_STATUS" "$CATEGORIES_OK" "$CATEGORIES_FAILED" "$PASS_RATE" "$DATA_DIR/health.json" "$QUOTA_NOTE" "$AGENT_STATUS_FILE" "${POWER_SOURCE:-ac}" << 'HEALTH_PYEOF'
import json, sys, os
from datetime import datetime, timezone, timedelta

status = sys.argv[1]
cats_ok = int(sys.argv[2])
cats_fail = int(sys.argv[3])
pass_rate = int(sys.argv[4])
health_path = sys.argv[5]
quota_note = sys.argv[6] if len(sys.argv) > 6 else ""
agent_status_path = sys.argv[7] if len(sys.argv) > 7 else ""
power_source = sys.argv[8] if len(sys.argv) > 8 and sys.argv[8] == "battery" else "ac"

now = datetime.now(timezone(timedelta(hours=8)))

# L3 判讀層的狀態摘要。health.json 會隨 data/ 推上公開 repo，所以這裡只收
# 「跑了沒、幾步成功、花多久」這種營運數字，判讀內容一律不進來。
def agent_block(path):
    if not path or not os.path.exists(path):
        return {"overall": "absent", "note": "本輪未產生判讀層狀態檔"}
    try:
        d = json.load(open(path))
    except Exception:
        return {"overall": "unreadable", "note": "狀態檔存在但解析失敗"}
    stale = d.get("finished_at", "")[:10] != now.strftime("%Y-%m-%d")
    return {
        "overall": "stale" if stale else d.get("overall", "unknown"),
        "mode": d.get("mode"),
        "advisory": True,
        "production_write": False,
        "publish": "manual_only",
        "finished_at": d.get("finished_at"),
        "duration_sec": d.get("duration_sec"),
        "counts": d.get("counts", {}),
        "failed_steps": [s.get("step") for s in d.get("steps", []) if s.get("status") == "failed"],
    }

# 讀取舊值保留 last_success
old = {}
if os.path.exists(health_path):
    try:
        old = json.load(open(health_path))
    except:
        pass

health = {
    "last_run": now.isoformat(),
    "last_success": now.isoformat() if status == "ok" else old.get("last_success"),
    "last_success_scope": "local_processing",
    "publication": "pending",
    "last_date": now.strftime("%Y-%m-%d"),
    "source": "local",
    "status": status,
    "categories_ok": cats_ok,
    "categories_failed": cats_fail,
    "validation_pass_rate": pass_rate,
    "consecutive_failures": 0 if status in ("ok", "partial") else old.get("consecutive_failures", 0) + 1,
    "last_missed": None if status in ("ok", "partial") else old.get("last_missed"),
    "errors": ([quota_note] if quota_note else [])
              + ([f"電池模式執行（合蓋週期睡眠），{cats_fail} 類別回退"] if power_source == "battery" else []),
    "power_source": power_source,
    "agent": agent_block(agent_status_path),
}

with open(health_path, "w") as f:
    json.dump(health, f, indent=2, ensure_ascii=False)
HEALTH_PYEOF
if [[ $? -ne 0 ]]; then log "❌ health.json 寫入失敗"; exit 1; fi

# ── Git publication (commit -> three-way rebase -> ordinary push) ──
TAG="[unverified]"
[[ "$PASS_RATE" -eq 100 ]] && TAG="[verified]"
if ! python3 "$SCRIPTS_DIR/publish-daily.py" --root "$REPO_DIR" --base "$RUN_BASE" \
    --message "📰 AI News $TODAY $TAG [local]" \
    --receipt "$HOME/.ai-news-hub/publication/last-run.json"; then
    log "❌ 發布失敗；本機候選提交／檔案已保留供恢復"
    exit 1
fi
log "========== 完成 · 狀態: $OVERALL_STATUS · 驗證: ${PASS_RATE}% =========="
[[ "$OVERALL_STATUS" == "ok" ]] || exit 1
exit 0
