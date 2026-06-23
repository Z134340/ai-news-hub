#!/bin/bash
# ============================================================
# 補跑指定類別，完成後整合今日 latest.json
# 用法：bash scripts/supplement-run.sh [cat1 cat2 ...]
# 預設補跑：topnews taiwan china usa techtrends governance
# ============================================================
set -uo pipefail
export TZ=Asia/Taipei
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:$PATH"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS_DIR="$REPO_DIR/scripts"
DATA_DIR="$REPO_DIR/data"
LOG_DIR="$DATA_DIR/logs"
TODAY=$(date +%Y-%m-%d)
LOG_FILE="$LOG_DIR/${TODAY}-supplement.log"

mkdir -p "$LOG_DIR"
exec >> "$LOG_FILE" 2>&1

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

CLAUDE_BIN=$(which claude 2>/dev/null || echo "")
if [[ -z "$CLAUDE_BIN" ]]; then
    log "ERROR: claude 指令找不到"; exit 1
fi

# 防止系統休眠（-d 螢幕 -i idle -m 磁碟 -s 蓋蓋；對齊 run-daily.sh）
caffeinate -dims &
CAFFEINATE_PID=$!
trap 'kill $CAFFEINATE_PID 2>/dev/null || true' EXIT

# 要補跑的類別（可由參數覆蓋）
if [[ $# -gt 0 ]]; then
    CATEGORIES=("$@")
else
    CATEGORIES=(topnews taiwan china usa techtrends governance)
fi
# 匯出給 merge python 段使用，決定哪些類別讀取「新」資料、哪些保留 latest.json 舊值
export REFETCHED_CATS="${CATEGORIES[*]}"

log "========== 補跑開始：${CATEGORIES[*]} =========="
CATEGORIES_OK=0
CATEGORIES_FAILED=0

for CAT in "${CATEGORIES[@]}"; do
    log "── 類別: $CAT ──"
    TMP_FILE="$REPO_DIR/tmp_${CAT}.txt"
    TODAY_DATE=$(date +%Y-%m-%d)
    PROMPT_WITH_DATE="Today's date is ${TODAY_DATE}. Please prioritize news from today and the past 24-48 hours.

$(cat "$SCRIPTS_DIR/prompts/${CAT}.md")"

    ATTEMPT=1
    MAX_ATTEMPTS=2
    SUCCESS=0

    while [[ $ATTEMPT -le $MAX_ATTEMPTS ]]; do
        [[ $ATTEMPT -gt 1 ]] && { log "  重試 $((ATTEMPT-1)) (等待 30s)..."; sleep 30; }

        : > "$TMP_FILE"
        "$CLAUDE_BIN" -p "$PROMPT_WITH_DATE" \
            --max-turns 30 \
            --output-format text \
            --allowedTools "WebSearch" \
            2>>"$LOG_FILE" > "$TMP_FILE" &
        CLAUDE_PID=$!

        # watchdog：KILL_DEADLINE 在 sleep 完後計算（避免 Mac 休眠導致即時過期）
        (
            sleep 1200
            KILL_DEADLINE=$(( $(date +%s) + 120 ))
            if kill -0 "$CLAUDE_PID" 2>/dev/null; then
                echo "[$(date '+%Y-%m-%d %H:%M:%S')]   ⏱️ 逾時，發送 SIGTERM" >> "$LOG_FILE"
                kill -TERM "$CLAUDE_PID" 2>/dev/null
                pkill -TERM -P "$CLAUDE_PID" 2>/dev/null || true
                sleep 3
                _R=0
                while kill -0 "$CLAUDE_PID" 2>/dev/null; do
                    [[ $(date +%s) -gt $KILL_DEADLINE ]] && {
                        echo "[$(date '+%Y-%m-%d %H:%M:%S')]   ❗ 放棄等待" >> "$LOG_FILE"
                        break
                    }
                    _R=$((_R+1))
                    kill -KILL "$CLAUDE_PID" 2>/dev/null || true
                    sleep 5
                done
            fi
        ) &
        WATCHDOG_PID=$!
        wait "$CLAUDE_PID" 2>/dev/null || true
        kill -KILL "$WATCHDOG_PID" 2>/dev/null
        wait "$WATCHDOG_PID" 2>/dev/null || true

        if [[ -s "$TMP_FILE" ]]; then
            python3 "$SCRIPTS_DIR/extract-json.py" < "$TMP_FILE" > "$DATA_DIR/${CAT}.json" 2>/dev/null || true
            COUNT=$(python3 -c "
import json
try:
    d = json.load(open('$DATA_DIR/${CAT}.json'))
    print(len(d) if isinstance(d, list) else 0)
except: print(0)
" 2>/dev/null || echo 0)
            if [[ "$COUNT" -gt 0 ]]; then
                log "  ✅ $CAT: $COUNT 筆"
                SUCCESS=1
                break
            else
                log "  ⚠️ $CAT 嘗試 ${ATTEMPT}：0 筆"
                cp "$TMP_FILE" "$LOG_DIR/failed_${CAT}_attempt${ATTEMPT}_${TODAY}.txt" 2>/dev/null || true
            fi
        else
            log "  ⚠️ $CAT 嘗試 ${ATTEMPT}：無輸出"
        fi
        ((ATTEMPT++)) || true
    done

    if [[ $SUCCESS -eq 1 ]]; then
        # 注入 _updated_at
        python3 -c "
import json
from datetime import datetime, timezone, timedelta
now = datetime.now(timezone(timedelta(hours=8))).isoformat()
path = '$DATA_DIR/${CAT}.json'
with open(path) as f:
    d = json.load(f)
if isinstance(d, list):
    d = {'items': d, '_updated_at': now}
elif isinstance(d, dict):
    d['_updated_at'] = now
with open(path, 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
" 2>/dev/null || true
        ((CATEGORIES_OK++)) || true
    else
        log "  ❌ $CAT: 全失敗，保留舊資料（不覆蓋）"
        ((CATEGORIES_FAILED++)) || true
    fi

    rm -f "$TMP_FILE"
    [[ "$CAT" != "${CATEGORIES[${#CATEGORIES[@]}-1]}" ]] && sleep 10
done

log "補跑完成: OK=$CATEGORIES_OK, Failed=$CATEGORIES_FAILED"

# ── 重新合併 latest.json（保留今日已成功的類別資料）──
log "重新合併 latest.json..."
python3 << 'MERGE_PYEOF'
import json, os
from datetime import datetime, timezone, timedelta

DATA_DIR = "data"
ALL_CATEGORIES = ["papers", "topnews", "taiwan", "china", "usa", "techtrends", "governance", "tutorials", "courses", "models"]

now = datetime.now(timezone(timedelta(hours=8)))

# 補跑模式：只把這次明確指定的類別當作「新資料」讀取，其他全部保留 latest.json 既有值
refetched = set(os.environ.get("REFETCHED_CATS", "").split())

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

    if cat not in refetched:
        items = old_data.get(cat, [])
        ts = old_updated.get(cat, "")
        print(f"  {cat}: 保留 latest.json 既有 ({len(items) if isinstance(items, list) else '?'} 筆)")
    else:
        try:
            with open(cat_file) as f:
                raw = json.load(f)
            if isinstance(raw, dict) and "items" in raw:
                items = raw["items"]
                ts = raw.get("_updated_at", now.isoformat())
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

# 補足不足 20 筆（只補入符合日期限制的舊項目，確保不被 validate.py 移除）
MIN_ITEMS = 20
NEWS_CAT_DAYS = {"topnews": 2, "taiwan": 2, "china": 2, "usa": 2, "techtrends": 7, "governance": 7}
for cat in ["topnews", "taiwan", "china", "usa", "techtrends", "governance"]:
    current = merged.get(cat, [])
    if len(current) < MIN_ITEMS:
        old_items = old_data.get(cat, [])
        if not isinstance(old_items, list):
            old_items = []
        cat_days = NEWS_CAT_DAYS.get(cat, 7)
        cutoff = (now - timedelta(days=cat_days)).strftime("%Y-%m-%d")
        existing_urls = {item.get("url","") for item in current if item.get("url")}
        supplements = [x for x in old_items
                       if x.get("url","") not in existing_urls
                       and x.get("date","") >= cutoff]
        needed = MIN_ITEMS - len(current)
        merged[cat] = current + supplements[:needed]
        if supplements[:needed]:
            print(f"  {cat}: 今日 {len(current)} 筆 < {MIN_ITEMS}，補入 {len(supplements[:needed])} 筆（≥{cutoff}）")

output = {
    "date": now.strftime("%Y-%m-%d"),
    "time": now.isoformat(),
    "generated_at": now.strftime("%H:%M"),
    "source": "local",
    "data": merged,
    "stats": {cat: len(merged.get(cat, [])) for cat in ALL_CATEGORIES},
    "_updated_at": updated_at
}

with open(latest_path, "w") as f:
    json.dump(output, f, indent=2, ensure_ascii=False)

total = sum(output["stats"].values())
print(f"Merged: {total} items")
for cat, items in output["data"].items():
    ts = updated_at.get(cat, "")[:16]
    print(f"  {cat}: {len(items)} 筆  (updated: {ts})")
MERGE_PYEOF

# ── 驗證 ──
log "執行驗證..."
python3 "$SCRIPTS_DIR/validate.py" 2>&1 || true

PASS_RATE=$(python3 -c "
import json
try:
    d = json.load(open('$DATA_DIR/latest.json'))
    v = d.get('validation', {})
    print(int(v.get('pass_rate', 0)))
except: print(0)
" 2>/dev/null || echo 0)
log "驗證通過率: ${PASS_RATE}%"

# ── 歸檔 ──
cp "$DATA_DIR/latest.json" "$DATA_DIR/$TODAY.json"
log "歸檔 $TODAY.json"

# ── Git push ──
log "推送到 GitHub..."
cd "$REPO_DIR"
git fetch origin main 2>/dev/null || true
git reset --soft origin/main 2>/dev/null || true
git add data/ 2>/dev/null || true

if git diff --staged --quiet 2>/dev/null; then
    log "無變更，跳過推送"
else
    TAG="[unverified]"
    python3 -c "exit(0 if float('$PASS_RATE') >= 100 else 1)" 2>/dev/null || TAG="[unverified]"
    [[ "$PASS_RATE" == "100" ]] && TAG="[verified]"

    git commit -m "📰 AI News $TODAY [supplement] $TAG [local]" 2>/dev/null || true
    for i in 1 2 3; do
        git push origin main 2>/dev/null && { log "✅ 推送成功"; break; }
        [[ $i -lt 3 ]] && { git fetch origin main 2>/dev/null || true; git reset --soft origin/main 2>/dev/null || true; git add data/ 2>/dev/null || true; git diff --staged --quiet 2>/dev/null || git commit -m "📰 AI News $TODAY [supplement] $TAG [local]" 2>/dev/null || true; sleep 5; }
    done
fi

log "========== 補跑結束 · 驗證: ${PASS_RATE}% =========="
