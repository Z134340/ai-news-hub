#!/usr/bin/env node
// Phase 2-5：組出 search-reviewer 的輸入 .preview/search-review-input.json。
// 內容：近 N 晚每分類聚合指標（metrics-history.jsonl）、每支 prompt 的
// SEARCH_QUERIES / PRIORITY marker 區段全文、PRIORITY_KEYWORDS 三個陣列、
// human_ratings 聚合（只到分類與 hostname 層）、canaries.json 唯讀快照、待審提案數。
//
// 這個檔含 prompt 區段全文，等於把搜尋策略攤開，所以列入 promote.sh NEVER_FILES，
// 永不晉升到 data/agent/。沒有任何標題／URL 進來：metrics 行本來就沒有，
// human_ratings 只取 by_source_domain 的 hostname 與分數。
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

export const SCHEMA = "search-review-input-v0.1";
export const PROMPT_CATS = ["papers", "topnews", "taiwan", "china", "usa", "techtrends", "governance", "tutorials", "courses", "models"];
const MARKERS = ["SEARCH_QUERIES", "PRIORITY"];

function readJsonIfExists(p) {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null; } catch { return null; }
}

export function extractMarker(md, name) {
  const re = new RegExp(`<!--\\s*${name}:BEGIN\\s*-->([\\s\\S]*?)<!--\\s*${name}:END\\s*-->`);
  const m = re.exec(md || "");
  return m ? m[1].trim() : null;
}

export function loadPromptRegions(root) {
  const out = {};
  for (const cat of PROMPT_CATS) {
    const p = path.join(root, "scripts/prompts", `${cat}.md`);
    if (!fs.existsSync(p)) { out[cat] = { present: false }; continue; }
    const md = fs.readFileSync(p, "utf8");
    const entry = { present: true, target_file: `scripts/prompts/${cat}.md` };
    for (const mk of MARKERS) {
      const txt = extractMarker(md, mk);
      entry[mk.toLowerCase()] = txt;
      entry[`${mk.toLowerCase()}_lines`] = txt ? txt.split("\n").length : 0;
    }
    out[cat] = entry;
  }
  return out;
}

export function loadPriorityKeywords(configJs) {
  const m = (configJs || "").match(/const PRIORITY_KEYWORDS\s*=\s*(\{[\s\S]*?\n\});/);
  if (!m) return { latin: [], cjk: [], cjkPatterns: [] };
  const pick = (name) => {
    const r = new RegExp(`${name}\\s*:\\s*\\[([\\s\\S]*?)\\]`).exec(m[1]);
    if (!r) return [];
    return [...r[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1].replace(/\\'/g, "'"));
  };
  return { latin: pick("latin"), cjk: pick("cjk"), cjkPatterns: pick("cjkPatterns") };
}

// 只留最近 window 個不同日期的行，並按分類聚成 series。
export function loadMetrics(metricsPath, window) {
  if (!fs.existsSync(metricsPath)) return { available: false, dates: [], by_category: {} };
  const rows = fs.readFileSync(metricsPath, "utf8").split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter((r) => r && typeof r.date === "string" && typeof r.cat === "string");
  const dates = [...new Set(rows.map((r) => r.date))].sort().slice(-window);
  const keep = new Set(dates);
  const byCat = {};
  for (const r of rows) {
    if (!keep.has(r.date)) continue;
    const list = (byCat[r.cat] ||= []);
    // 同 date 多行時取最後一行（append 語意）
    const idx = list.findIndex((x) => x.date === r.date);
    const slim = {
      date: r.date, items: r.items ?? 0, verified_rate: r.verified_rate ?? 0,
      needs_review: r.needs_review ?? 0, title_low_match: r.title_low_match ?? 0,
      backfill: r.backfill ?? 0, priority_hit_rate: r.priority_hit_rate ?? 0,
      human_rating_score: r.human_rating_score ?? null, human_rating_count: r.human_rating_count ?? 0,
      validation_pass_rate: r.validation_pass_rate ?? null,
    };
    if (idx >= 0) list[idx] = slim; else list.push(slim);
  }
  for (const cat of Object.keys(byCat)) byCat[cat].sort((a, b) => a.date.localeCompare(b.date));
  return { available: true, dates, by_category: byCat };
}

function hostnameOnly(v) {
  const s = String(v || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "");
  return /^[a-z0-9.-]+$/.test(s) ? s : null;
}

export function loadHumanRatings(root) {
  let hr = null;
  for (const rel of ["data/agent/.preview/learning-status.json", "data/agent/learning-status.json"]) {
    const j = readJsonIfExists(path.join(root, rel));
    const cand = j && j.learning_summary && j.learning_summary.human_ratings;
    if (cand && typeof cand === "object") { hr = cand; break; }
  }
  if (!hr) return { available: false, items_rated: 0, by_category: [], by_source_domain: [] };
  const norm = (v) => {
    let rows = [];
    if (Array.isArray(v)) rows = v;
    else if (v && typeof v === "object") rows = Object.entries(v).map(([id, x]) => ({ id, ...(x || {}) }));
    return rows.filter((r) => r && r.id).map((r) => ({
      id: String(r.id), good: Number(r.good) || 0, mid: Number(r.mid) || 0, bad: Number(r.bad) || 0,
      score: Number.isFinite(Number(r.score)) ? Number(r.score) : null, feedback_count: Number(r.feedback_count) || 0,
    }));
  };
  const domains = norm(hr.by_source_domain).map((r) => ({ ...r, id: hostnameOnly(r.id) })).filter((r) => r.id);
  return {
    available: true, half_life_days: hr.half_life_days ?? 30, items_rated: Number(hr.items_rated) || 0,
    by_category: norm(hr.by_category), by_source_domain: domains,
  };
}

export function loadCanaries(root) {
  const c = readJsonIfExists(path.join(root, "agents/_control/canaries.json"));
  if (!c) return { present: false };
  return {
    present: true, read_only: true,
    weekly_cap: c.weekly_cap ?? null, per_category_cap: c.per_category_cap ?? null,
    canary_nights: c.canary_nights ?? null, revert_drop_pp: c.revert_drop_pp ?? null,
    auto_opt_enabled: !!(c.auto_opt && c.auto_opt.enabled),
  };
}

export function countPendingProposals(root) {
  const idx = readJsonIfExists(path.join(root, "data/agent/proposals.json"));
  const list = idx && Array.isArray(idx.proposals) ? idx.proposals : [];
  const byStatus = {};
  for (const p of list) byStatus[p && p.status || "unknown"] = (byStatus[p && p.status || "unknown"] || 0) + 1;
  return { total: list.length, by_status: byStatus, pending_review: byStatus.pending_review || 0 };
}

export function assertNoLeak(obj) {
  const walk = (v, trail) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${trail}[${i}]`));
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (["title", "url", "summary", "headline"].includes(k)) throw new Error(`leak key ${k} at ${trail}`);
        walk(x, `${trail}.${k}`);
      }
      return;
    }
    // prompt 區段裡的網域範例（如 arxiv.org）合法；只擋完整 URL 出現在非 prompt 欄位。
    if (typeof v === "string" && /https?:\/\//i.test(v) && !trail.startsWith("$.prompt_regions")) {
      throw new Error(`URL-like string at ${trail}`);
    }
  };
  walk(obj, "$");
}

export function build(root, opts) {
  const cfgPath = path.join(root, "assets/js/config.js");
  const doc = {
    schema: SCHEMA,
    generated_at: new Date().toISOString(),
    window_days: opts.window,
    source_latest_date: (readJsonIfExists(path.join(root, "data/latest.json")) || {}).date || null,
    metrics: loadMetrics(opts.metrics, opts.window),
    prompt_regions: loadPromptRegions(root),
    priority_keywords: fs.existsSync(cfgPath) ? loadPriorityKeywords(fs.readFileSync(cfgPath, "utf8")) : { latin: [], cjk: [], cjkPatterns: [] },
    human_ratings: loadHumanRatings(root),
    canaries: loadCanaries(root),
    proposals: countPendingProposals(root),
    allowlist_targets: ["scripts/prompts/<cat>.md", "assets/js/config.js", "scripts/tier-b-domains.json"],
    boundary: {
      advisory_only: true, production_write: false, publish: "manual_only",
      proposals_must_be: "pending_review", never_promote_this_file: true,
    },
  };
  assertNoLeak(doc);
  return doc;
}

function selfTest() {
  const fails = [];
  const check = (l, ok) => { if (!ok) fails.push(l); };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sri-"));
  try {
    const md = "# x\n<!-- SEARCH_QUERIES:BEGIN -->\n- q1\n- q2\n<!-- SEARCH_QUERIES:END -->\n<!-- PRIORITY:BEGIN -->\np\n<!-- PRIORITY:END -->\n";
    check("T-1 marker extract", extractMarker(md, "SEARCH_QUERIES") === "- q1\n- q2");
    check("T-2 marker missing → null", extractMarker("no markers", "PRIORITY") === null);
    const regions = loadPromptRegions(ROOT);
    // null = marker 缺席；空字串 = 區段存在但為空（techtrends/governance/tutorials/courses 的 PRIORITY 目前是空的），兩者要分開。
    check("T-3 ten prompt files with both markers", PROMPT_CATS.every((c) => regions[c].present && regions[c].search_queries != null && regions[c].priority != null));
    const mp = path.join(tmp, "m.jsonl");
    const mk = (date, cat, extra = {}) => JSON.stringify({ date, cat, items: 5, verified_rate: 1, ...extra });
    fs.writeFileSync(mp, [mk("2026-09-01", "usa"), mk("2026-09-02", "usa"), mk("2026-09-03", "usa"), mk("2026-09-03", "usa", { items: 9 }), "junk", mk("2026-09-03", "china")].join("\n") + "\n");
    const m = loadMetrics(mp, 2);
    check("T-4 window trims dates", m.dates.length === 2 && m.dates[0] === "2026-09-02");
    check("T-5 same-date last wins", m.by_category.usa.length === 2 && m.by_category.usa[1].items === 9);
    check("T-6 missing metrics file tolerated", loadMetrics(path.join(tmp, "nope.jsonl"), 7).available === false);
    check("T-7 hostname only", hostnameOnly("https://www.Example.com/a/b") === "example.com" && hostnameOnly("not a host!") === null);
    const cfg = fs.readFileSync(path.join(ROOT, "assets/js/config.js"), "utf8");
    check("T-8 priority keywords parsed", loadPriorityKeywords(cfg).latin.length >= 40);
    check("T-9 canaries read-only snapshot", loadCanaries(ROOT).present === true && loadCanaries(ROOT).read_only === true);
    let caught = false;
    try { assertNoLeak({ a: [{ title: "x" }] }); } catch { caught = true; }
    check("T-10 leak key rejected", caught);
    caught = false;
    try { assertNoLeak({ human_ratings: { by_source_domain: [{ id: "https://a.b/c" }] } }); } catch { caught = true; }
    check("T-11 URL outside prompt_regions rejected", caught);
    let ok = true;
    try { assertNoLeak({ prompt_regions: { usa: { search_queries: "site:https://openai.com/blog" } } }); } catch { ok = false; }
    check("T-12 URL inside prompt_regions allowed", ok);
    const doc = build(ROOT, { window: 7, metrics: mp });
    check("T-13 build schema", doc.schema === SCHEMA && doc.boundary.never_promote_this_file === true && doc.boundary.proposals_must_be === "pending_review");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (fails.length) { console.error("build-search-review-input self-test FAILED: " + fails.join("; ")); return 1; }
  console.log("build-search-review-input self-test passed (T-1..T-13)");
  return 0;
}

function main() {
  if (flags.has("--self-test")) return selfTest();
  const window = Math.max(1, parseInt(valueOf("--window", "14"), 10) || 14);
  const metrics = path.resolve(ROOT, valueOf("--metrics", "data/agent/metrics-history.jsonl"));
  const outPath = path.resolve(ROOT, valueOf("--out", "data/agent/.preview/search-review-input.json"));
  const doc = build(ROOT, { window, metrics });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
  console.log(`build-search-review-input: ${Object.keys(doc.prompt_regions).length} prompts, ${doc.metrics.dates.length} metric dates → ${path.relative(ROOT, outPath)}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
