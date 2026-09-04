#!/bin/bash
# ============================================================
# ai-news-hub — L3 判讀層（agent stage）
#
# 為什麼獨立成一支，而不是把判讀與觀測步驟塞進 run-daily.sh：
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
#   環境變數：AGENT_BUDGET_SEC（整段預算，預設 2100）
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

BUDGET_SEC="${AGENT_BUDGET_SEC:-2100}"
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

# fail-open 覆蓋判定：比較「這輪剛寫出來的產物」與「開跑前的快照」，決定要不要把舊的
# 還原回去。整套防護的說明寫在下面 run_model_step 那一段；這支函式故意提前到自我測試
# 之前定義，S-9 才有辦法拿真檔案把四種判定各跑一次。
guard_verdict() { # new_file snapshot_file → kept | restored | no_snapshot | missing_new
    python3 - "$1" "$2" <<'PY'
import json, os, shutil, sys

new, snap = sys.argv[1], sys.argv[2]

def source_of(p):
    try:
        with open(p) as f:
            return json.load(f).get("source")
    except Exception:
        return None

if not os.path.exists(new):
    print("missing_new"); raise SystemExit
if source_of(new) != "fail_open":
    print("kept"); raise SystemExit
if not os.path.exists(snap):
    print("no_snapshot"); raise SystemExit
if source_of(snap) == "fail_open":
    # 上一輪本來就是空殼，還原回去沒有意義
    print("kept"); raise SystemExit
shutil.copy2(snap, new)
print("restored")
PY
}

# ── 決定論自我測試（不碰檔案、不呼叫模型）──
if [[ $SELF_TEST -eq 1 ]]; then
    FAILS=0
    TOTAL=0
    chk() { # 名稱 條件結果
        TOTAL=$((TOTAL+1))
        if [[ "$2" == "0" ]]; then echo "  ok   $1"; else echo "  FAIL $1"; FAILS=$((FAILS+1)); fi
    }

    # S-1 所有步驟的執行檔全部存在（接線斷掉要在跑模型之前就知道）
    for f in "$AGENT_SCRIPTS/build-insights.mjs" \
             "$AGENT_SCRIPTS/build-timeline.mjs" \
             "$AGENT_SCRIPTS/build-current-state-manifest.mjs" \
             "$AGENT_SCRIPTS/build-system-status.mjs" \
             "$AGENT_SCRIPTS/validate-system-status-schema.mjs" \
             "$AGENT_SCRIPTS/verify-dashboard-system-status.mjs" \
             "$AGENT_SCRIPTS/freshness-release-gate.mjs" \
             "$AGENT_SCRIPTS/build-review-packet.mjs" \
             "$AGENT_SCRIPTS/build-roadmap-input.mjs" \
             "$AGENT_SCRIPTS/build-brief-input.mjs" \
             "$AGENT_SCRIPTS/harvest-precedents.mjs" \
             "$AGENT_SCRIPTS/pull-feedback.mjs" \
             "$AGENT_SCRIPTS/build-category-metrics.mjs" \
             "$SCRIPTS_DIR/newshub_agents.py" \
             "$SCRIPTS_DIR/newshub_roadmap.py" \
             "$SCRIPTS_DIR/newshub_brief.py"; do
        [[ -f "$f" ]]; chk "S-1 執行檔存在：${f#$REPO_DIR/}" $?
    done

    # S-2 任何一個步驟的呼叫都不得帶晉升旗標：一旦帶了，產物會落到 data/agent/
    #     而被 run-daily.sh 的 `git add data/` 直接推上公開 repo。
    #     只檢查 run_*_step 開頭的實際呼叫行，上面註解提到旗標名不算違規。
    #     （模型步驟改走 run_model_step 之後，這個 pattern 一定要一起改，否則三支模型
    #      步驟會從所有發布安全檢查中憑空消失——S-8 就是釘住這件事的。）
    STEP_CALLS='^run_(step|model_step|observer_step) '
    ! grep -E "$STEP_CALLS" "$0" | grep -q -- "--promote"
    chk "S-2 沒有任何步驟帶 --promote（發布安全）" $?
    ! grep -E "$STEP_CALLS" "$0" | grep -q -- "--out-dir"
    chk "S-2b 沒有任何步驟覆寫 --out-dir" $?

    # S-3 .gitignore 必須仍然擋住 .preview/，否則所有產物會直接上公開 repo
    grep -qx "data/agent/.preview/" "$REPO_DIR/.gitignore"; chk "S-3 .gitignore 仍擋住 data/agent/.preview/" $?

    # S-4 所有輸出路徑都在 .preview/ 底下
    [[ "$STATUS_FILE" == "$PREVIEW_DIR"/* ]]; chk "S-4 狀態檔落在 .preview/ 底下" $?

    # S-5 預算配置必須容得下三個模型步驟，否則第三步注定被預算砍掉
    [[ $BUDGET_SEC -ge $(( MODEL_STEP_TIMEOUT * 5 )) ]]
    chk "S-5 預算 ${BUDGET_SEC}s ≥ 5×單步上限 $(( MODEL_STEP_TIMEOUT * 5 ))s" $?

    # S-6 記憶（agents/*/memory/）只能人工寫入。本支不得有任何步驟碰它。
    #     同樣只檢查實際呼叫行——註解裡提到路徑名不算違規。
    ! grep -E "$STEP_CALLS" "$0" | grep -q "memory/"
    chk "S-6 沒有任何步驟寫入 agents/*/memory/" $?

    # S-6b 真正的護欄不在這裡而在採收器內部（assertInsideOutDir 會在執行期擋掉
    #      任何落在 .preview/precedent-proposals/ 之外的寫入）。跑它的自測來確認。
    node "$AGENT_SCRIPTS/harvest-precedents.mjs" --self-test >/dev/null 2>&1
    chk "S-6b harvest-precedents 自測全綠（含 memory 寫入攔截）" $?
    node "$AGENT_SCRIPTS/build-current-state-manifest.mjs" --self-test >/dev/null 2>&1
    chk "S-6c current-state manifest fixtures 全綠" $?
    node "$AGENT_SCRIPTS/validate-system-status-schema.mjs" --self-test >/dev/null 2>&1
    chk "S-6d system-status-v1 schema 正反 fixtures 全綠" $?
    node "$AGENT_SCRIPTS/build-system-status.mjs" --self-test >/dev/null 2>&1
    chk "S-6e deterministic system status 狀態矩陣全綠" $?
    node "$AGENT_SCRIPTS/verify-dashboard-system-status.mjs" >/dev/null 2>&1
    chk "S-6f Dashboard system status current／pending／stale／missing／blocked 全綠" $?
    node "$AGENT_SCRIPTS/freshness-release-gate.mjs" --self-test >/dev/null 2>&1
    chk "S-6g freshness release gate manifest binding／hash parity／stale block 全綠" $?
    node "$AGENT_SCRIPTS/build-review-packet.mjs" --self-test >/dev/null 2>&1
    chk "S-6h review packet candidate／diff／report hashes 與 exact decision contract 全綠" $?
    node "$AGENT_SCRIPTS/pull-feedback.mjs" --self-test >/dev/null 2>&1; chk "S-6i pull-feedback 自測（env 解析／游標去重／去敏）" $?
    node "$AGENT_SCRIPTS/build-category-metrics.mjs" --self-test >/dev/null 2>&1; chk "S-6j build-category-metrics 自測（key 白名單去敏／同日冪等／缺 key 不 crash）" $?

    # S-7 語法檢查
    bash -n "$0"; chk "S-7 bash -n 通過" $?

    # S-8 三支會寫出 fail_open 空殼的模型步驟，必須全部走 run_model_step（才有快照保護），
    #     而且保護的檔名要跟它們實際寫出的產物一致。少一個或打錯字，防護等於沒裝，
    #     但腳本照樣全綠——所以把 DAG 的實際呼叫行抓出來對答案。
    guarded="$(grep -E '^run_model_step ' "$0" | awk '{print $3}' | tr -d '"' | sort | tr '\n' ' ')"
    [[ "$guarded" == "brief-latest.json roadmap.json trend-assessment.json " ]]
    chk "S-8 三支模型產物都有快照保護（實得：${guarded:-無}）" $?
    ! grep -E '^run_step ' "$0" | grep -qE 'newshub_(agents|roadmap|brief)\.py'
    chk "S-8b 沒有模型 runner 從沒保護的 run_step 溜過去" $?
    grep -qE '^run_observer_step "09-current-state-manifest" node "\$AGENT_SCRIPTS/build-current-state-manifest\.mjs"$' "$0"
    chk "S-8c current-state manifest 已接入不受上游阻擋的 observer step" $?
    grep -qE '^run_observer_step "10-system-status" node "\$AGENT_SCRIPTS/build-system-status\.mjs"$' "$0"
    chk "S-8d system status 已接在 manifest 後的 observer step" $?

    # S-9 guard_verdict 的四種判定各跑一次真檔案。這支函式是整套防護的唯一判準，
    #     判錯的後果是「空殼被當成好料晉升」或「好料被舊檔蓋掉」，兩邊都很貴。
    t9="$(mktemp -d -t agent-guard-test)"
    printf '{"source":"model","x":1}'     > "$t9/good.json"
    printf '{"source":"fail_open","x":0}' > "$t9/shell.json"
    v9() { guard_verdict "$1" "$2"; }

    cp "$t9/good.json" "$t9/n1.json";  cp "$t9/good.json"  "$t9/s1.json"
    [[ "$(v9 "$t9/n1.json" "$t9/s1.json")" == "kept" ]]
    chk "S-9a 新產物正常 → kept" $?

    cp "$t9/shell.json" "$t9/n2.json"; cp "$t9/good.json"  "$t9/s2.json"
    [[ "$(v9 "$t9/n2.json" "$t9/s2.json")" == "restored" ]]
    chk "S-9b 新的是空殼、舊的是好料 → restored" $?
    grep -q '"source":"model"' "$t9/n2.json"
    chk "S-9c restored 之後檔案內容真的換成舊的那份" $?

    cp "$t9/shell.json" "$t9/n3.json"
    [[ "$(v9 "$t9/n3.json" "$t9/nonexistent.json")" == "no_snapshot" ]]
    chk "S-9d 新的是空殼、沒有快照 → no_snapshot" $?

    cp "$t9/shell.json" "$t9/n4.json"; cp "$t9/shell.json" "$t9/s4.json"
    [[ "$(v9 "$t9/n4.json" "$t9/s4.json")" == "kept" ]]
    chk "S-9e 新舊都是空殼 → kept（還原沒有意義）" $?

    [[ "$(v9 "$t9/gone.json" "$t9/s1.json")" == "missing_new" ]]
    chk "S-9f 步驟中途死掉沒產出 → missing_new（不亂還原）" $?
    rm -rf "$t9"

    echo "[agent] self-test: $TOTAL 項，失敗 $FAILS"
    [[ $FAILS -eq 0 ]] && exit 0 || exit 1
fi

mkdir -p "$PREVIEW_DIR"
TMP_DIR="$(mktemp -d -t ai-news-hub-agent)"
STEP_LOG="$TMP_DIR/steps.jsonl"
SNAP_DIR="$TMP_DIR/snapshot"
mkdir -p "$SNAP_DIR"
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
        LAST_STEP_STATUS="skipped_budget"
        record_step "$name" "skipped_budget" 0 0 "整段預算已用盡"
        log "－ ${name}：跳過（預算用盡）"
        return 0
    fi
    if [[ -n "$FAILED_STEP" ]]; then
        LAST_STEP_STATUS="skipped_dep"
        record_step "$name" "skipped_dep" 0 0 "上游 $FAILED_STEP 失敗，本步驟的輸入不存在"
        log "－ ${name}：跳過（上游 ${FAILED_STEP} 失敗）"
        return 0
    fi
    if (( remain < MIN_REMAIN_SEC )); then
        BUDGET_OUT=1
        LAST_STEP_STATUS="skipped_budget"
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
        LAST_STEP_STATUS="ok"
        record_step "$name" "ok" 0 "$dur" ""
        log "✅ ${name}（${dur}s）"
    else
        LAST_STEP_STATUS="failed"
        FAILED_STEP="$name"
        record_step "$name" "failed" "$code" "$dur" "exit $code"
        log "❌ $name 失敗（exit $code, ${dur}s），最後 20 行："
        tail -n 20 "$TMP_DIR/$name.out" | sed 's/^/       /'
    fi
    return 0
}

# ── fail-open 覆蓋防護 ───────────────────────────────────────
# 問題：三支模型 runner 在模型掛掉時會走 fail_open()，寫出一個 source="fail_open"
#       的空殼檔，直接蓋掉上一輪好好的判讀。隔天人來晉升時，看到的是空殼——而且
#       檔案的 mtime 是新的，看起來還很新鮮。這比「今天沒更新」糟得多。
# 作法：模型步驟開跑前先把目標產物複製一份到 TMP_DIR/snapshot/，跑完之後只在
#       「新的是 fail_open、舊的不是」時把舊的還原回去。
# 刻意不做的事：
#   1. 不因為「內容變少 / 叢集數掉到 0」而還原——那可能是真實的當日訊號，不是故障。
#      只認 source 這個 runner 自己標記的故障旗標，判準單一、不會誤判。
#   2. 不改 FAILED_STEP 的傳播——還原產物只是保住可讀的舊內容，下游該跳過還是要跳過，
#      否則會拿舊的判讀去餵新的一層，混出一份沒人說得清是哪天的東西。
#   3. dry-run 不啟用——那個模式下模型步驟只印 prompt、根本不寫檔。
GUARDED_ARTIFACTS=""   # 有做快照保護的產物（給自我測試對照 DAG 用）
RESTORED=""            # 這一輪實際被還原的產物
LAST_STEP_STATUS=""

run_model_step() { # name artifact cmd...
    local name="$1" artifact="$2"; shift 2
    local target="$PREVIEW_DIR/$artifact" snap="$SNAP_DIR/$artifact"

    GUARDED_ARTIFACTS="$GUARDED_ARTIFACTS $artifact"
    if [[ -f "$target" ]]; then cp -p "$target" "$snap" 2>/dev/null; fi

    run_step "$name" "$@"

    # 只有真的跑過的步驟才需要判定；跳過的步驟根本沒動過檔案
    [[ "$LAST_STEP_STATUS" == "ok" || "$LAST_STEP_STATUS" == "failed" ]] || return 0
    [[ $DRY_RUN -eq 1 ]] && return 0

    local verdict
    verdict="$(guard_verdict "$target" "$snap")"
    case "$verdict" in
        restored)
            RESTORED="$RESTORED $artifact"
            log "⚠️  ${name}：新產物是 fail_open 空殼，已還原上一輪的 ${artifact}（內容是舊的，晉升前要自己看日期）" ;;
        no_snapshot)
            log "⚠️  ${name}：新產物是 fail_open 空殼，且沒有上一輪可還原——${artifact} 這輪等於沒有判讀" ;;
        missing_new)
            log "－ ${name}：沒有產出 ${artifact}（步驟中途就死了）" ;;
    esac
    return 0
}

# 觀測步驟不消耗模型預算，也不因上游失敗而跳過：缺檔與壞檔本身就是要留下的事實。
# 它仍透過同一份 step log 進入 agent-run-status，失敗時不得假裝整輪全綠。
run_observer_step() { # name cmd...
    local name="$1"; shift
    local t0 t1 code dur
    t0=$(date +%s)
    "$@" > "$TMP_DIR/$name.out" 2>&1
    code=$?
    t1=$(date +%s)
    dur=$(( t1 - t0 ))
    if [[ $code -eq 0 ]]; then
        record_step "$name" "ok" 0 "$dur" ""
        log "✅ ${name}（${dur}s）"
    else
        record_step "$name" "failed" "$code" "$dur" "exit $code"
        FAILED_STEP="$name"
        log "❌ $name 失敗（exit $code, ${dur}s），最後 20 行："
        tail -n 20 "$TMP_DIR/$name.out" | sed 's/^/       /'
    fi
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
# 00b 指標步驟唯一會寫到 .preview/ 之外（data/agent/metrics-history.jsonl）的確定性步驟：dry-run 時只印不落地。
METRICS_EXTRA=()
[[ $DRY_RUN -eq 1 ]] && METRICS_EXTRA=(--dry-run)

# AGENT_MODEL 是給演練用的：故意填一個不存在的模型名，就能重現「判讀層整片掛掉、
# 主管線照樣完成擷取與推送」的情境。日常不設，三支 runner 各自用內建預設模型。
if [[ -n "${AGENT_MODEL:-}" ]]; then
    MODEL_EXTRA=(${MODEL_EXTRA[@]+"${MODEL_EXTRA[@]}"} --model "$AGENT_MODEL")
    log "AGENT_MODEL=${AGENT_MODEL}（覆寫預設模型；正式排程不應設定此變數）"
fi

cd "$REPO_DIR" || { log "❌ 進不去 $REPO_DIR"; exit 1; }

# ── DAG：核心七步嚴格循序，任一步失敗則其下游全部 skipped_dep ──
# 1-2 是確定性程式（不呼叫模型），3/5/7 是模型判讀，4/6 是把上游判讀組成下一層的輸入。
# ── 00：把前端 好/中/不好 回饋從 Firestore 讀回本機帳本（archiver.env 不存在時靜默跳過；失敗不阻斷判讀）──
run_step "00-pull-feedback" node "$AGENT_SCRIPTS/pull-feedback.mjs"
FAILED_STEP=""
# ── 00b：每晚每分類聚合指標 append 到 data/agent/metrics-history.jsonl（只寫數字不寫標題／URL；同日冪等；失敗不阻斷判讀）──
run_step "00b-category-metrics" node "$AGENT_SCRIPTS/build-category-metrics.mjs" ${METRICS_EXTRA[@]+"${METRICS_EXTRA[@]}"}
FAILED_STEP=""
run_step "01-insights"      node "$AGENT_SCRIPTS/build-insights.mjs" --window "$INSIGHTS_WINDOW"
run_step "02-timeline"      node "$AGENT_SCRIPTS/build-timeline.mjs" --window "$TIMELINE_WINDOW"
run_model_step "03-trend-assess" trend-assessment.json python3 "$SCRIPTS_DIR/newshub_agents.py"  --timeout "$(model_timeout)" ${MODEL_EXTRA[@]+"${MODEL_EXTRA[@]}"}
run_step "04-roadmap-input" node "$AGENT_SCRIPTS/build-roadmap-input.mjs"
run_model_step "05-roadmap"      roadmap.json          python3 "$SCRIPTS_DIR/newshub_roadmap.py" --timeout "$(model_timeout)" ${MODEL_EXTRA[@]+"${MODEL_EXTRA[@]}"}
run_step "06-brief-input"   node "$AGENT_SCRIPTS/build-brief-input.mjs"
run_model_step "07-brief"        brief-latest.json     python3 "$SCRIPTS_DIR/newshub_brief.py"   --timeout "$(model_timeout)" ${MODEL_EXTRA[@]+"${MODEL_EXTRA[@]}"}

# ── W4：把閘1 的降級紀錄收成「判例候選」（只提案，永不自動寫進 memory）──
# 這步刻意不受 FAILED_STEP 阻擋：就算 05/07 掛了，03 產出的降級紀錄仍值得收。
HARVEST_BLOCKER="$FAILED_STEP"
FAILED_STEP=""
run_step "08-precedents"    node "$AGENT_SCRIPTS/harvest-precedents.mjs"
[[ -z "$FAILED_STEP" ]] && FAILED_STEP="$HARVEST_BLOCKER"

# ── ANH-001：最後盤點 current state。只寫 .preview，不受上游失敗與模型預算阻擋。──
run_observer_step "09-current-state-manifest" node "$AGENT_SCRIPTS/build-current-state-manifest.mjs"
# ── ANH-003：只以剛產出的 manifest 決定狀態；不讀牆鐘、不晉升。──
run_observer_step "10-system-status" node "$AGENT_SCRIPTS/build-system-status.mjs"

TOTAL_DUR=$(elapsed)

# ── 收斂狀態並落檔 ──
python3 - "$STEP_LOG" "$STATUS_FILE" "$START_ISO" "$TOTAL_DUR" "$MODE" "$PREVIEW_DIR" "$BUDGET_SEC" "$RESTORED" <<'PY'
import json, os, sys
from datetime import datetime, timezone, timedelta

step_log, status_path, started_at, total_dur, mode, preview_dir, budget, restored = sys.argv[1:9]

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

# 有東西被還原就一定不是 ok。今天三支 runner 都是 `return 0 if source != "fail_open" else 1`，
# 所以步驟本來就會記成 failed、overall 本來就會是 degraded——這行現在是冗的。留著是因為
# 還原後的舊檔 source 是 "model"，promote.sh 那道「產物必須出自模型」的閘攔不住它；
# 哪天有人把 runner 改成 fail_open 也 exit 0（很合理的改法，畢竟它本來就是刻意不炸），
# 唯一擋得住「三天前的判讀以今天、全綠的姿態上線」的就只剩這行。
if restored.split() and overall == "ok":
    overall = "degraded"

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
    # 被 fail-open 防護還原回上一輪的產物。非空代表這幾份判讀「不是今天的」——
    # promote.sh 會在晉升前把這串秀出來，人要自己決定舊料能不能上線。
    "restored_artifacts": restored.split(),
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
