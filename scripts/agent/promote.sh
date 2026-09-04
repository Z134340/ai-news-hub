#!/bin/bash
# ============================================================
# ai-news-hub — 晉升（promote）：.preview/ → data/agent/
#
# 這一步在做什麼：
#   run-agents.sh 每晚把判讀層產物寫進 data/agent/.preview/，那層被 .gitignore:26
#   擋掉，永遠不會上線。晉升＝人看過之後，把其中「可以公開」的檔案送進
#   data/agent/；run-daily.sh 隔天 `git add data/` 就會把它們推上 GitHub Pages。
#   換句話說，跑這支等於「同意這批內容公開」，因此四份 hermes.project.yaml 都標
#   publish: manual_only —— 排程不准碰，只有人可以按。
#
# 為什麼要一支腳本而不是直接 cp：
#   .preview/ 裡有兩個檔案永遠不能上線（roadmap-input.json 含 curator 的完整理由
#   文字，brief-input*.json 含原始語料）。它們的檔名跟可發布的 roadmap.json /
#   brief-latest.json 只差一個字，手打 cp 遲早會錯一次，而錯一次就是公開外洩。
#   白名單 + 封鎖名單寫死在這裡，比人的記性可靠。
#
# 兩種晉升方式，刻意不同：
#   確定性產物（timeline / trends / candidates / recommendations）→ 重跑 builder 帶
#     --promote。這些是純函數，同一份語料重跑必得同一份內容（除了 generated_at），
#     走官方旗標比複製檔案乾淨，也會在共享帳本記下 promoted: true。
#   模型產物（trend-assessment / roadmap / brief-latest）→ 直接複製。這些沒辦法重跑，
#     重跑等於換一份沒人看過的內容，還要再燒一次模型時間。
#
# 用法：
#   scripts/agent/promote.sh              預演：只檢查閘門、印出計畫，不寫任何檔案
#   scripts/agent/promote.sh --apply      真的晉升
#   scripts/agent/promote.sh --allow-degraded --apply
#                                         上一輪 overall 不是 ok 時仍要晉升（需自己確認）
# ============================================================

set -uo pipefail

export TZ=Asia/Taipei
# launchd 的 PATH 不含 /opt/homebrew/bin；這支雖然是人工執行，仍照同一套規矩
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:$PATH"

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
AGENT_SCRIPTS="$REPO_DIR/scripts/agent"
PREVIEW_DIR="$REPO_DIR/data/agent/.preview"
PUBLIC_DIR="$REPO_DIR/data/agent"
STATUS_FILE="$PREVIEW_DIR/agent-run-status.json"
FRESHNESS_GATE="$AGENT_SCRIPTS/freshness-release-gate.mjs"

# 跟 run-agents.sh 的 DAG 對齊；改那邊要一起改這邊，否則晉升出來的視窗會對不上
INSIGHTS_WINDOW="${AGENT_INSIGHTS_WINDOW:-7}"
TIMELINE_WINDOW="${AGENT_TIMELINE_WINDOW:-90}"

# 可晉升白名單（模型產物，用複製）
COPY_FILES="trend-assessment.json roadmap.json brief-latest.json"
# 永不上線的封鎖名單。roadmap-input 含完整理由文字、brief-input* 含原始語料、
# agent-run-status 與 current-state-manifest 是內部控制證據，永不公開。
NEVER_FILES="roadmap-input.json brief-input.json brief-input-7d.json agent-run-status.json current-state-manifest.json search-review-input.json change-eval-input.json"
# brief-latest-7d 前端未讀；system-status 雖已有 public UI consumer，但這支內容晉升
# 腳本不會自行發布狀態，只把 .preview/system-status 當 freshness gate 輸入。兩者都
# 不屬於本腳本的 copy/rebuild 集合；狀態發布仍須走 Owner-controlled 流程。
SKIP_FILES="brief-latest-7d.json system-status.json"

APPLY=0
ALLOW_DEGRADED=0
SELF_TEST=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --apply)           APPLY=1 ;;
        --allow-degraded)  ALLOW_DEGRADED=1 ;;
        --self-test)       SELF_TEST=1 ;;
        -h|--help)         sed -n '2,33p' "$0"; exit 0 ;;
        *) echo "[promote] 未知參數：$1" >&2; exit 2 ;;
    esac
    shift
done

log() { echo "[promote] $*"; }
die() { echo "[promote] ❌ $*" >&2; exit 1; }

# ── 自我測試：只驗不變式，不碰任何檔案 ──────────────────────────
if [[ $SELF_TEST -eq 1 ]]; then
    fails=0
    chk() { if [[ "$2" == "1" ]]; then echo "  ✅ $1"; else echo "  ❌ $1"; fails=$((fails+1)); fi; }
    echo "[promote] 自我測試"

    # P-1 封鎖名單與白名單不得有交集——有交集代表白名單把不該公開的檔案放行了
    overlap=0
    for c in $COPY_FILES; do
        for n in $NEVER_FILES; do [[ "$c" == "$n" ]] && overlap=1; done
    done
    chk "P-1 白名單與封鎖名單無交集" "$([[ $overlap -eq 0 ]] && echo 1 || echo 0)"

    # P-2 封鎖名單必須涵蓋 .preview/ 裡所有「不在白名單、也不是 builder 產出」的檔案。
    #     新增一個中間產物卻忘了列進封鎖名單，這條會紅。
    builder_out="timeline.json trends.json candidates.json recommendations.json learning-status.json"
    uncovered=""
    if [[ -d "$PREVIEW_DIR" ]]; then
        for f in "$PREVIEW_DIR"/*.json; do
            [[ -e "$f" ]] || continue
            b="$(basename "$f")"; known=0
            for k in $COPY_FILES $NEVER_FILES $SKIP_FILES $builder_out; do [[ "$b" == "$k" ]] && known=1; done
            [[ $known -eq 0 ]] && uncovered="$uncovered $b"
        done
    fi
    chk "P-2 .preview/ 沒有未分類檔案${uncovered:+（漏了：${uncovered}）}" "$([[ -z "$uncovered" ]] && echo 1 || echo 0)"

    # P-3 封鎖名單的檔案不得已經躺在 data/agent/（躺了就是過去某次誤發）
    leaked=""
    for n in $NEVER_FILES; do [[ -e "$PUBLIC_DIR/$n" ]] && leaked="$leaked $n"; done
    chk "P-3 公開目錄沒有封鎖名單檔案${leaked:+（外洩：${leaked}）}" "$([[ -z "$leaked" ]] && echo 1 || echo 0)"

    # P-4 預設不寫檔：沒有 --apply 就不能有任何寫入動作
    chk "P-4 預設為預演（需 --apply 才寫檔）" "$(grep -q 'APPLY -eq 0' "$0" && echo 1 || echo 0)"

    # P-5 bash 3.2 會把 `$var（` 整串當成變數名（全形字不是分隔符），配上 set -u 直接爆
    #     「未綁定的變數」。這個坑在這支腳本咬過兩次，所以寫成測試釘死：變數後面接全形
    #     字元一律要寫 ${var}。
    #     整行註解先清成空行（保留行號）再掃，否則這段說明自己會被抓。
    badvar="$(sed 's/^[[:space:]]*#.*//' "$0" \
        | grep -nE '\$[A-Za-z_][A-Za-z0-9_]*[^A-Za-z0-9_ "$'"'"'/):;,.=|&<>[{}!*?~+-]' \
        | cut -d: -f1 | tr '\n' ' ')"
    chk "P-5 沒有 \$var 直接接全形字的寫法${badvar:+（行：${badvar}）}" "$([[ -z "$badvar" ]] && echo 1 || echo 0)"

    # P-6/P-7 ANH-005：release gate 必須存在且紅隊 fixtures 全綠。這道 freshness gate
    # 沒有 override；--allow-degraded 只能處理 agent-run overall，不能放行 stale candidate。
    chk "P-6 freshness release gate 存在" "$([[ -f "$FRESHNESS_GATE" ]] && echo 1 || echo 0)"
    node "$FRESHNESS_GATE" --self-test >/dev/null 2>&1
    chk "P-7 freshness release gate fixtures 全綠" "$([[ $? -eq 0 ]] && echo 1 || echo 0)"
    gate_calls="$(grep -c '^if ! GATE_RESULT=.*FRESHNESS_GATE' "$0")"
    chk "P-8 promote 執行路徑確實呼叫 freshness gate（實得 ${gate_calls} 次）" "$([[ "$gate_calls" == "1" ]] && echo 1 || echo 0)"

    echo "[promote] 自我測試：$([[ $fails -eq 0 ]] && echo 全過 || echo "$fails 項失敗")"
    exit $(( fails > 0 ))
fi

# ── 閘門 ────────────────────────────────────────────────────
[[ -d "$PREVIEW_DIR" ]] || die "找不到 ${PREVIEW_DIR}，先跑 scripts/run-agents.sh"
[[ -f "$STATUS_FILE" ]] || die "找不到 agent-run-status.json，無法判斷上一輪跑得如何"

OVERALL="$(python3 -c "import json;print(json.load(open('$STATUS_FILE')).get('overall','?'))")"
RUN_AT="$(python3 -c "import json;print(json.load(open('$STATUS_FILE')).get('finished_at','?'))")"
log "上一輪：overall=${OVERALL}　結束於 ${RUN_AT}"

# 被 fail-open 防護還原回來的產物，內容是「上一輪」的，但 source 仍是 model，底下閘 2 那道
# 「必須出自模型」完全攔不住。所以在這裡把它們連同真正的產出時間攤開來講，讓人自己決定
# 舊料能不能上線。舊版狀態檔沒有這個鍵，讀不到就當空的。
# 時間用檔案 mtime 而不是檔內欄位：這三份模型產物的 schema 裡根本沒有時間戳（只有 schema /
# source / gate / model / session_id）。mtime 之所以可信，是因為快照與還原兩邊都刻意保留
# 時間（run-agents.sh 的 `cp -p` 與 shutil.copy2）——那個 -p 是這行訊息的唯一依據，別拿掉。
RESTORED_LIST="$(python3 -c "import json;print(' '.join(json.load(open('$STATUS_FILE')).get('restored_artifacts',[])))" 2>/dev/null || echo "")"
if [[ -n "$RESTORED_LIST" ]]; then
    log "⚠️  上一輪有產物被 fail-open 防護還原（模型當時掛了，這幾份是舊的）："
    for f in $RESTORED_LIST; do
        gen="$(date -r "$PREVIEW_DIR/$f" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "讀不到")"
        log "      ${f}　檔案時間 ${gen}（不是今天就是舊料）"
    done
fi

if [[ "$OVERALL" != "ok" ]]; then
    if [[ $ALLOW_DEGRADED -eq 1 ]]; then
        log "⚠️  overall=${OVERALL}，因 --allow-degraded 放行"
    else
        die "上一輪 overall=${OVERALL}（不是 ok）。確認過內容仍要晉升，加 --allow-degraded"
    fi
fi

# 閘 2：模型產物只要是 fail_open 就一律拒絕，沒有旗標可以繞過。
# fail_open 是「模型掛了，這輪不出判讀」的空殼；把空殼推上線比不更新更糟。
for f in $COPY_FILES; do
    src="$PREVIEW_DIR/$f"
    [[ -f "$src" ]] || die "$f 不存在於 .preview/，這一輪沒產出，不能晉升"
    s="$(python3 -c "import json;print(json.load(open('$src')).get('source','?'))" 2>/dev/null || echo "parse_error")"
    [[ "$s" == "model" ]] || die "$f 的 source=${s}（不是 model），拒絕晉升"
done

# ANH-005：exact manifest binding + current artifact hash parity + invocation-time freshness。
# 只讀檢查，無 bypass；通過只代表 candidate 可進 Owner review，不代表已獲批准。
if ! GATE_RESULT="$(node "$FRESHNESS_GATE" --root "$REPO_DIR" 2>&1)"; then
    die "freshness release gate 阻擋：${GATE_RESULT}"
fi
GATE_SUMMARY="$(printf '%s' "$GATE_RESULT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("state=%s publish=%s source=%s manifest=%s" % (d.get("freshness_state"), d.get("publish_state"), d.get("source_latest_date"), (d.get("stored_manifest_sha256") or "?")[:12]))' 2>/dev/null || echo "通過（摘要解析失敗）")"
log "freshness release gate PASS：${GATE_SUMMARY}；仍須 Owner 明確核可"

# 防禦加深：timeline 的語料日期仍須跟 repo 裡最新的一天對得上。
LATEST_CORPUS="$(ls "$REPO_DIR"/data/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].json 2>/dev/null | tail -1)"
LATEST_DATE="$(basename "${LATEST_CORPUS:-}" .json)"
TL_DATE="$(python3 -c "import json;print(json.load(open('$PREVIEW_DIR/timeline.json')).get('source_latest_date','?'))" 2>/dev/null || echo "?")"
if [[ "$TL_DATE" != "$LATEST_DATE" ]]; then
    die "timeline 的語料停在 ${TL_DATE}，但 repo 最新是 ${LATEST_DATE}。先跑 run-agents.sh 再晉升"
fi
log "語料日期對齊：${TL_DATE}"

# 閘 4：封鎖名單一律不得出現在公開目錄
for n in $NEVER_FILES; do
    [[ -e "$PUBLIC_DIR/$n" ]] && die "$n 已經在 data/agent/ 裡（這是不該公開的檔案），先處理再晉升"
done

# ── 計畫 ────────────────────────────────────────────────────
echo
log "晉升計畫："
log "  重建（builder --promote）：timeline.json、trends.json、candidates.json、recommendations.json"
for f in $COPY_FILES; do
    old="尚未發布"; [[ -f "$PUBLIC_DIR/$f" ]] && old="$(date -r "$PUBLIC_DIR/$f" '+%m-%d %H:%M')"
    log "  複製：${f}（線上 ${old} → 預覽 $(date -r "$PREVIEW_DIR/$f" '+%m-%d %H:%M')）"
done
log "  永不複製（含敏感內容）：${NEVER_FILES}"
log "  本腳本不複製（非此內容晉升流程）：${SKIP_FILES}"
echo

if [[ $APPLY -eq 0 ]]; then
    log "這是預演，沒有寫入任何檔案。確認以上無誤後加 --apply。"
    exit 0
fi

# ── 執行 ────────────────────────────────────────────────────
cd "$REPO_DIR" || die "進不去 $REPO_DIR"

log "重建 timeline（--window $TIMELINE_WINDOW --promote）"
node "$AGENT_SCRIPTS/build-timeline.mjs" --window "$TIMELINE_WINDOW" --promote > /dev/null \
    || die "build-timeline.mjs 失敗，晉升中止（data/agent/ 可能已被部分覆寫，用 git checkout 還原）"

log "重建 insights（--window $INSIGHTS_WINDOW --promote）"
node "$AGENT_SCRIPTS/build-insights.mjs" --window "$INSIGHTS_WINDOW" --promote > /dev/null \
    || die "build-insights.mjs 失敗，晉升中止（同上，用 git checkout 還原）"

for f in $COPY_FILES; do
    cp -p "$PREVIEW_DIR/$f" "$PUBLIC_DIR/$f" || die "複製 $f 失敗"
    log "已複製 $f"
done

# ── 事後驗證：五個前端會抓的檔案都要在、都要是合法 JSON ──
echo
FRONTEND_FILES="timeline.json trends.json trend-assessment.json roadmap.json brief-latest.json"
bad=0
for f in $FRONTEND_FILES; do
    p="$PUBLIC_DIR/$f"
    if [[ ! -f "$p" ]]; then log "❌ 缺 $f"; bad=1; continue; fi
    python3 -c "import json;json.load(open('$p'))" 2>/dev/null \
        || { log "❌ $f 不是合法 JSON"; bad=1; continue; }
    log "✅ ${f}（$(wc -c < "$p" | tr -d ' ')B）"
done
for n in $NEVER_FILES; do
    [[ -e "$PUBLIC_DIR/$n" ]] && { log "❌ 封鎖名單的 $n 竟然出現在公開目錄"; bad=1; }
done
[[ $bad -eq 0 ]] || die "晉升後驗證未過，請用 git status / git checkout 檢查"

echo
log "晉升完成。這些檔案現在在版控範圍內，下一次 run-daily.sh 的 git add data/ 會把它們推上線。"
log "還沒上線：要 commit + push 之後 GitHub Pages 才看得到。"
