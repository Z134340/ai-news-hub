#!/usr/bin/env bash
# Phase 3-E（3-10）：把 .preview/weekly-report.md 以 Slack bot token 貼到指定頻道。
# 每週日由 run-agents 08f 在 build-weekly-report 之後呼叫；任何情況都不阻斷夜跑。
#
# 機密紅線④：token 只存在 ~/.config/ai-news-hub/slack.env（repo 外），本支：
#   - 只用 grep 解析 KEY=VALUE，不 source（不執行檔內任何指令）
#   - token 只出現在 curl 的 -H "Authorization: Bearer …" 標頭；不進 payload、不進 log、不進 jsonl
#   - 永不開 bash xtrace；所有 log 只印 channel／字數／ts／Slack 回的 error 名稱
# 缺 slack.env 或缺變數 → 印「Slack 未設定，跳過」exit 0（run-agents 全程正常）。
# 成功後把 {ts, channel, sent_at, report_date} 追加到 ~/.ai-news-hub/learning/weekly-report-sent.jsonl，
# 讓 3-11 之後能依 ts 讀回該則訊息的反應／回覆。
#
# 用法：bash scripts/agent/slack-notify.sh [--dry-run] [--self-test] [--report FILE] [--json FILE]
# 可覆寫的環境變數（自測用）：SLACK_ENV_FILE、SLACK_API_BASE、SLACK_SENT_LOG、SLACK_NOTIFY_DRY_RUN=1
set -euo pipefail

SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PREVIEW_DIR="$REPO_DIR/data/agent/.preview"

REPORT_MD="$PREVIEW_DIR/weekly-report.md"
REPORT_JSON="$PREVIEW_DIR/weekly-report.json"
ENV_FILE="${SLACK_ENV_FILE:-$HOME/.config/ai-news-hub/slack.env}"
API_BASE="${SLACK_API_BASE:-https://slack.com/api}"
SENT_LOG="${SLACK_SENT_LOG:-$HOME/.ai-news-hub/learning/weekly-report-sent.jsonl}"
DRY_RUN="${SLACK_NOTIFY_DRY_RUN:-0}"
SELF_TEST=0
MAX_CHARS=39000   # Slack chat.postMessage text 上限 40000

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)   DRY_RUN=1; shift ;;
        --self-test) SELF_TEST=1; shift ;;
        --report)    REPORT_MD="$2"; shift 2 ;;
        --json)      REPORT_JSON="$2"; shift 2 ;;
        *) echo "未知參數：$1" >&2; exit 2 ;;
    esac
done

log() { printf '[slack-notify] %s\n' "$*" >&2; }

# 只解析 KEY=VALUE（允許 export 前綴與單／雙引號），不 source。
read_env_var() { # file key
    local line
    line="$(grep -E "^(export[[:space:]]+)?$2=" "$1" 2>/dev/null | tail -n 1 || true)"
    line="${line#*=}"
    # 去掉行尾註解（空白後的 #）與前後空白，再脫引號
    line="$(printf '%s' "$line" | sed -E 's/[[:space:]]+#.*$//; s/^[[:space:]]+//; s/[[:space:]]+$//')"
    line="${line#\"}"; line="${line%\"}"
    line="${line#\'}"; line="${line%\'}"
    printf '%s' "$line"
}

# ── 自測 ──────────────────────────────────────────────────────────────────────
# 用 python3 起本機假 Slack（只收 /chat.postMessage），把 SLACK_API_BASE 指過去，
# 全程用假 token；驗證：缺 env 跳過、dry-run 不打、成功寫 jsonl、API 失敗不寫且 exit 1、
# 標頭正確、token 不出現在任何 stdout/stderr/jsonl/payload。
if [[ $SELF_TEST -eq 1 ]]; then
    exec python3 - "$SCRIPT_PATH" <<'PY'
import json, os, subprocess, sys, tempfile, threading
from http.server import BaseHTTPRequestHandler, HTTPServer

script = sys.argv[1]
fails = 0
def check(name, ok):
    global fails
    print(("PASS  " if ok else "FAIL  ") + name)
    if not ok: fails += 1

TOKEN = "fake-bot-token-SELFTEST-9f2c1a"
CHANNEL = "C0SELFTEST1"
received = []
mode = {"ok": True}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        n = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(n).decode("utf-8")
        received.append({"path": self.path, "auth": self.headers.get("Authorization"), "ctype": self.headers.get("Content-Type"), "body": body})
        resp = {"ok": True, "channel": CHANNEL, "ts": "1757000000.000100"} if mode["ok"] else {"ok": False, "error": "not_in_channel"}
        data = json.dumps(resp).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data))); self.end_headers()
        self.wfile.write(data)

srv = HTTPServer(("127.0.0.1", 0), H)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

tmp = tempfile.mkdtemp(prefix="slack-notify-")
md = os.path.join(tmp, "weekly-report.md"); js = os.path.join(tmp, "weekly-report.json")
env_file = os.path.join(tmp, "slack.env"); sent = os.path.join(tmp, "learning", "weekly-report-sent.jsonl")
open(md, "w").write("*AI News Hub 週報 2026-09-06*\n[P-001] brief-writer — 情境 \"引號\" 與反斜線\\ 測試\n")
open(js, "w").write(json.dumps({"schema": "weekly-report-v0.1", "report_date": "2026-09-06"}))

def run(extra_env=None, args=()):
    env = dict(os.environ)
    env.update({"SLACK_ENV_FILE": env_file, "SLACK_API_BASE": f"http://127.0.0.1:{port}", "SLACK_SENT_LOG": sent, "HOME": tmp})
    env.pop("SLACK_NOTIFY_DRY_RUN", None)
    if extra_env: env.update(extra_env)
    p = subprocess.run(["bash", script, "--report", md, "--json", js, *args], env=env, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr

# N-1 缺 slack.env → exit 0 並 log 跳過
code, out = run()
check("N-1 缺 slack.env → exit 0 並 log「Slack 未設定，跳過」", code == 0 and "Slack 未設定，跳過" in out and not received)

# N-2 有檔但缺 SLACK_CHANNEL_ID → 同樣跳過
open(env_file, "w").write(f'export SLACK_BOT_TOKEN="{TOKEN}"\n')
code, out = run()
check("N-2 slack.env 缺 SLACK_CHANNEL_ID → exit 0 跳過，且 token 不在輸出", code == 0 and "Slack 未設定，跳過" in out and TOKEN not in out and not received)

# N-3 dry-run：印 payload 摘要，不打 API，token 不在輸出
open(env_file, "w").write(f'SLACK_BOT_TOKEN="{TOKEN}"  # 註解\nSLACK_CHANNEL_ID={CHANNEL}\n')
code, out = run(args=["--dry-run"])
check("N-3 --dry-run 只印 payload 摘要、不打 API、token 不在輸出", code == 0 and "dry-run" in out and CHANNEL in out and TOKEN not in out and not received and not os.path.exists(sent))

# N-3b 環境變數 SLACK_NOTIFY_DRY_RUN=1 等同 --dry-run（run-agents --dry-run 走這條）
code, out = run(extra_env={"SLACK_NOTIFY_DRY_RUN": "1"})
check("N-3b SLACK_NOTIFY_DRY_RUN=1 等同 --dry-run", code == 0 and "dry-run" in out and not received)

# N-4 真發送（假伺服器）：標頭正確、payload 正確、ts 寫進 jsonl、token 不在任何輸出
code, out = run()
r = received[-1] if received else {}
body = json.loads(r.get("body") or "{}")
lines = [json.loads(l) for l in open(sent)] if os.path.exists(sent) else []
check("N-4 成功發送 → exit 0、Authorization: Bearer 正確、path=/chat.postMessage", code == 0 and r.get("auth") == f"Bearer {TOKEN}" and r.get("path", "").endswith("/chat.postMessage") and "application/json" in (r.get("ctype") or ""))
check("N-4b payload channel/text 正確（含引號與反斜線）、payload 不含 token", body.get("channel") == CHANNEL and body.get("text") == open(md).read() and TOKEN not in r.get("body", ""))
check("N-4c jsonl 追加 {ts, channel, sent_at, report_date}", len(lines) == 1 and lines[0].get("ts") == "1757000000.000100" and lines[0].get("channel") == CHANNEL and lines[0].get("report_date") == "2026-09-06" and "sent_at" in lines[0])
check("N-4d token 不在 stdout/stderr/jsonl", TOKEN not in out and TOKEN not in open(sent).read() and "1757000000.000100" in out)

# N-5 API 回 ok:false → exit 1、印 error 名、不追加 jsonl、token 不在輸出
mode["ok"] = False
code, out = run()
lines2 = [l for l in open(sent).read().splitlines() if l]
check("N-5 API ok:false → exit 1、log 含 not_in_channel、jsonl 不追加", code == 1 and "not_in_channel" in out and len(lines2) == 1 and TOKEN not in out)
mode["ok"] = True

# N-6 週報檔不存在 → exit 0 跳過
os.remove(md)
code, out = run()
check("N-6 weekly-report.md 不存在 → exit 0 跳過", code == 0 and "跳過" in out and len(received) == 2)

# N-7 靜態：腳本本身無 xtrace、無硬編 bot token 前綴、無 incoming-webhook 網域、token 只走 Authorization 標頭
src = open(script, encoding="utf-8").read()
# $SLACK_BOT_TOKEN 只允許出現在「-z 空值檢查」與「Authorization 標頭」兩行，不得進 log／echo／payload
tok_lines = [l for l in src.splitlines() if "$SLACK_BOT_TOKEN" in l and not ("-z" in l or "Authorization: Bearer" in l)]
check("N-7 腳本無 xtrace、無硬編 bot token 前綴、無 incoming-webhook 網域，token 只用於空值檢查與 Authorization 標頭", ("set " + "-x") not in src and ("xo" + "xb") not in src and ("hooks.slack" + ".com") not in src and not tok_lines and 'Authorization: Bearer $SLACK_BOT_TOKEN' in src)

srv.shutdown()
import shutil; shutil.rmtree(tmp, ignore_errors=True)
print("\n%d 項失敗" % fails if fails else "\nslack-notify 自測全綠")
sys.exit(1 if fails else 0)
PY
fi

# ── 正式流程 ──────────────────────────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
    log "Slack 未設定，跳過（找不到 ${ENV_FILE/#$HOME/~}）"
    exit 0
fi
SLACK_BOT_TOKEN="$(read_env_var "$ENV_FILE" SLACK_BOT_TOKEN)"
SLACK_CHANNEL_ID="$(read_env_var "$ENV_FILE" SLACK_CHANNEL_ID)"
if [[ -z "$SLACK_BOT_TOKEN" || -z "$SLACK_CHANNEL_ID" ]]; then
    log "Slack 未設定，跳過（slack.env 缺 SLACK_BOT_TOKEN 或 SLACK_CHANNEL_ID）"
    exit 0
fi
if [[ ! -s "$REPORT_MD" ]]; then
    log "週報不存在或為空（${REPORT_MD#$REPO_DIR/}），跳過"
    exit 0
fi

REPORT_DATE="$(python3 - "$REPORT_JSON" <<'PY' 2>/dev/null || date +%F
import json, sys
try:
    print(json.load(open(sys.argv[1]))["report_date"])
except Exception:
    print(__import__("datetime").date.today().isoformat())
PY
)"

TMP_DIR="$(mktemp -d -t slack-notify)"
trap 'rm -rf "$TMP_DIR"' EXIT
PAYLOAD="$TMP_DIR/payload.json"
# payload 只含 channel／text／mrkdwn；token 絕不進這個檔
python3 - "$REPORT_MD" "$SLACK_CHANNEL_ID" "$MAX_CHARS" "$PAYLOAD" <<'PY'
import json, sys
md, channel, max_chars, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
text = open(md, encoding="utf-8").read()
if len(text) > max_chars:
    text = text[:max_chars] + "\n…（週報過長，已截斷）"
json.dump({"channel": channel, "text": text, "mrkdwn": True}, open(out, "w", encoding="utf-8"), ensure_ascii=False)
PY
CHARS="$(python3 -c 'import json,sys;print(len(json.load(open(sys.argv[1]))["text"]))' "$PAYLOAD")"

if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] 不發送。channel=${SLACK_CHANNEL_ID} report_date=${REPORT_DATE} chars=${CHARS} api=${API_BASE}"
    log "[dry-run] 週報前 5 行："
    head -n 5 "$REPORT_MD" | sed 's/^/    /' >&2
    exit 0
fi

RESP="$TMP_DIR/resp.json"
if ! curl -sS -X POST "$API_BASE/chat.postMessage" \
        -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
        -H "Content-Type: application/json; charset=utf-8" \
        --data-binary @"$PAYLOAD" -o "$RESP" --max-time 30; then
    log "❌ curl 失敗（連不上 ${API_BASE}）"
    exit 1
fi

# 只印 ok／ts／error 三個欄位，不回顯整份回應
RESULT="$(python3 - "$RESP" <<'PY'
import json, sys
try:
    r = json.load(open(sys.argv[1]))
except Exception:
    print("PARSE_ERROR\t\t"); sys.exit(0)
print(("OK" if r.get("ok") else "ERR") + "\t" + str(r.get("ts") or "") + "\t" + str(r.get("error") or ""))
PY
)"
STATUS="${RESULT%%$'\t'*}"; REST="${RESULT#*$'\t'}"; TS="${REST%%$'\t'*}"; ERR="${REST#*$'\t'}"
if [[ "$STATUS" != "OK" || -z "$TS" ]]; then
    log "❌ Slack 回應失敗：${ERR:-$STATUS}（channel=${SLACK_CHANNEL_ID}）"
    exit 1
fi

mkdir -p "$(dirname "$SENT_LOG")"
SENT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
python3 - "$SENT_LOG" "$TS" "$SLACK_CHANNEL_ID" "$SENT_AT" "$REPORT_DATE" <<'PY'
import json, sys
log, ts, channel, sent_at, report_date = sys.argv[1:6]
with open(log, "a", encoding="utf-8") as f:
    f.write(json.dumps({"ts": ts, "channel": channel, "sent_at": sent_at, "report_date": report_date}) + "\n")
PY
log "✅ 已發送 channel=${SLACK_CHANNEL_ID} ts=${TS} chars=${CHARS} report_date=${REPORT_DATE} → ${SENT_LOG/#$HOME/~}"
