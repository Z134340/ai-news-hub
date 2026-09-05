#!/usr/bin/env node
// 讀回週報在 Slack 上收到的「人工挑選」——哪幾筆判例候選要收、還是全收。
//
// 白話：週日 08f 把週報貼到 Slack 之後，人會在那則訊息上按 ✅ 或在討論串回
// 「[P-003] 👍」。這支夜班腳本把那些反應／回覆讀回來，翻成 P-nnn 清單，落地成
// 一份預覽檔。它只是把「人說了什麼」記下來；真正把判例寫進 agents/*/memory/precedents.jsonl
// 仍然是人工（§1 決策 2）。
//
// 規則：
//   - 訊息本體有 ✅（white_check_mark）→ picked_all=true（全收）。
//   - 討論串回覆內含 [P-nnn] 或 P-nnn → 只收那幾筆（去重、排序）。
//   - 兩者同時存在 → picked_all=true 且 picked 照列（人工看得到兩種訊號）。
//
// 邊界：
//   - 只讀 Slack（reactions.get + conversations.replies），永不發訊、永不改反應。
//   - 缺 slack.env／缺 SLACK_BOT_TOKEN／缺 sent log → 印「跳過」exit 0、零寫入。
//   - token 只放 Authorization 標頭；不回顯、不進 log／輸出檔。
//   - 不寫 memory/**、不改 precedents.jsonl、不寫帳本（EVENT_TYPES 無對應事件）。
//   - 輸出：data/agent/.preview/precedent-picks.json（gitignore）
//         + append ~/.ai-news-hub/learning/precedent-picks.jsonl（off-repo）
//   - 回覆原文不落地：只留 P-nnn 與作者數，避免人名／自由文字進檔。
//
// 用法：node scripts/agent/read-slack-picks.mjs [--dry-run] [--self-test]
// 環境變數（自測／覆寫用）：SLACK_ENV_FILE、SLACK_API_BASE、SLACK_SENT_LOG、
//   AGENT_PREVIEW_DIR（預設 <repo>/data/agent/.preview）、AGENT_LEARNING_DIR（預設 ~/.ai-news-hub/learning）

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCHEMA = "precedent-picks/v1";
const CHECK_EMOJI = new Set(["white_check_mark", "heavy_check_mark", "ballot_box_with_check"]);
const PID_RE = /\[?\bP-(\d{3})\b\]?/g;

// ── 設定（全部可用環境變數覆寫，自測靠這個）────────────────────────────────
function cfg(env = process.env) {
  const home = env.HOME || os.homedir();
  return {
    envFile: env.SLACK_ENV_FILE || path.join(home, ".config", "ai-news-hub", "slack.env"),
    apiBase: (env.SLACK_API_BASE || "https://slack.com/api").replace(/\/+$/, ""),
    sentLog: env.SLACK_SENT_LOG || path.join(home, ".ai-news-hub", "learning", "weekly-report-sent.jsonl"),
    previewDir: env.AGENT_PREVIEW_DIR || path.join(REPO_ROOT, "data", "agent", ".preview"),
    learningDir: env.AGENT_LEARNING_DIR || path.join(home, ".ai-news-hub", "learning"),
  };
}

// ── 純函式（可離線自測）──────────────────────────────────────────────────
// 跟 slack-notify.sh 的 read_env_var 同一套：支援 `export KEY="v"`、行尾 `# 註解`。
export function parseEnvText(text) {
  const out = {};
  for (const raw of String(text || "").split("\n")) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].replace(/\s+#.*$/, "").trim();
    v = v.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    out[m[1]] = v;
  }
  return out;
}

export function lastSent(text) {
  const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const o = JSON.parse(lines[i]);
      if (o && o.ts && o.channel) return { ts: String(o.ts), channel: String(o.channel), report_date: o.report_date || null };
    } catch { /* 壞行略過 */ }
  }
  return null;
}

export function extractPids(text) {
  const set = new Set();
  for (const m of String(text || "").matchAll(PID_RE)) set.add(`P-${m[1]}`);
  return [...set].sort();
}

// reactions.get 回傳 {ok, message:{reactions:[{name,count,users}]}}
export function hasCheck(reactionsResp) {
  const list = (reactionsResp && reactionsResp.message && reactionsResp.message.reactions) || [];
  return list.some((r) => CHECK_EMOJI.has(String(r.name || "").replace(/::.*$/, "")) && Number(r.count || 0) > 0);
}

// conversations.replies 回傳 {ok, messages:[...]}；第一筆是原訊息本身，要跳過。
export function pidsFromReplies(repliesResp, rootTs) {
  const msgs = (repliesResp && repliesResp.messages) || [];
  const set = new Set();
  const authors = new Set();
  for (const m of msgs) {
    if (!m || String(m.ts) === String(rootTs)) continue;
    const pids = extractPids(m.text);
    if (!pids.length) continue;
    pids.forEach((p) => set.add(p));
    if (m.user) authors.add(String(m.user));
  }
  return { picked: [...set].sort(), reply_count: Math.max(0, msgs.length - 1), authors: authors.size };
}

export function buildPicks({ sent, reactions, replies, now = new Date() }) {
  const r = pidsFromReplies(replies, sent.ts);
  return {
    schema: SCHEMA,
    report_ts: sent.ts,
    report_date: sent.report_date || null,
    picked: r.picked,
    picked_all: hasCheck(reactions),
    reply_count: r.reply_count,
    reply_authors: r.authors,
    fetched_at: now.toISOString(),
    note: "人工挑選紀錄；寫進 agents/*/memory/precedents.jsonl 仍是人工。",
  };
}

// 任何輸出都不得含 token；自測與正式路徑都過這一關。
export function assertNoToken(obj, token) {
  if (!token) return;
  const s = JSON.stringify(obj);
  if (s.includes(token) || /xox[abp]-[A-Za-z0-9-]{8,}/.test(s)) throw new Error("輸出含 token，拒絕寫入");
}

// ── Slack 讀取 ────────────────────────────────────────────────────────────
async function slackGet(apiBase, token, method, params, fetchImpl) {
  const url = `${apiBase}/${method}?${new URLSearchParams(params).toString()}`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!body || body.ok !== true) {
    const err = (body && body.error) || `http ${res.status}`;
    throw new Error(`${method} 失敗：${String(err).slice(0, 80)}`);
  }
  return body;
}

// ── 主流程 ───────────────────────────────────────────────────────────────
export async function run(opts = {}) {
  const c = cfg(opts.env || process.env);
  const log = opts.log || ((s) => console.log(s));
  const fetchImpl = opts.fetch || globalThis.fetch;
  const dryRun = !!opts.dryRun;

  if (!fs.existsSync(c.envFile)) { log("read-slack-picks: Slack 未設定（無 slack.env），跳過"); return 0; }
  const env = parseEnvText(fs.readFileSync(c.envFile, "utf8"));
  const token = env.SLACK_BOT_TOKEN || "";
  if (!token) { log("read-slack-picks: Slack 未設定（缺 SLACK_BOT_TOKEN），跳過"); return 0; }

  if (!fs.existsSync(c.sentLog)) { log("read-slack-picks: 尚無已發送週報紀錄，跳過"); return 0; }
  const sent = lastSent(fs.readFileSync(c.sentLog, "utf8"));
  if (!sent) { log("read-slack-picks: sent log 無有效紀錄，跳過"); return 0; }

  let reactions;
  let replies;
  try {
    reactions = await slackGet(c.apiBase, token, "reactions.get", { channel: sent.channel, timestamp: sent.ts, full: "true" }, fetchImpl);
    replies = await slackGet(c.apiBase, token, "conversations.replies", { channel: sent.channel, ts: sent.ts, limit: "200" }, fetchImpl);
  } catch (e) {
    // 離線／權限不足／訊息被刪：印一行、不寫檔、不算失敗（非阻塞步驟）。
    log(`read-slack-picks: Slack 讀取失敗，跳過（${String(e && e.message || e).slice(0, 120)}）`);
    return 0;
  }

  const picks = buildPicks({ sent, reactions, replies });
  assertNoToken(picks, token);
  const summary = `report_ts=${picks.report_ts} picked_all=${picks.picked_all} picked=${picks.picked.join(",") || "-"} replies=${picks.reply_count}`;
  if (dryRun) { log(`read-slack-picks (dry-run) ${summary}`); return 0; }

  fs.mkdirSync(c.previewDir, { recursive: true });
  fs.mkdirSync(c.learningDir, { recursive: true });
  fs.writeFileSync(path.join(c.previewDir, "precedent-picks.json"), JSON.stringify(picks, null, 2) + "\n");
  fs.appendFileSync(path.join(c.learningDir, "precedent-picks.jsonl"), JSON.stringify(picks) + "\n");
  log(`read-slack-picks ${summary}`);
  return 0;
}

// ── 自測 ─────────────────────────────────────────────────────────────────
function fakeFetch(map, calls) {
  return async (url, init) => {
    const u = new URL(url);
    const method = u.pathname.split("/").pop();
    calls.push({ method, auth: (init && init.headers && init.headers.Authorization) || "", params: Object.fromEntries(u.searchParams) });
    const body = map[method];
    if (body === "offline") throw new Error("ENOTFOUND slack.com");
    return { status: 200, json: async () => body };
  };
}

async function selfTest() {
  const cases = [];
  const check = (label, ok) => cases.push([label, !!ok]);
  const TOKEN = ["xox", "b-000000000000-fake-selftest-token"].join(""); // 拆開寫，讓 git grep 掃 token 字首時保持為空
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "slack-picks-"));
  const envFile = path.join(root, "slack.env");
  const sentLog = path.join(root, "sent.jsonl");
  const preview = path.join(root, "preview");
  const learning = path.join(root, "learning");
  const memoryDir = path.join(root, "memory");
  fs.mkdirSync(memoryDir);
  const env = { HOME: root, SLACK_ENV_FILE: envFile, SLACK_API_BASE: "http://127.0.0.1:9/api", SLACK_SENT_LOG: sentLog, AGENT_PREVIEW_DIR: preview, AGENT_LEARNING_DIR: learning };
  const outFile = path.join(preview, "precedent-picks.json");
  const jsonl = path.join(learning, "precedent-picks.jsonl");
  const nothingWritten = () => !fs.existsSync(outFile) && !fs.existsSync(jsonl);
  const capture = () => { const lines = []; return { lines, log: (s) => lines.push(String(s)) }; };

  // 純函式
  check("env 解析：export＋引號＋行尾註解", (() => { const e = parseEnvText('export SLACK_BOT_TOKEN="tok-a"\nSLACK_CHANNEL_ID=C1  # 註解\n# x\n'); return e.SLACK_BOT_TOKEN === "tok-a" && e.SLACK_CHANNEL_ID === "C1"; })());
  check("lastSent 取最後一筆有效行", (() => { const s = lastSent('{"ts":"1.1","channel":"C1"}\nbad\n{"ts":"2.2","channel":"C2","report_date":"2026-09-06"}\n\n'); return s && s.ts === "2.2" && s.channel === "C2" && s.report_date === "2026-09-06"; })());
  check("extractPids：[P-nnn]／P-nnn 去重排序", JSON.stringify(extractPids("收 [P-003] 和 P-001，P-003 再一次；P-12 不算")) === '["P-001","P-003"]');
  check("hasCheck：✅ 含 skin-tone 變體", hasCheck({ ok: true, message: { reactions: [{ name: "white_check_mark::skin-tone-2", count: 1 }] } }) && !hasCheck({ ok: true, message: { reactions: [{ name: "thumbsup", count: 3 }] } }));
  check("pidsFromReplies 跳過原訊息本體", (() => { const r = pidsFromReplies({ ok: true, messages: [{ ts: "1.0", text: "[P-001] 週報" }, { ts: "1.1", user: "U1", text: "[P-002] 👍" }] }, "1.0"); return r.picked.join() === "P-002" && r.reply_count === 1 && r.authors === 1; })());
  check("assertNoToken 擋 token", (() => { try { assertNoToken({ a: TOKEN }, TOKEN); return false; } catch { return true; } })());

  // 1. 缺 slack.env → 跳過、零寫入
  let cap = capture();
  let code = await run({ env, log: cap.log, fetch: fakeFetch({}, []) });
  check("缺 slack.env → exit 0 且不寫檔", code === 0 && nothingWritten() && cap.lines.join().includes("跳過"));

  // 2. 有 env 但缺 token → 跳過
  fs.writeFileSync(envFile, "SLACK_CHANNEL_ID=C123\n");
  cap = capture();
  code = await run({ env, log: cap.log, fetch: fakeFetch({}, []) });
  check("缺 SLACK_BOT_TOKEN → exit 0 且不寫檔", code === 0 && nothingWritten());

  // 3. 有 token 但無 sent log → 跳過
  fs.writeFileSync(envFile, `export SLACK_BOT_TOKEN="${TOKEN}"\nSLACK_CHANNEL_ID=C123\n`);
  cap = capture();
  code = await run({ env, log: cap.log, fetch: fakeFetch({}, []) });
  check("無 sent log → exit 0 且不寫檔", code === 0 && nothingWritten());

  // 4. 離線（fetch 丟錯）→ 不 crash、不寫檔
  fs.writeFileSync(sentLog, '{"ts":"1700000000.000100","channel":"C123","sent_at":"2026-09-06T00:00:00Z","report_date":"2026-09-06"}\n');
  cap = capture();
  code = await run({ env, log: cap.log, fetch: fakeFetch({ "reactions.get": "offline" }, []) });
  check("離線 → exit 0、不 crash、不寫檔", code === 0 && nothingWritten() && cap.lines.join().includes("跳過"));

  // 5. API ok:false → 同樣跳過
  cap = capture();
  code = await run({ env, log: cap.log, fetch: fakeFetch({ "reactions.get": { ok: false, error: "missing_scope" } }, []) });
  check("ok:false → exit 0 不寫檔且不回顯 token", code === 0 && nothingWritten() && !cap.lines.join().includes(TOKEN));

  // 6. 全收：✅ 在本體、無回覆
  let calls = [];
  const root0 = { ts: "1700000000.000100", text: "[P-001] x\n[P-002] y" };
  cap = capture();
  code = await run({ env, log: cap.log, fetch: fakeFetch({
    "reactions.get": { ok: true, message: { reactions: [{ name: "white_check_mark", count: 1, users: ["U1"] }] } },
    "conversations.replies": { ok: true, messages: [root0] },
  }, calls) });
  let out = JSON.parse(fs.readFileSync(outFile, "utf8"));
  check("全收：picked_all=true、picked 空", code === 0 && out.picked_all === true && out.picked.length === 0 && out.report_ts === "1700000000.000100");
  check("Bearer 標頭＋正確 channel/ts 參數", calls.length === 2 && calls.every((x) => x.auth === `Bearer ${TOKEN}`) && calls[0].method === "reactions.get" && calls[0].params.timestamp === "1700000000.000100" && calls[1].params.ts === "1700000000.000100" && calls[1].params.channel === "C123");
  check("jsonl 追加一行", fs.readFileSync(jsonl, "utf8").trim().split("\n").length === 1);

  // 7. 部分收：回覆帶 P-nnn、本體無 ✅（含本體 [P-001] 不得被算進去）
  calls = [];
  cap = capture();
  code = await run({ env, log: cap.log, fetch: fakeFetch({
    "reactions.get": { ok: true, message: { reactions: [{ name: "eyes", count: 1 }] } },
    "conversations.replies": { ok: true, messages: [root0, { ts: "1700000001.1", user: "U1", text: "[P-002] 👍 收" }, { ts: "1700000002.2", user: "U2", text: "P-003 也要，P-002 重複" }] },
  }, calls) });
  out = JSON.parse(fs.readFileSync(outFile, "utf8"));
  check("部分收：picked_all=false、picked=[P-002,P-003]", code === 0 && out.picked_all === false && out.picked.join() === "P-002,P-003" && out.reply_count === 2 && out.reply_authors === 2);
  check("回覆原文與作者 id 不落地", !JSON.stringify(out).includes("U1") && !JSON.stringify(out).includes("也要"));
  check("jsonl 累積為兩行", fs.readFileSync(jsonl, "utf8").trim().split("\n").length === 2);

  // 8. 無反應無回覆 → 零 picks 但仍落地（代表「這週沒人挑」）
  cap = capture();
  code = await run({ env, log: cap.log, fetch: fakeFetch({ "reactions.get": { ok: true, message: {} }, "conversations.replies": { ok: true, messages: [root0] } }, []) });
  out = JSON.parse(fs.readFileSync(outFile, "utf8"));
  check("無反應 → picked_all=false、picked 空", code === 0 && out.picked_all === false && out.picked.length === 0);

  // 9. dry-run 只印不寫
  const before = fs.readFileSync(jsonl, "utf8");
  cap = capture();
  code = await run({ env, log: cap.log, dryRun: true, fetch: fakeFetch({ "reactions.get": { ok: true, message: { reactions: [{ name: "white_check_mark", count: 1 }] } }, "conversations.replies": { ok: true, messages: [root0] } }, []) });
  check("dry-run：印 summary 不追加 jsonl", code === 0 && fs.readFileSync(jsonl, "utf8") === before && cap.lines.join().includes("dry-run"));

  // 10. token 不進任何輸出
  const allText = fs.readFileSync(outFile, "utf8") + fs.readFileSync(jsonl, "utf8");
  check("token 不進 json／jsonl", !allText.includes(TOKEN) && !/xox[abp]-/.test(allText));

  // 11. memory 零改動（自測 root 下的 memory/ 仍為空）
  check("memory/ 零改動", fs.readdirSync(memoryDir).length === 0);

  fs.rmSync(root, { recursive: true, force: true });
  const failed = cases.filter(([, ok]) => !ok);
  for (const [label, ok] of cases) console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
  console.log(`read-slack-picks self-test: ${cases.length - failed.length}/${cases.length}`);
  return failed.length ? 1 : 0;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--self-test")) return selfTest();
  return run({ dryRun: args.has("--dry-run") });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code || 0)).catch((error) => {
    console.error(`read-slack-picks failed: ${String(error && error.message || error).slice(0, 200)}`);
    process.exit(2);
  });
}
