#!/bin/bash
# ============================================================
# ai-news-hub — L3 判讀層（agent stage）
#
# 為什麼獨立成一支，而不是把七個步驟塞進 run-daily.sh：
#   run-daily.sh 是「擷取 → 驗證 → 歸檔 → 推送」的確定性主管線，711 行已經夠長，
#   而且它的成敗直接決定當天首頁有沒有新聞。判讀層會呼叫模型、會逾時、會失敗。
#   把不確定的路徑塞進確定的路徑，等於讓兩者共用同一個結束碼——模型掛掉就沒新聞。
#   拆開之後，主管線只要 `run-agents.sh || true`，判讀層怎麼死都不影響推送。
#
# 發布安全（重要）：
#   本支所有產物一律落在 data/agent/.preview/，那條路徑被 .gitignore:26 擋住。
#   run-daily.sh 每天執行 `git add data/`，少了那條 gitignore，這些檔案會直接
#   隨 GitHub Pages 上線。晉升到 data/agent/ 是人工動作（三份 agents/*/
#   hermes.project.yaml 的 publish: manual_only）。因此本支**刻意不提供** --promote。
#
# 用法：
#   scripts/run-agents.sh                 完整跑（會呼叫模型）
#   scripts/run-agents.sh --dry-run       只驗接線，模型步驟改跑 --print-prompt
#   scripts/run-agents.sh --self-test     只跑決定論自我測試，不碰任何檔案
#   scripts/run-agents.sh --strict        失敗時回傳非 0（給人工除錯用；排程不要用）
#   環境變數：AGENT_BUDGET_SEC（整段預算，預設 1500）
#             AGENT_STEP_TIMEOUT_SEC（單一模型步驟上限，預設 420）
# ============================================================

set -uo pipefail

export TZ=Asia/Taipei
# launchd 的 PATH 不含 /opt/homebrew/bin，wrapper 必須自帶（node / claude 都在那）
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:$PATH"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS_DIR="$REPO_DIR/scripts"
AGENT_SCRIPTS="$SCRIPTS_DIR/agent"
PREVIEW_DIR="$REPO_DIR/data/agent/.preview"
STATUS_FILE="$PREVIEW_DIR/agent-run-status.json"

BUDGET_SEC="${AGENT_BUDGET_SEC:-1500}"
MODEL_STEP_TIMEOUT="${AGENT_STEP_TIMEOUT_SEC:-420}"
# 低於這個剩餘秒數就不再起新步驟——起了也只會半途被砍，留下半截檔案更難查
MIN_REMAIN_SEC=45

DRY_RUN=0
SELF_TEST=0
STRICT=0
INSIGHTS_WINDOW="${AGENT_INSIGHTS_WINDOW:-7}"
TIMELINE_WINDOW="${AGENT_TIMELINE_WINDOW:-90}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)   DRY_RUN=1 ;;
        --self-test) SELF_TEST=1 ;;
        --strict)    STRICT=1 ;;
        --budget)    BUDGET_SEC="$2"; shift ;;
        --step-timeout) MODEL_STEP_TIMEOUT="$2"; shift ;;
        -h|--help)
            sed -n '2,26p' "$0"
            exit 0 ;;
        *)
            echo "[agent] 未知參數：$1" >&2
            exit 2 ;;
    esac
    shift
done

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [agent] $*"; }

START_EPOCH=$(date +%s)
START_ISO=$(date -Iseconds)
elapsed() { echo $(( $(date +%s) - START_EPOCH )); }

# ── 決定論自我測試（不碰檔案、不呼叫模型）──
if [[ $SELF_TEST -eq 1 ]]; then
    FAILS=0
    TOTAL=0
    chk() { # 名稱 條件結果
        TOTAL=$((TOTAL+1))
        if [[ "$2" == "0" ]]; then echo "  ok   $1"; else echo "  FAIL $1"; FAILS=$((FAILS+1)); fi
    }

    # S-1 七個步驟的執行檔全部存在（接線斷掉要在跑模型之前就知道）
    for f in "$AGENT_SCRIPTS/build-insights.mjs" \
             "$AGENT_SCRIPTS/build-timeline.mjs" \
             "$AGENT_SCRIPTS/build-roadmap-input.mjs" \
             "$AGENT_SCRIPTS/build-brief-input.mjs" \
             "$AGENT_SCRIPTS/harvest-precedents.mjs" \
             "$SCRIPTS_DIR/newshub_agents.py" \
             "$SCRIPTS_DIR/newshub_roadmap.py" \
             "$SCRIPTS_DIR/newshub_brief.py"; do
        [[ -f "$f" ]]; chk "S-1 執行檔存在：${f#$REPO_DIR/}" $?
    done

    # S-2 任何一個步驟的呼叫都不得帶晉升旗標：一旦帶了，產物會落到 data/agent/
    #     而被 run-daily.sh 的 `git add data/` 直接推上公開 repo。
    #     只檢查 run_step 開頭的實際呼叫行，上面註解提到旗標名不算違規。
    ! grep -E '^run_step ' "$0" | grep -q -- "--promote"
    chk "S-2 沒有任何步驟帶 --promote（發布安全）" $?
    ! grep -E '^run_step ' "$0" | grep -q -- "--out-dir"
    chk "S-2b 沒有任何步驟覆寫 --out-dir" $?

    # S-3 .gitignore 必須仍然擋住 .preview/，否則所有產物會直接上公開 repo
    grep -qx "data/agent/.preview/" "$REPO_DIR/.gitignore"; chk "S-3 .gitignore 仍擋住 data/agent/.preview/" $?

    # S-4 所有輸出路徑都在 .preview/ 底下
    [[ "$STATUS_FILE" == "$PREVIEW_DIR"/* ]]; chk "S-4 狀態檔落在 .preview/ 底下" $?

    # S-5 預算配置必須容得下三個模型步驟，否則第三步注定被預算砍掉
    [[ $BUDGET_SEC -ge $(( MODEL_STEP_TIMEOUT * 3 )) ]]
    chk "S-5 預算 ${BUDGET_SEC}s ≥ 3×單步上限 $(( MODEL_STEP_TIMEOUT * 3 ))s" $?

    # S-6 記憶（agents/*/memory/）只能人工寫入。本支不得有任何步驟碰它。
    #     同樣只檢查實際呼叫行——註解裡提到路徑名不算違規。
    ! grep -E '^run_step ' "$0" | grep -q "memory/"
    chk "S-6 沒有任何步驟寫入 agents/*/memory/" $?

    # S-6b 真正的護欄不在這裡而在採收器內部（assertInsideOutDir 會在執行期擋掉
    #      任何落在 .preview/precedent-proposals/ 之外的寫入）。跑它的自測來確認。
    node "$AGENT_SCRIPTS/harvest-precedents.mjs" --self-test >/dev/null 2>&1
    chk "S-6b harvest-precedents 自測全綠（含 memory 寫入攔截）" $?

    # S-7 語法檢查
    bash -n "$0"; chk "S-7 bash -n 通過" $?

    echo "[agent] self-test: $TOTAL 項，失敗 $FAILS"
    [[ $FAILS -eq 0 ]] && exit 0 || exit 1
fi

mkdir -p "$PREVIEW_DIR"
TMP_DIR="$(mktemp -d -t ai-news-hub-agent)"
STEP_LOG="$TMP_DIR/steps.jsonl"
: > "$STEP_LOG"
trap 'rm -rf "$TMP_DIR"' EXIT

MODE="full"
[[ $DRY_RUN -eq 1 ]] && MODE="dry-run"

log "========== L3 判讀層開始（mode=$MODE, 預算 ${BUDGET_SEC}s, 單步上限 ${MODEL_STEP_TIMEOUT}s）=========="
if [[ $DRY_RUN -eq 1 ]]; then
    log "dry-run：模型步驟改跑 --print-prompt，只驗輸入檔讀得到、prompt 組得起來；"
    log "         下游步驟會沿用 .preview/ 既有產物，不代表當日新鮮度。"
fi

FAILED_STEP=""
BUDGET_OUT=0

record_step() { # name status exit_code duration note
    python3 - "$STEP_LOG" "$1" "$2" "$3" "$4" "${5:-}" <<'PY'
import json, sys
path, name, status, code, dur, note = sys.argv[1:7]
with open(path, "a") as f:
    f.write(json.dumps({
        "step": name, "status": status,
        "exit_code": int(code), "duration_sec": int(dur),
        "note": note,
    }, ensure_ascii=False) + "\n")
PY
}

run_step() { # name cmd...
    local name="$1"; shift
    local remain=$(( BUDGET_SEC - $(elapsed) ))

    if [[ $BUDGET_OUT -eq 1 ]]; then
        record_step "$name" "skipped_budget" 0 0 "整段預算已用盡"
        log "－ ${name}：跳過（預算用盡）"
        return 0
    fi
    if [[ -n "$FAILED_STEP" ]]; then
        record_step "$name" "skipped_dep" 0 0 "上游 $FAILED_STEP 失敗，本步驟的輸入不存在"
        log "－ ${name}：跳過（上游 ${FAILED_STEP} 失敗）"
        return 0
    fi
    if (( remain < MIN_REMAIN_SEC )); then
        BUDGET_OUT=1
        record_step "$name" "skipped_budget" 0 0 "剩餘 ${remain}s < 最低起步門檻 ${MIN_REMAIN_SEC}s"
        log "－ ${name}：跳過（剩餘預算 ${remain}s）"
        return 0
    fi

    local t0 t1 code
    t0=$(date +%s)
    "$@" > "$TMP_DIR/$name.out" 2>&1
    code=$?
    t1=$(date +%s)
    local dur=$(( t1 - t0 ))

    if [[ $code -eq 0 ]]; then
        record_step "$name" "ok" 0 "$dur" ""
        log "✅ ${name}（${dur}s）"
    else
        FAILED_STEP="$name"
        record_step "$name" "failed" "$code" "$dur" "exit $code"
        log "❌ $name 失敗（exit $code, ${dur}s），最後 20 行："
        tail -n 20 "$TMP_DIR/$name.out" | sed 's/^/       /'
    fi
    return 0
}

# 模型步驟的逾時：取「單步上限」與「剩餘預算 − 15s 收尾」的較小者，最低 60s
model_timeout() {
    local remain=$(( BUDGET_SEC - $(elapsed) ))
    local t=$MODEL_STEP_TIMEOUT
    (( remain - 15 < t )) && t=$(( remain - 15 ))
    (( t < 60 )) && t=60
    echo "$t"
}

# macOS 的 /bin/bash 是 3.2：set -u 之下展開空陣列會直接報 unbound variable，
# 所以一律用 ${arr[@]+"${arr[@]}"} 這個寫法（陣列未設定時整段消失）。
MODEL_EXTRA=()
[[ $DRY_RUN -eq 1 ]] && MODEL_EXTRA=(--print-prompt)

# AGENT_MODEL 是給演練用的：故意填一個不存在的模型名，就能重現「判讀層整片掛掉、
# 主管線照樣完成擷取與推送」的情境。日常不設，三支 runner 各自用內建預設模型。
if [[ -n "${AGENT_MODEL:-}" ]]; then
    MODEL_EXTRA=(${MODEL_EXTRA[@]+"${MODEL_EXTRA[@]}"} --model "$AGENT_MODEL")
    log "AGENT_MODEL=${AGENT_MODEL}（覆寫預設模型；正式排程不應設定此變數）"
fi

cd "$REPO_DIR" || { log "❌ 進不去 $REPO_DIR"; exit 1; }

# ── DAG：七步嚴格循序，任一步失敗則其下游全部 skipped_dep ──
# 1-2 是確定性程式（不呼叫模型），3/5/7 是模型判讀，4/6 是把上游判讀組成下一層的輸入。
run_step "01-insights"      node "$AGENT_SCRIPTS/build-insights.mjs" --window "$INSIGHTS_WINDOW"
run_step "02-timeline"      node "$AGENT_SCRIPTS/build-timeline.mjs" --window "$TIMELINE_WINDOW"
run_step "03-trend-assess"  python3 "$SCRIPTS_DIR/newshub_agents.py"  --timeout "$(model_timeout)" ${MODEL_EXTRA[@]+"${MODEL_EXTRA[@]}"}
run_step "04-roadmap-input" node "$AGENT_SCRIPTS/build-roadmap-input.mjs"
run_step "05-roadmap"       python3 "$SCRIPTS_DIR/newshub_roadmap.py" --timeout "$(model_timeout)" ${MODEL_EXTRA[@]+"${MODEL_EXTRA[@]}"}
run_step "06-brief-input"   node "$AGENT_SCRIPTS/build-brief-input.mjs"
run_step "07-brief"         python3 "$SCRIPTS_DIR/newshub_brief.py"   --timeout "$(model_timeout)" ${MODEL_EXTRA[@]+"${MODEL_EXTRA[@]}"}

# ── W4：把閘1 的降級紀錄收成「判例候選」（只提案，永不自動寫進 memory）──
# 這步刻意不受 FAILED_STEP 阻擋：就算 05/07 掛了，03 產出的降級紀錄仍值得收。
HARVEST_BLOCKER="$FAILED_STEP"
FAILED_STEP=""
run_step "08-precedents"    node "$AGENT_SCRIPTS/harvest-precedents.mjs"
[[ -z "$FAILED_STEP" ]] && FAILED_STEP="$HARVEST_BLOCKER"

TOTAL_DUR=$(elapsed)

# ── 收斂狀態並落檔 ──
python3 - "$STEP_LOG" "$STATUS_FILE" "$START_ISO" "$TOTAL_DUR" "$MODE" "$PREVIEW_DIR" "$BUDGET_SEC" <<'PY'
import json, os, sys
from datetime import datetime, timezone, timedelta

step_log, status_path, started_at, total_dur, mode, preview_dir, budget = sys.argv[1:8]

steps = []
with open(step_log) as f:
    for line in f:
        line = line.strip()
        if line:
            steps.append(json.loads(line))

counts = {}
for s in steps:
    counts[s["status"]] = counts.get(s["status"], 0) + 1

if counts.get("failed") or counts.get("skipped_dep") or counts.get("skipped_budget"):
    overall = "degraded" if counts.get("ok") else "failed"
else:
    overall = "ok"

# 新鮮度只能從確定性產物讀——模型輸出（trend-assessment / roadmap / brief）
# 的 schema 裡沒有 source_latest_date，別假裝有。
freshness = {}
for name in ("timeline.json", "trends.json"):
    p = os.path.join(preview_dir, name)
    if os.path.exists(p):
        try:
            d = json.load(open(p))
            freshness[name] = {
                "source_latest_date": d.get("source_latest_date"),
                "generated_at": d.get("generated_at"),
            }
        except Exception as e:
            freshness[name] = {"error": str(e)}

now = datetime.now(timezone(timedelta(hours=8)))
out = {
    "schema": "agent-run-status-v1",
    "mode": mode,
    "advisory": True,
    "production_write": False,
    "publish": "manual_only",
    "started_at": started_at,
    "finished_at": now.isoformat(),
    "duration_sec": int(total_dur),
    "budget_sec": int(budget),
    "overall": overall,
    "counts": counts,
    "steps": steps,
    "freshness": freshness,
}
with open(status_path, "w") as f:
    json.dump(out, f, indent=2, ensure_ascii=False)
PY
OVERALL=$(python3 -c "import json;print(json.load(open('$STATUS_FILE'))['overall'])" 2>/dev/null || echo "failed")

log "========== L3 判讀層結束：${OVERALL}（${TOTAL_DUR}s）=========="
log "狀態檔：${STATUS_FILE#$REPO_DIR/}（.preview/ 被 gitignore 擋住，不會上線）"

if [[ $STRICT -eq 1 && "$OVERALL" != "ok" ]]; then
    exit 1
fi
exit 0
