#!/usr/bin/env node
// Phase 2-2：每晚把 data/latest.json 壓成「每分類一行聚合數字」，append 到
// data/agent/metrics-history.jsonl。這是 Phase 3 change-evaluator 的量尺：
// canary 前後比的是這裡的 verified_rate / priority_hit_rate / human_rating_score。
//
// 紅線（raw_feedback_off_repo）：這個檔會進 git、repo 公開，所以只放數字與分類 id，
// 不放任何標題、URL、來源網域。self-test 會以 key 白名單硬擋。
//
// 缺 key 容忍：models 用 model_name/release_date；tutorials/courses 可能沒 verified /
// url_status；is_backfill 可能不存在。任何分類缺欄位只會算成 0，不會 crash。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const valueOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

export const SCHEMA = "category-metrics-v0.1";
export const CATEGORIES = ["papers", "topnews", "taiwan", "china", "usa", "techtrends", "governance", "tutorials", "courses", "models"];
// 唯一允許出現在 jsonl 每行的 key。多一個就是洩漏風險，self-test 會擋。
export const ALLOWED_KEYS = [
  "schema", "date", "generated_at", "cat", "items", "verified", "verified_rate",
  "needs_review", "title_low_match", "backfill", "priority_hits", "priority_hit_rate",
  "human_rating_score", "human_rating_count", "validation_pass_rate",
];

// ── PRIORITY_KEYWORDS：直接從 config.js 解析，跟 render.js buildPriorityRegex 同一套規則 ──
export function loadPriorityKeywords(configJs) {
  const m = configJs.match(/const PRIORITY_KEYWORDS\s*=\s*(\{[\s\S]*?\n\});/);
  if (!m) return { latin: [], cjk: [], cjkPatterns: [] };
  const pick = (name) => {
    const r = new RegExp(`${name}\\s*:\\s*\\[([\\s\\S]*?)\\]`).exec(m[1]);
    if (!r) return [];
    return [...r[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1].replace(/\\'/g, "'"));
  };
  return { latin: pick("latin"), cjk: pick("cjk"), cjkPatterns: pick("cjkPatterns") };
}

export function buildPriorityRegex(k) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");
  const latin = (k.latin || []).map((w) => esc(w).replace(/ /g, "[\\s._-]"));
  const cjk = (k.cjk || []).map(esc).concat(k.cjkPatterns || []);
  if (!latin.length && !cjk.length) return /$^/;
  const parts = [];
  if (latin.length) parts.push("\\b(" + latin.join("|") + ")\\b");
  if (cjk.length) parts.push(cjk.join("|"));
  return new RegExp(parts.join("|"), "i");
}

function hasPriority(item, re) {
  const txt = [item.title, item.summary, item.model_name, item.field, item.domain,
    ...(Array.isArray(item.highlights) ? item.highlights : []),
    ...(Array.isArray(item.advantages) ? item.advantages : [])]
    .filter((v) => typeof v === "string" && v).join(" ");
  return re.test(txt);
}

// human_ratings.by_category 可能是 {} / [] / 缺；元素 {id, score, feedback_count}
export function ratingFor(humanRatings, cat) {
  const bc = humanRatings && humanRatings.by_category;
  let rows = [];
  if (Array.isArray(bc)) rows = bc;
  else if (bc && typeof bc === "object") rows = Object.entries(bc).map(([id, v]) => ({ id, ...(v || {}) }));
  const hit = rows.find((r) => r && r.id === cat);
  if (!hit) return { score: null, count: 0 };
  const score = Number(hit.score);
  const count = Number(hit.feedback_count);
  return { score: Number.isFinite(score) ? score : null, count: Number.isFinite(count) ? count : 0 };
}

function round(v) { return Math.round(v * 1000) / 1000; }

export function computeRows(latest, priorityRe, humanRatings, generatedAt) {
  const date = String(latest && latest.date || generatedAt.slice(0, 10));
  const data = (latest && latest.data && typeof latest.data === "object") ? latest.data : {};
  const passRaw = latest && latest.validation ? latest.validation.pass_rate : null;
  const pass = Number(String(passRaw ?? "").replace("%", ""));
  const validationPassRate = Number.isFinite(pass) ? pass : null;
  const rows = [];
  for (const cat of CATEGORIES) {
    let items = data[cat];
    if (items && !Array.isArray(items) && Array.isArray(items.items)) items = items.items;
    if (!Array.isArray(items)) items = [];
    const list = items.filter((x) => x && typeof x === "object");
    let verified = 0, needsReview = 0, lowMatch = 0, backfill = 0, prio = 0;
    for (const it of list) {
      if (it.verified === true || it.url_status === "verified") verified++;
      if (it.url_status === "needs_review") needsReview++;
      if (it.url_status === "title_low_match") lowMatch++;
      if (it.is_backfill === true) backfill++;
      if (hasPriority(it, priorityRe)) prio++;
    }
    const n = list.length;
    const r = ratingFor(humanRatings, cat);
    rows.push({
      schema: SCHEMA, date, generated_at: generatedAt, cat,
      items: n, verified, verified_rate: n ? round(verified / n) : 0,
      needs_review: needsReview, title_low_match: lowMatch, backfill,
      priority_hits: prio, priority_hit_rate: n ? round(prio / n) : 0,
      human_rating_score: r.score, human_rating_count: r.count,
      validation_pass_rate: validationPassRate,
    });
  }
  return rows;
}

export function assertSanitized(row) {
  for (const k of Object.keys(row)) {
    if (!ALLOWED_KEYS.includes(k)) throw new Error(`metrics row has non-allowlisted key: ${k}`);
    const v = row[k];
    if (typeof v === "string" && /https?:\/\//i.test(v)) throw new Error(`metrics row ${k} looks like a URL`);
  }
}

// 冪等：同一 date 的舊行全部剔除再 append；其他日期原樣保留。
export function writeIdempotent(outPath, rows) {
  let kept = [];
  if (fs.existsSync(outPath)) {
    const dates = new Set(rows.map((r) => r.date));
    kept = fs.readFileSync(outPath, "utf8").split("\n").filter(Boolean).filter((line) => {
      try { return !dates.has(JSON.parse(line).date); } catch { return false; }
    });
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const body = kept.concat(rows.map((r) => JSON.stringify(r))).join("\n") + "\n";
  fs.writeFileSync(outPath, body, "utf8");
  return kept.length + rows.length;
}

function readJsonIfExists(p) {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null; } catch { return null; }
}

function loadHumanRatings(root) {
  for (const rel of ["data/agent/.preview/learning-status.json", "data/agent/learning-status.json"]) {
    const j = readJsonIfExists(path.join(root, rel));
    const hr = j && j.learning_summary && j.learning_summary.human_ratings;
    if (hr && typeof hr === "object") return hr;
  }
  return null;
}

function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cat-metrics-"));
  const fails = [];
  const check = (label, ok) => { if (!ok) fails.push(label); };
  try {
    const re = buildPriorityRegex({ latin: ["ai agent", "gpt"], cjk: ["資安"], cjkPatterns: ["Agent.*評"] });
    check("T-1 latin phrase w/ separator", re.test("An AI-Agent shipped"));
    check("T-2 cjk", re.test("金融資安事件"));
    check("T-3 cjk pattern", re.test("Agent 全面評測"));
    check("T-4 word boundary", !re.test("egptx"));

    const latest = {
      date: "2026-09-03",
      validation: { pass_rate: 95.9 },
      data: {
        topnews: [
          { title: "OpenAI ships GPT agent", url: "https://x/y", verified: true, url_status: "verified", is_backfill: true },
          { title: "plain", url_status: "needs_review" },
          { title: "low", url_status: "title_low_match" },
          null, "garbage",
        ],
        models: [{ model_name: "Qwen-9 gpt killer", release_date: "2026-08-01", advantages: ["ai agent ready"] }],
        tutorials: { items: [{ title: "no verified key at all" }] },
        courses: [],
        papers: "not-a-list",
      },
    };
    const hr = { by_category: [{ id: "topnews", good: 2, mid: 0, bad: 1, score: 0.333, feedback_count: 3 }] };
    const rows = computeRows(latest, re, hr, "2026-09-03T18:40:00+08:00");
    check("T-5 ten categories", rows.length === 10);
    const tn = rows.find((r) => r.cat === "topnews");
    check("T-6 topnews counts", tn.items === 3 && tn.verified === 1 && tn.needs_review === 1 && tn.title_low_match === 1 && tn.backfill === 1 && tn.priority_hits === 1);
    check("T-7 topnews rates", tn.verified_rate === 0.333 && tn.priority_hit_rate === 0.333 && tn.validation_pass_rate === 95.9);
    check("T-8 topnews rating", tn.human_rating_score === 0.333 && tn.human_rating_count === 3);
    const md = rows.find((r) => r.cat === "models");
    check("T-9 models shape tolerated", md.items === 1 && md.verified === 0 && md.priority_hits === 1);
    const tu = rows.find((r) => r.cat === "tutorials");
    check("T-10 wrapped items tolerated", tu.items === 1 && tu.verified_rate === 0);
    const pp = rows.find((r) => r.cat === "papers");
    check("T-11 non-list tolerated", pp.items === 0 && pp.human_rating_score === null);
    check("T-12 by_category as object", ratingFor({ by_category: { usa: { score: -0.5, feedback_count: 2 } } }, "usa").score === -0.5);
    check("T-13 by_category missing", ratingFor(null, "usa").count === 0);
    let sanitizedOk = true;
    try { rows.forEach(assertSanitized); } catch { sanitizedOk = false; }
    check("T-14 rows sanitized (no title/url keys)", sanitizedOk);
    let leakCaught = false;
    try { assertSanitized({ ...tn, title: "leak" }); } catch { leakCaught = true; }
    check("T-15 leak key rejected", leakCaught);

    const out = path.join(tmp, "metrics-history.jsonl");
    fs.writeFileSync(out, JSON.stringify({ schema: SCHEMA, date: "2026-09-02", cat: "usa" }) + "\nnot json\n");
    writeIdempotent(out, rows);
    writeIdempotent(out, rows);
    const lines = fs.readFileSync(out, "utf8").split("\n").filter(Boolean);
    check("T-16 idempotent by date", lines.length === 11);
    check("T-17 other dates kept, junk dropped", lines.filter((l) => JSON.parse(l).date === "2026-09-02").length === 1);

    const cfg = fs.readFileSync(path.join(ROOT, "assets/js/config.js"), "utf8");
    const kw = loadPriorityKeywords(cfg);
    check("T-18 config.js PRIORITY_KEYWORDS parsed", kw.latin.length >= 40 && kw.cjk.length >= 20 && kw.cjkPatterns.length >= 2);
    check("T-19 real regex matches agentic", buildPriorityRegex(kw).test("agentic workflow"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (fails.length) {
    console.error("build-category-metrics self-test FAILED: " + fails.join("; "));
    return 1;
  }
  console.log("build-category-metrics self-test passed (T-1..T-19)");
  return 0;
}

function main() {
  if (flags.has("--self-test")) return selfTest();
  const inputPath = path.resolve(ROOT, valueOf("--input", "data/latest.json"));
  const outPath = path.resolve(ROOT, valueOf("--out", "data/agent/metrics-history.jsonl"));
  const latest = readJsonIfExists(inputPath);
  if (!latest) {
    console.error(`build-category-metrics: cannot read ${inputPath}`);
    return 2;
  }
  const cfgPath = path.join(ROOT, "assets/js/config.js");
  const kw = fs.existsSync(cfgPath) ? loadPriorityKeywords(fs.readFileSync(cfgPath, "utf8")) : { latin: [], cjk: [], cjkPatterns: [] };
  const re = buildPriorityRegex(kw);
  const generatedAt = new Date().toISOString();
  const rows = computeRows(latest, re, loadHumanRatings(ROOT), generatedAt);
  rows.forEach(assertSanitized);
  if (flags.has("--dry-run")) {
    console.log(JSON.stringify({ schema: SCHEMA, out: path.relative(ROOT, outPath), rows }, null, 2));
    return 0;
  }
  const total = writeIdempotent(outPath, rows);
  console.log(`build-category-metrics: ${rows.length} rows for ${rows[0].date} → ${path.relative(ROOT, outPath)} (${total} lines total)`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
