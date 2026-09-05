#!/usr/bin/env node
// Phase 3-E（3-9）：週報彙整。每週日由 run-agents 08f 呼叫，把三份本機資料收成一份
// Slack mrkdwn 週報＋一份對照用 JSON，讓 3-11 之後能把 Slack 回饋（👍／👎）對回判例候選。
//
// 只讀三個來源、只寫兩個檔，全部在 data/agent/.preview/ 底下：
//   1. .preview/precedent-proposals/prec-*.json（近 window 天的判例候選；index.json 不算）
//   2. data/agent/proposals.json（近 window 天狀態變成 evaluated/canary/auto_applied/reverted 的提案）
//   3. data/agent/metrics-history.jsonl（每分類 verified_rate 近 window 晚均值）
//   → .preview/weekly-report.json（schema weekly-report-v0.1）
//   → .preview/weekly-report.md  （Slack mrkdwn；每筆判例獨立一行、行首固定 [P-nnn]）
//
// 紅線⑤：本支只碰判例「預覽」（precedent-proposals），永不讀寫 agents/*/memory/。
// 去敏：每筆判例只留 id／agent／分類／situation 前 120 字／discriminator，
//       不帶任何來源標題、URL、評分原始值；所有字串再過一次 scrub（URL → [url-removed]）。
// 週報兩檔皆在 promote.sh NEVER_FILES 內，永不晉升到 data/agent/。
//
// 用法：node scripts/agent/build-weekly-report.mjs [--window 7] [--root DIR] [--now ISO] [--dry-run] [--self-test]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMetrics } from "./build-search-review-input.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..", "..");

export const SCHEMA = "weekly-report-v0.1";
export const DEFAULT_WINDOW_DAYS = 7;
export const SITUATION_MAX = 120;
export const DIFF_MAX = 160;
export const CHANGE_STATUSES = ["evaluated", "canary", "auto_applied", "reverted"];
// 每種狀態對應的「狀態變動時間」欄位（docs/shapes/data-agent-json.md Phase 3 欄位）
const STATUS_TS = { evaluated: "evaluated_at", canary: "canary_started_at", auto_applied: "confirmed_at", reverted: "reverted_at" };

const PREVIEW_REL = "data/agent/.preview";
const OUT_JSON = "weekly-report.json";
const OUT_MD = "weekly-report.md";

// ── 去敏 ──────────────────────────────────────────────────────────────────────
const URL_RE = /https?:\/\/[^\s)\]>"']+/gi;
export function scrub(s, max = Infinity) {
  if (s == null) return null;
  let t = String(s).replace(/\s+/g, " ").trim().replace(URL_RE, "[url-removed]");
  if (t.length > max) t = t.slice(0, max).trimEnd() + "…";
  return t;
}
export function assertNoLeak(obj) {
  const text = JSON.stringify(obj);
  if (/https?:\/\//i.test(text)) throw new Error("週報含 URL，拒絕輸出");
  for (const k of ["title", "url", "link", "source_title", "score", "rating"]) {
    if (new RegExp(`"${k}"\\s*:`).test(text)) throw new Error(`週報含禁用欄位 ${k}，拒絕輸出`);
  }
}

// ── 讀取 ──────────────────────────────────────────────────────────────────────
function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}
function dayStr(d) { return d.toISOString().slice(0, 10); }
function tsOf(x) { const t = Date.parse(x || ""); return Number.isFinite(t) ? t : NaN; }

export function loadPrecedents(root, sinceMs, untilMs) {
  const dir = path.join(root, PREVIEW_REL, "precedent-proposals");
  if (!fs.existsSync(dir)) return { count_scanned: 0, items: [] };
  const files = fs.readdirSync(dir).filter((f) => /^prec-.*\.json$/.test(f)).sort();
  const items = [];
  for (const f of files) {
    const p = readJson(path.join(dir, f));
    if (!p || typeof p !== "object") continue;
    // created_at 是 YYYY-MM-DD；缺或壞掉一律排除（寧可少報）
    const t = tsOf(p.created_at);
    if (!Number.isFinite(t) || t < sinceMs || t > untilMs) continue;
    const cand = p.candidate_precedent && typeof p.candidate_precedent === "object" ? p.candidate_precedent : {};
    items.push({
      proposal_id: String(p.proposal_id || f.replace(/\.json$/, "")),
      created_at: p.created_at,
      agent: p.agent ? String(p.agent) : null,
      category: p.category ? String(p.category) : null,
      status: p.status ? String(p.status) : null,
      situation: scrub(cand.situation, SITUATION_MAX),
      discriminator: scrub(cand.discriminator, SITUATION_MAX),
    });
  }
  items.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.proposal_id.localeCompare(b.proposal_id));
  return { count_scanned: files.length, items };
}

export function loadProposalChanges(root, sinceMs, untilMs) {
  const p = readJson(path.join(root, "data/agent/proposals.json"));
  const list = p && Array.isArray(p.proposals) ? p.proposals : [];
  const counts = Object.fromEntries(CHANGE_STATUSES.map((s) => [s, 0]));
  const items = [];
  for (const x of list) {
    if (!x || !CHANGE_STATUSES.includes(x.status)) continue;
    const t = tsOf(x[STATUS_TS[x.status]] || x.created_at);
    if (!Number.isFinite(t) || t < sinceMs || t > untilMs) continue;
    counts[x.status] += 1;
    items.push({
      proposal_id: String(x.proposal_id || ""),
      status: x.status,
      category: x.category ? String(x.category) : null,
      changed_at: new Date(t).toISOString(),
      diff_summary: scrub(x.diff_summary, DIFF_MAX),
    });
  }
  items.sort((a, b) => a.changed_at.localeCompare(b.changed_at));
  return { counts, items };
}

export function loadMetricsSummary(root, window) {
  const m = loadMetrics(path.join(root, "data/agent/metrics-history.jsonl"), window);
  const byCat = {};
  for (const cat of Object.keys(m.by_category).sort()) {
    const rows = m.by_category[cat].filter((r) => typeof r.verified_rate === "number");
    if (!rows.length) continue;
    const mean = rows.reduce((a, r) => a + r.verified_rate, 0) / rows.length;
    byCat[cat] = { verified_rate_mean: Math.round(mean * 1000) / 1000, nights: rows.length };
  }
  return { available: m.available, nights: m.dates.length, by_category: byCat };
}

// ── 組報 ──────────────────────────────────────────────────────────────────────
export function build(root, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const window = Number.isFinite(opts.window) && opts.window > 0 ? Math.floor(opts.window) : DEFAULT_WINDOW_DAYS;
  const untilMs = now.getTime();
  const sinceMs = untilMs - window * 86400000;
  const reportDate = dayStr(now);

  const prec = loadPrecedents(root, sinceMs, untilMs);
  const precedents = prec.items.map((it, i) => ({ pid: `P-${String(i + 1).padStart(3, "0")}`, ...it }));
  const changes = loadProposalChanges(root, sinceMs, untilMs);
  const metrics = loadMetricsSummary(root, window);

  const json = {
    schema: SCHEMA,
    generated_at: now.toISOString(),
    report_date: reportDate,
    window_days: window,
    window_from: dayStr(new Date(sinceMs)),
    sources: { precedent_files_scanned: prec.count_scanned, precedent_dir: `${PREVIEW_REL}/precedent-proposals/` },
    precedent_count: precedents.length,
    precedents,
    pid_map: Object.fromEntries(precedents.map((p) => [p.pid, p.proposal_id])),
    proposal_changes: changes,
    metrics,
    note: "只含判例 id／情境摘要／分類／數量與 canary 狀態；無標題、URL、評分原始值。回饋請回覆 [P-nnn] 👍／👎。",
  };
  assertNoLeak(json);
  return { json, md: renderMd(json) };
}

export function renderMd(j) {
  const L = [];
  L.push(`*AI News Hub 週報 ${j.report_date}（${j.window_from} ～ ${j.report_date}，近 ${j.window_days} 天）*`);
  L.push("");
  L.push(`*判例候選（${j.precedent_count}）* — 回覆 \`[P-nnn]\` 👍 採用／👎 略過`);
  if (!j.precedents.length) L.push("（本週無判例候選）");
  for (const p of j.precedents) {
    const head = [p.agent, p.category].filter(Boolean).join(" · ") || "—";
    const disc = p.discriminator ? `｜判別：${p.discriminator}` : "";
    L.push(`[${p.pid}] ${head} — ${p.situation || "（情境待填）"}${disc}`);
  }
  L.push("");
  const c = j.proposal_changes.counts;
  L.push(`*提案狀態變動*  evaluated ${c.evaluated}｜canary ${c.canary}｜auto_applied ${c.auto_applied}｜reverted ${c.reverted}`);
  for (const x of j.proposal_changes.items) {
    L.push(`• ${x.proposal_id} → ${x.status}${x.category ? `（${x.category}）` : ""}${x.diff_summary ? `：${x.diff_summary}` : ""}`);
  }
  L.push("");
  L.push(`*分類 verified_rate 均值（${j.metrics.nights} 晚）*`);
  const cats = Object.keys(j.metrics.by_category);
  if (!cats.length) L.push("（無指標資料）");
  for (const cat of cats) {
    const m = j.metrics.by_category[cat];
    L.push(`• ${cat} ${m.verified_rate_mean.toFixed(3)}（${m.nights} 晚）`);
  }
  return L.join("\n") + "\n";
}

export function run(root, opts = {}) {
  const log = opts.log || ((s) => console.log(s));
  const { json, md } = build(root, opts);
  if (/https?:\/\//i.test(md)) throw new Error("週報 md 含 URL，拒絕輸出");
  const outDir = path.join(root, PREVIEW_REL);
  const outJson = path.join(outDir, OUT_JSON);
  const outMd = path.join(outDir, OUT_MD);
  if (opts.dryRun) {
    log(`[dry-run] 週報 ${json.report_date}：判例 ${json.precedent_count}、狀態變動 ${json.proposal_changes.items.length}、分類 ${Object.keys(json.metrics.by_category).length}（不寫檔）`);
    return { json, md, written: [] };
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outJson, JSON.stringify(json, null, 2) + "\n", "utf8");
  fs.writeFileSync(outMd, md, "utf8");
  log(`週報 ${json.report_date}：判例 ${json.precedent_count}、狀態變動 ${json.proposal_changes.items.length}、分類 ${Object.keys(json.metrics.by_category).length} → ${path.relative(root, outJson)}、${path.relative(root, outMd)}`);
  return { json, md, written: [outJson, outMd] };
}

// ── 自測 W-1..W-10 ────────────────────────────────────────────────────────────
function selfTest() {
  let fails = 0;
  const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) fails += 1; };
  const NOW = new Date("2026-09-06T10:00:00.000Z");
  const w = (root, rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text, "utf8"); };
  const r = (root, rel) => fs.readFileSync(path.join(root, rel), "utf8");
  const quiet = { now: NOW, log: () => {} };
  const TITLE = "OpenAI releases GPT-9 with 10x context";
  const LONG = "甲".repeat(200);

  const prec = (id, date, extra = {}) => JSON.stringify({
    schema: "precedent-proposal-v1", proposal_id: id, created_at: date, agent: "brief-writer", status: "pending_review",
    candidate_precedent: { id, date, situation: `情境 ${id}`, call: "call", discriminator: `判別 ${id}`, rubric: "r" }, ...extra,
  });
  const setup = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "weekly-report-"));
    const pd = "data/agent/.preview/precedent-proposals";
    w(root, `${pd}/index.json`, JSON.stringify({ schema: "precedent-proposals-index-v1", proposal_count: 3 }));
    w(root, `${pd}/prec-brief-writer-aaa.json`, prec("prec-brief-writer-aaa", "2026-09-04"));
    w(root, `${pd}/prec-trend-bbb.json`, prec("prec-trend-bbb", "2026-09-02", {
      agent: "trend-assessor", category: "usa",
      candidate_precedent: { id: "x", date: "2026-09-02", situation: `${LONG} 看 https://example.com/a?b=1 這篇`, call: "c", discriminator: "判別 bbb", rubric: "r" },
      title: TITLE, source_url: "https://example.com/news",
    }));
    w(root, `${pd}/prec-old-ccc.json`, prec("prec-old-ccc", "2026-08-20"));
    w(root, `${pd}/prec-broken.json`, "{not json");
    w(root, "data/agent/proposals.json", JSON.stringify({ proposals: [
      { proposal_id: "SP-001", status: "canary", category: "usa", canary_started_at: "2026-09-03T18:30:00Z", diff_summary: "加一條查詢 https://slack.com/x" },
      { proposal_id: "SP-002", status: "auto_applied", category: "china", confirmed_at: "2026-09-05T18:30:00Z", diff_summary: "x" },
      { proposal_id: "SP-003", status: "reverted", category: "usa", reverted_at: "2026-08-25T18:30:00Z", diff_summary: "old" },
      { proposal_id: "SP-004", status: "pending_review", created_at: "2026-09-05T18:30:00Z" },
      { proposal_id: "SP-005", status: "evaluated", evaluated_at: "2026-09-01T18:30:00Z" },
    ] }));
    const rows = [];
    for (const [i, d] of ["2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"].entries()) {
      rows.push(JSON.stringify({ schema: "category-metrics-v0.1", date: d, cat: "usa", items: 10, verified_rate: 0.5 + i * 0.05 }));
      if (i >= 6) rows.push(JSON.stringify({ schema: "category-metrics-v0.1", date: d, cat: "china", items: 5, verified_rate: 1 }));
    }
    w(root, "data/agent/metrics-history.jsonl", rows.join("\n") + "\n");
    return root;
  };

  { // W-1 三個來源全缺 → 不 crash，仍寫出兩個空報
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "weekly-report-"));
    let ok = true; let res;
    try { res = run(root, quiet); } catch { ok = false; }
    check("W-1 來源全缺不 crash，仍寫出 weekly-report.json/.md", ok && fs.existsSync(path.join(root, "data/agent/.preview/weekly-report.json")) && res.json.precedent_count === 0 && res.md.includes("本週無判例候選"));
    fs.rmSync(root, { recursive: true, force: true });
  }
  {
    const root = setup();
    const res = run(root, quiet);
    const j = JSON.parse(r(root, "data/agent/.preview/weekly-report.json"));
    const md = r(root, "data/agent/.preview/weekly-report.md");
    const ids = j.precedents.map((p) => p.proposal_id);
    check("W-2 7 天窗：8/20 判例排除、9/2 與 9/4 納入；index.json 與壞檔略過", ids.length === 2 && ids.includes("prec-trend-bbb") && ids.includes("prec-brief-writer-aaa") && !ids.includes("prec-old-ccc"));
    const precLines = md.split("\n").filter((l) => /^\[P-\d{3}\] /.test(l));
    check("W-3 每筆判例獨立一行、行首 [P-nnn]，pid_map 對回 proposal_id", precLines.length === 2 && j.pid_map["P-001"] === "prec-trend-bbb" && j.pid_map["P-002"] === "prec-brief-writer-aaa" && j.precedents[0].pid === "P-001");
    const all = JSON.stringify(j) + md;
    check("W-4 輸出零 URL、零標題、零 title/url 欄位", !/https?:\/\//i.test(all) && !all.includes(TITLE) && !/"title"|"source_url"/.test(JSON.stringify(j)) && all.includes("[url-removed]"));
    const s = j.precedents[0].situation;
    check("W-5 situation 截到 120 字（含省略號）", s.length <= SITUATION_MAX + 1 && s.endsWith("…"));
    const c = j.proposal_changes.counts;
    check("W-6 狀態變動只算 7 天內四種狀態：evaluated 1／canary 1／auto_applied 1／reverted 0，pending 不算", c.evaluated === 1 && c.canary === 1 && c.auto_applied === 1 && c.reverted === 0 && j.proposal_changes.items.length === 3 && !JSON.stringify(j.proposal_changes).includes("SP-004"));
    check("W-6b diff_summary 內 URL 已去除", j.proposal_changes.items.find((x) => x.proposal_id === "SP-001").diff_summary === "加一條查詢 [url-removed]");
    const m = j.metrics.by_category;
    // usa 取最後 7 晚：0.55..0.85 均值 0.7；china 2 晚均 1
    check("W-7 metrics 7 晚均值：usa 0.7（7 晚）、china 1（2 晚）", m.usa && m.usa.verified_rate_mean === 0.7 && m.usa.nights === 7 && m.china && m.china.verified_rate_mean === 1 && m.china.nights === 2 && j.metrics.nights === 7);
    check("W-8 md 含三個區段標題與分類行", md.includes("*判例候選（2）*") && md.includes("*提案狀態變動*") && md.includes("• usa 0.700（7 晚）") && md.includes("SP-002 → auto_applied（china）"));
    check("W-9 只寫 .preview/ 底下兩個固定檔名", res.written.length === 2 && res.written.every((p) => p.startsWith(path.join(root, "data/agent/.preview") + path.sep)) && res.written.map((p) => path.basename(p)).join(",") === "weekly-report.json,weekly-report.md");
    const root2 = setup();
    const res2 = run(root2, { ...quiet, dryRun: true });
    check("W-10 dry-run 不寫檔但仍組出報告", res2.written.length === 0 && !fs.existsSync(path.join(root2, "data/agent/.preview/weekly-report.md")) && res2.json.precedent_count === 2);
    const res3 = run(setup(), { ...quiet, window: 3 });
    check("W-11 --window 3 只剩 9/4 判例", res3.json.precedent_count === 1 && res3.json.precedents[0].proposal_id === "prec-brief-writer-aaa" && res3.json.window_days === 3);
    for (const x of [root, root2]) fs.rmSync(x, { recursive: true, force: true });
  }
  console.log(fails ? `\n${fails} 項失敗` : "\nbuild-weekly-report 自測全綠");
  process.exit(fails ? 1 : 0);
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const valueOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  if (flags.has("--self-test")) selfTest();
  else {
    const root = valueOf("--root") ? path.resolve(valueOf("--root")) : REPO_ROOT;
    const window = valueOf("--window") ? Number(valueOf("--window")) : DEFAULT_WINDOW_DAYS;
    const now = valueOf("--now") ? new Date(valueOf("--now")) : new Date();
    try {
      run(root, { dryRun: flags.has("--dry-run"), window, now });
    } catch (e) {
      console.error(`build-weekly-report 失敗：${e && e.message ? e.message : e}`);
      process.exit(1);
    }
  }
}
