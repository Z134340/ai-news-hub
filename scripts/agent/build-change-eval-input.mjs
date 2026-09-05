#!/usr/bin/env node
// Phase 3-A：把閘 1（search-reviewer）留下的 pending_review 提案，連同配額、in-flight canary、
// 14 晚指標，組成閘 2（change-evaluator）的唯讀輸入 data/agent/.preview/change-eval-input.json。
// 紅線：配額數字只從 agents/_control/canaries.json 讀；缺 search-review.json 仍要寫出 proposals: []；
// 不含標題／URL（assertNoLeak）；本檔永遠留在 .preview，promote.sh 的 NEVER_FILES 擋住它。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { loadMetrics, loadCanaries, assertNoLeak } from "./build-search-review-input.mjs";

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const valueOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

export const SCHEMA = "change-eval-input-v0.1";
export const IN_FLIGHT_STATUSES = new Set(["evaluated", "canary"]);
export const IN_FLIGHT_WINDOW_DAYS = 7;
const LEAK_KEYS = new Set(["title", "url", "summary", "headline"]);
const ALLOWLIST_TARGETS = ["scripts/prompts/<cat>.md", "assets/js/config.js", "scripts/tier-b-domains.json"];

function readJsonIfExists(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

// 上游 search-review 提案沒有 rollback 欄；閘 2 的 CE-2 需要一句可執行的還原描述，這裡依 change_type 補。
export function deriveRollback(changeType) {
  if (/^add_/.test(changeType || "")) return "移除 apply-change 新增的那一行／那一項（依 proposal_id 標記的 marker 區段）";
  if (changeType === "drop_query" || changeType === "drop_keyword" || changeType === "rephrase_query") {
    return "還原 apply-change 套用前的區段快照（data/agent/.preview/apply-snapshots/<proposal_id>）";
  }
  return "";
}

// 只留評審需要的欄位；title/url/summary/headline 一律丟掉，含 URL 的字串改成佔位。
export function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) { if (!LEAK_KEYS.has(k)) out[k] = scrub(x); }
    return out;
  }
  if (typeof v === "string" && /https?:\/\//i.test(v)) return "[url-removed]";
  return v;
}

function slimProposal(p) {
  const rollbackUp = typeof p.rollback === "string" ? p.rollback.trim() : "";
  return scrub({
    proposal_id: p.proposal_id ?? null,
    category: p.category ?? null,
    region: p.region ?? null,
    change_type: p.change_type ?? null,
    target_files: Array.isArray(p.target_files) ? p.target_files : [],
    risk: p.risk ?? null,
    status: p.status ?? null,
    summary_zh: typeof p.summary_zh === "string" ? p.summary_zh : "",
    evidence: Array.isArray(p.evidence) ? p.evidence.filter((e) => typeof e === "string") : [],
    expected_effect: p.expected_effect && typeof p.expected_effect === "object"
      ? { metric: p.expected_effect.metric ?? null, direction: p.expected_effect.direction ?? null } : null,
    rubric_hits: Array.isArray(p.rubric_hits) ? p.rubric_hits : [],
    rollback: rollbackUp || deriveRollback(p.change_type),
    rollback_source: rollbackUp ? "upstream" : "derived",
    // S3-C2 ②：閘 2 要看得到實際 diff 才裁定；patch 內的字串一樣走 scrub（URL → 佔位）。
    patch: p.patch && typeof p.patch === "object" && !Array.isArray(p.patch) ? p.patch : null,
  });
}

// proposals.json 的 created_at 只有 "HH:MM"；能解析成日期的欄位才算，否則退到索引 generated_at，
// 再不行就保守地算在窗內（寧可少發一件，不可超額）。
export function resolveSince(p, indexGeneratedAt) {
  for (const k of ["evaluated_at", "canary_started_at", "updated_at", "decided_at", "created_at"]) {
    const v = p && p[k];
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v))) return v;
  }
  if (typeof indexGeneratedAt === "string" && !Number.isNaN(Date.parse(indexGeneratedAt))) return indexGeneratedAt;
  return null;
}

export function loadInFlight(root, now) {
  const idx = readJsonIfExists(path.join(root, "data/agent/proposals.json"));
  const list = idx && Array.isArray(idx.proposals) ? idx.proposals : [];
  const cutoff = now.getTime() - IN_FLIGHT_WINDOW_DAYS * 86400e3;
  const out = [];
  for (const p of list) {
    if (!p || !IN_FLIGHT_STATUSES.has(p.status)) continue;
    const since = resolveSince(p, idx.generated_at);
    if (since !== null && Date.parse(since) < cutoff) continue;
    out.push(scrub({
      proposal_id: p.proposal_id ?? null, category: p.category ?? null, region: p.region ?? null,
      change_type: p.change_type ?? p.proposal_type ?? null,
      target_files: Array.isArray(p.target_files) ? p.target_files : [],
      status: p.status, since: since ?? "unknown",
      // 只有真的改過檔的 canary 才占週配額；evaluated 無 patch 只做 7 天去重（與 apply-change.countInFlight 同尺）。
      production_applied: p.production_applied === true,
    }));
  }
  return out;
}

export function build(root, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const window = opts.window ?? 14;
  const reviewPath = opts.searchReview ?? path.join(root, "data/agent/.preview/search-review.json");
  const metricsPath = opts.metrics ?? path.join(root, "data/agent/metrics-history.jsonl");

  const review = readJsonIfExists(reviewPath);
  const rawProposals = review && Array.isArray(review.proposals) ? review.proposals : [];
  const pending = rawProposals.filter((p) => p && p.status === "pending_review");

  const canaries = loadCanaries(root);
  const inFlight = loadInFlight(root, now);
  const quotaUsed = inFlight.filter((c) => c.production_applied === true);
  const byCat = {};
  for (const c of quotaUsed) byCat[c.category || "unknown"] = (byCat[c.category || "unknown"] || 0) + 1;
  const weeklyCap = canaries.present && Number.isFinite(canaries.weekly_cap) ? canaries.weekly_cap : 0;

  const doc = {
    schema: SCHEMA,
    generated_at: now.toISOString(),
    source: {
      search_review_path: path.relative(root, reviewPath),
      present: !!review,
      search_review_schema: review && review.schema ? review.schema : null,
      search_review_generated_at: review && review.generated_at ? review.generated_at : null,
      pending_review_in: pending.length,
      dropped_non_pending: rawProposals.length - pending.length,
    },
    quota: {
      source: "agents/_control/canaries.json",
      present: canaries.present,
      read_only: true,
      weekly_cap: canaries.present ? canaries.weekly_cap : null,
      per_category_cap: canaries.present ? canaries.per_category_cap : null,
      canary_nights: canaries.present ? canaries.canary_nights : null,
      revert_drop_pp: canaries.present ? canaries.revert_drop_pp : null,
      auto_opt_enabled: canaries.present ? canaries.auto_opt_enabled : false,
      window_days: IN_FLIGHT_WINDOW_DAYS,
      in_flight: quotaUsed.length,
      in_flight_by_category: byCat,
      dedupe_in_flight: inFlight.length,
      remaining: Math.max(0, weeklyCap - quotaUsed.length),
    },
    canaries_in_flight: inFlight,
    proposals: pending.map(slimProposal),
    metrics_window: { window_days: window, ...loadMetrics(metricsPath, window) },
    allowlist_targets: ALLOWLIST_TARGETS,
    boundary: {
      verdict_only: true, allowed_verdicts: ["accept", "reject"], new_proposals: false, field_edits: false,
      production_write: false, publish: "manual_only", never_promote_this_file: true,
    },
  };
  assertNoLeak(doc);
  return doc;
}

function selfTest() {
  const fails = [];
  const check = (label, cond) => { if (!cond) fails.push(label); };
  const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), "cei-"));
  const writeJson = (root, rel, obj) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj), "utf8");
  };
  const NOW = "2026-09-05T10:00:00.000Z";
  const canaries = { weekly_cap: 3, per_category_cap: 1, canary_nights: 3, revert_drop_pp: 10, auto_opt: { enabled: true } };
  const prop = (id, extra = {}) => ({
    proposal_id: id, category: "usa", region: "SEARCH_QUERIES", change_type: "add_query",
    target_files: ["scripts/prompts/usa.md"], risk: "low", status: "pending_review",
    summary_zh: "usa 新增一條 query", evidence: ["usa priority_hit_rate 2026-09-04 0.556"],
    expected_effect: { metric: "priority_hit_rate", direction: "up" }, rubric_hits: ["SR-4"], ...extra,
  });

  // T-1 缺 search-review.json → 不 crash、proposals: []、present false
  {
    const r = mk(); writeJson(r, "agents/_control/canaries.json", canaries);
    const d = build(r, { now: NOW });
    check("T-1 missing search-review → proposals []", d.proposals.length === 0 && d.source.present === false && d.schema === SCHEMA);
    check("T-2 schema/boundary", d.boundary.verdict_only === true && d.boundary.never_promote_this_file === true && d.quota.remaining === 3);
  }
  // T-3 0 proposals（檔在但空）
  {
    const r = mk(); writeJson(r, "agents/_control/canaries.json", canaries);
    writeJson(r, "data/agent/.preview/search-review.json", { schema: "agent-search-review-v0.1", generated_at: NOW, proposals: [] });
    const d = build(r, { now: NOW });
    check("T-3 empty proposals", d.proposals.length === 0 && d.source.present === true && d.source.search_review_generated_at === NOW);
  }
  // T-4 remaining = max(0, cap − in_flight)：cap 3、in_flight 5 → 0
  {
    const r = mk(); writeJson(r, "agents/_control/canaries.json", canaries);
    writeJson(r, "data/agent/proposals.json", { generated_at: NOW, proposals: Array.from({ length: 5 }, (_, i) => ({ proposal_id: `P-${i}`, category: "usa", status: i % 2 ? "canary" : "evaluated", evaluated_at: "2026-09-04T00:00:00Z", production_applied: true })) });
    const d = build(r, { now: NOW });
    check("T-4 remaining clamps at 0", d.quota.in_flight === 5 && d.quota.remaining === 0);
    // 同 5 件但都沒真的改檔（evaluated 無 patch）→ 去重清單仍 5 件、配額 0 件、remaining 回到 cap
    writeJson(r, "data/agent/proposals.json", { generated_at: NOW, proposals: Array.from({ length: 5 }, (_, i) => ({ proposal_id: `P-${i}`, category: "usa", status: "evaluated", evaluated_at: "2026-09-04T00:00:00Z", production_applied: false })) });
    const d2 = build(r, { now: NOW });
    check("T-4b evaluated 無 patch 不占配額但留在去重清單", d2.quota.in_flight === 0 && d2.quota.dedupe_in_flight === 5 && d2.quota.remaining === 3 && d2.canaries_in_flight.length === 5 && d2.canaries_in_flight.every((c) => c.production_applied === false));
  }
  // T-5 in_flight 7 天窗：pending_review 不算、10 天前的 canary 不算、時間只有 HH:MM 退到 generated_at
  {
    const r = mk(); writeJson(r, "agents/_control/canaries.json", canaries);
    writeJson(r, "data/agent/proposals.json", { generated_at: "2026-09-03T18:09:00Z", proposals: [
      { proposal_id: "A", category: "usa", status: "pending_review", created_at: "18:09" },
      { proposal_id: "B", category: "china", status: "canary", canary_started_at: "2026-08-25T00:00:00Z" },
      { proposal_id: "C", category: "papers", status: "canary", created_at: "18:09", production_applied: true },
      { proposal_id: "D", category: "usa", status: "evaluated", evaluated_at: "2026-09-02T00:00:00Z", production_applied: false },
    ] });
    const d = build(r, { now: NOW });
    const ids = d.canaries_in_flight.map((c) => c.proposal_id).sort();
    check("T-5 in_flight window filter", ids.join(",") === "C,D" && d.quota.dedupe_in_flight === 2 && d.quota.in_flight === 1 && d.quota.remaining === 2);
    check("T-6 in_flight_by_category 只算 production_applied", d.quota.in_flight_by_category.papers === 1 && !("usa" in d.quota.in_flight_by_category));
  }
  // T-7 無標題／URL：title/url 鍵被丟、evidence 內 URL 改佔位、assertNoLeak 過
  {
    const r = mk(); writeJson(r, "agents/_control/canaries.json", canaries);
    writeJson(r, "data/agent/.preview/search-review.json", { proposals: [prop("SP-001", { title: "leak", url: "https://x.example/leak", evidence: ["see https://x.example/a 2026-09-04"] })] });
    const d = build(r, { now: NOW });
    const s = JSON.stringify(d);
    check("T-7 no title/url leak", !("title" in d.proposals[0]) && !("url" in d.proposals[0]) && !/https?:\/\//.test(s) && s.includes("[url-removed]"));
  }
  // T-8 canaries.json 缺 → remaining 0、present false（fail-closed）
  {
    const r = mk();
    writeJson(r, "data/agent/.preview/search-review.json", { proposals: [prop("SP-001")] });
    const d = build(r, { now: NOW });
    check("T-8 canaries missing → remaining 0", d.quota.present === false && d.quota.remaining === 0 && d.quota.weekly_cap === null && d.proposals.length === 1);
  }
  // T-9 非 pending_review 丟掉並計數
  {
    const r = mk(); writeJson(r, "agents/_control/canaries.json", canaries);
    writeJson(r, "data/agent/.preview/search-review.json", { proposals: [prop("SP-001"), prop("SP-002", { status: "rejected" }), prop("SP-003", { status: "evaluated" })] });
    const d = build(r, { now: NOW });
    check("T-9 non-pending dropped", d.proposals.length === 1 && d.source.dropped_non_pending === 2 && d.source.pending_review_in === 1);
  }
  // T-10 rollback：上游有 → upstream；沒有 → 依 change_type derived；未知 change_type → 空字串（讓 CE-2 擋）
  {
    const r = mk(); writeJson(r, "agents/_control/canaries.json", canaries);
    writeJson(r, "data/agent/.preview/search-review.json", { proposals: [
      prop("SP-001", { rollback: "手動還原 X" }), prop("SP-002", { change_type: "drop_query" }), prop("SP-003", { change_type: "weird" }),
    ] });
    const d = build(r, { now: NOW });
    const [a, b, c] = d.proposals;
    check("T-10 rollback derived vs upstream", a.rollback_source === "upstream" && a.rollback === "手動還原 X"
      && b.rollback_source === "derived" && b.rollback.includes("快照") && c.rollback === "" && c.rollback_source === "derived");
  }
  // T-11 metrics window：junk 行容忍、同日後行覆蓋、window 截尾
  {
    const r = mk(); writeJson(r, "agents/_control/canaries.json", canaries);
    const lines = [];
    for (let i = 1; i <= 16; i++) lines.push(JSON.stringify({ date: `2026-08-${String(i).padStart(2, "0")}`, cat: "usa", priority_hit_rate: 0.5 }));
    lines.push("not json");
    lines.push(JSON.stringify({ date: "2026-08-16", cat: "usa", priority_hit_rate: 0.9 }));
    writeJson(r, "data/agent/metrics-history.jsonl", lines.join("\n") + "\n");
    const d = build(r, { now: NOW, window: 14 });
    const usa = d.metrics_window.by_category.usa;
    check("T-11 metrics window", d.metrics_window.available && d.metrics_window.dates.length === 14 && usa.length === 14 && usa[usa.length - 1].priority_hit_rate === 0.9);
  }
  // T-12 patch 保留給閘 2 看；patch 內 URL 改佔位；非物件 patch → null
  {
    const r = mk(); writeJson(r, "agents/_control/canaries.json", canaries);
    writeJson(r, "data/agent/.preview/search-review.json", { proposals: [
      prop("SP-001", { patch: { add: "- \"agent eval\" OR \"agentbench\" 2026" } }),
      prop("SP-002", { change_type: "rephrase_query", patch: { replace: { from: "- old 2026", to: "- see https://x.example/a 2026" } } }),
      prop("SP-003", { patch: "not an object" }),
      prop("SP-004"),
    ] });
    const d = build(r, { now: NOW });
    const [a, b, c, e] = d.proposals;
    check("T-12 patch retained / scrubbed / nulled", a.patch && a.patch.add === "- \"agent eval\" OR \"agentbench\" 2026"
      && b.patch && b.patch.replace.from === "- old 2026" && b.patch.replace.to === "[url-removed]"
      && c.patch === null && e.patch === null && !/https?:\/\//.test(JSON.stringify(d)));
  }
  if (fails.length) { console.error("build-change-eval-input self-test FAILED: " + fails.join("; ")); return 1; }
  console.log("build-change-eval-input self-test passed (T-1..T-12)");
  return 0;
}

function main() {
  if (flags.has("--self-test")) return selfTest();
  const outPath = path.resolve(ROOT, valueOf("--out", "data/agent/.preview/change-eval-input.json"));
  const doc = build(ROOT, {
    window: Number(valueOf("--window", "14")) || 14,
    metrics: valueOf("--metrics", null) ? path.resolve(ROOT, valueOf("--metrics")) : undefined,
    searchReview: valueOf("--search-review", null) ? path.resolve(ROOT, valueOf("--search-review")) : undefined,
  });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
  console.log(`change-eval-input written: ${path.relative(ROOT, outPath)} (proposals=${doc.proposals.length}, in_flight=${doc.quota.in_flight}, remaining=${doc.quota.remaining})`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) { process.exit(main()); }
