#!/usr/bin/env node
// canary-check.mjs — Phase 3-D：監看 apply-change.mjs 套用後進入 canary 的提案（run-agents 00c，跑在 00b 之後、任何模型步驟之前）。
//
// 只看 proposals.json 內 status === "canary" && production_applied === true 的提案；
// `evaluated`（無 patch／noop）永不進來，`reasons` 字串永不解析。
// 對每筆 canary：以 metrics-history.jsonl 該類別在 canary_started 之後的不同 date 數為夜數 n。
//   n < canary_nights → 只印「觀察中 n/N」；
//   n ≥ canary_nights → canary 期間 verified_rate / priority_hit_rate 的平均 vs baseline，
//     任一項掉超過 revert_drop_pp 個百分點 → 由 rollback.snapshot 還原區段、status: reverted、reverted_at、
//       帳本 canary_reverted { metric, baseline, observed, drop_pp }，還原的檔寫入 apply-change-staged.txt；
//     否則 status: auto_applied、confirmed_at、帳本再記一筆 proposal_auto_applied（payload.stage: "confirmed"）。
// 門檻（canary_nights、revert_drop_pp）只從 agents/_control/canaries.json 讀，程式碼不放常數（紅線②）。
// 所有寫檔一律經 apply-change.mjs 的 assertWritable()（紅線①只留一處，這裡只 import 不重定義）。
// staged.txt 分工：00c 每晚新建（列出回退的檔，可為空），08e 只追加。
// 用法：node scripts/agent/canary-check.mjs [--root DIR] [--dry-run] [--self-test]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertWritable, splitRegion, splitPriorityKeywords, loadCanaries, run as applyRun } from "./apply-change.mjs";
import { appendEvent as ledgerAppend } from "./lib/ledger.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");

export const SCHEMA = "canary-check-v0.1";
export const CHECKER = "canary-check";
export const METRICS = ["verified_rate", "priority_hit_rate"];

function readJsonIfExists(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}
function mean(nums) {
  const xs = nums.filter((n) => Number.isFinite(n));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
const round3 = (n) => Math.round(n * 1000) / 1000;

// 只處理這種提案；其餘（evaluated、rejected、legacy pending_review、canary 但未真的改檔）一律不看。
export function isActiveCanary(p) {
  return !!p && p.status === "canary" && p.production_applied === true;
}

// canary 夜數：該類別在 canary_started 之後（嚴格大於；套用當天的指標是 00b 在改檔前算的）的不同 date。
// 同 date 多行取最後一行（append 語意）；某天沒有該類別的列就不算一夜。
export function canaryNights(metricsPath, cat, since) {
  if (!fs.existsSync(metricsPath) || !cat || !since) return [];
  const byDate = new Map();
  for (const line of fs.readFileSync(metricsPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (!r || r.cat !== cat || typeof r.date !== "string" || !(r.date > since)) continue;
    byDate.set(r.date, { date: r.date, verified_rate: Number(r.verified_rate), priority_hit_rate: Number(r.priority_hit_rate) });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// 判讀：回傳掉最多的那個指標（若超過門檻），否則 null。門檻 dropPp 由呼叫端從 canaries.json 傳入。
export function judge(baseline, nights, dropPp) {
  const observed = {};
  let worst = null;
  for (const m of METRICS) {
    const base = Number(baseline && baseline[m]);
    const obs = mean(nights.map((n) => n[m]));
    observed[m] = obs === null ? null : round3(obs);
    if (!Number.isFinite(base) || obs === null) continue;
    const drop = Math.round((base - obs) * 1e6) / 1e4; // 百分點，去掉浮點雜訊
    if (!worst || drop > worst.drop_pp) worst = { metric: m, baseline: round3(base), observed: round3(obs), drop_pp: drop };
  }
  return { observed, revert: worst && worst.drop_pp > Number(dropPp) ? worst : null };
}

// 由 snapshot 還原：prompt 區段 / PRIORITY_KEYWORDS 用同一把分割器接回 head+before+tail；TIER_B_DOMAINS 整檔。
export function restoreFromSnapshot(current, snapshot) {
  if (!snapshot || typeof snapshot.before !== "string" || !snapshot.file) throw new Error("rollback.snapshot 不完整");
  const rel = snapshot.file, region = snapshot.region;
  if (rel.startsWith("scripts/prompts/")) {
    const parts = splitRegion(current, region);
    if (!parts) throw new Error(`找不到區段 ${region}`);
    return parts.head + snapshot.before + parts.tail;
  }
  if (rel === "assets/js/config.js") {
    if (region !== "PRIORITY_KEYWORDS") throw new Error(`config.js 只認 PRIORITY_KEYWORDS，收到 ${region}`);
    const parts = splitPriorityKeywords(current);
    if (!parts) throw new Error("找不到 PRIORITY_KEYWORDS 區塊");
    return parts.head + snapshot.before + parts.tail;
  }
  if (rel === "scripts/tier-b-domains.json") return snapshot.before;
  throw new Error(`未知的 snapshot 目標 ${rel}`);
}

export function run(root, opts = {}) {
  const now = opts.now || new Date();
  const dryRun = !!opts.dryRun;
  const log = opts.log || ((s) => console.log(s));
  const appendEvent = dryRun ? () => null : (opts.appendEvent || ledgerAppend);
  const out = { schema: SCHEMA, dry_run: dryRun, canaries: 0, observing: 0, reverted: [], confirmed: [], skipped: [], events: [] };

  const canaries = loadCanaries(root);
  const nightsNeeded = Number(canaries.canary_nights), dropPp = Number(canaries.revert_drop_pp);
  if (!canaries.present || !canaries.enabled) {
    log(`canary-check：auto_opt 未啟用（canaries.json ${canaries.present ? "auto_opt.enabled=false" : "不存在"}），只印不改。`);
    out.disabled = true;
    return out;
  }
  if (!Number.isFinite(nightsNeeded) || nightsNeeded < 1 || !Number.isFinite(dropPp)) {
    log("canary-check：canaries.json 缺 canary_nights／revert_drop_pp，無法判讀，只印不改。");
    out.disabled = true;
    return out;
  }

  const indexPath = path.join(root, "data/agent/proposals.json");
  const index = readJsonIfExists(indexPath);
  const proposals = index && Array.isArray(index.proposals) ? index.proposals : [];
  const metricsPath = path.join(root, "data/agent/metrics-history.jsonl");
  const staged = [];
  let dirty = false;

  for (const p of proposals) {
    if (!isActiveCanary(p)) continue;
    out.canaries += 1;
    const id = p.proposal_id;
    const nights = canaryNights(metricsPath, p.category, p.canary_started);
    if (nights.length < nightsNeeded) {
      out.observing += 1;
      log(`  ${id}（${p.category}）：觀察中 ${nights.length}/${nightsNeeded}`);
      continue;
    }
    const verdict = judge(p.baseline, nights, dropPp);
    if (verdict.revert) {
      const v = verdict.revert;
      const snap = p.rollback && p.rollback.snapshot;
      let rel, restored;
      try {
        rel = snap && snap.file;
        const abs = assertWritable(root, rel, { edit: true });
        restored = restoreFromSnapshot(fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "", snap);
      } catch (e) {
        out.skipped.push({ id, why: `無法回滾：${e.message}` });
        log(`  ${id}：${v.metric} 掉 ${v.drop_pp}pp（> ${dropPp}）但無法回滾：${e.message}`);
        continue;
      }
      if (dryRun) {
        log(`  ${id}：dry-run，${v.metric} baseline ${v.baseline} → 觀察 ${v.observed}（掉 ${v.drop_pp}pp > ${dropPp}），將回滾 ${rel} [${snap.region}]，不寫檔`);
        out.reverted.push({ id, ...v });
        continue;
      }
      fs.writeFileSync(assertWritable(root, rel, { edit: true }), restored, "utf8");
      staged.push(rel);
      Object.assign(p, { status: "reverted", reverted_at: now.toISOString(), reverted_by: CHECKER, canary_result: { ...v, nights: nights.length, observed: verdict.observed } });
      dirty = true;
      out.reverted.push({ id, ...v });
      out.events.push(appendEvent({ event_type: "canary_reverted", actor: CHECKER, subject_type: "proposal", subject_id: id, payload: { metric: v.metric, baseline: v.baseline, observed: v.observed, drop_pp: v.drop_pp, nights: nights.length, category: p.category, target_files: [rel], region: snap.region } }));
      log(`  ${id}：${v.metric} baseline ${v.baseline} → 觀察 ${v.observed}（掉 ${v.drop_pp}pp > ${dropPp}），已回滾 ${rel} [${snap.region}] → reverted`);
      continue;
    }
    if (dryRun) {
      log(`  ${id}：dry-run，${nights.length} 夜未退化（verified ${verdict.observed.verified_rate}、priority ${verdict.observed.priority_hit_rate}），將確認 auto_applied，不寫檔`);
      out.confirmed.push({ id });
      continue;
    }
    Object.assign(p, { status: "auto_applied", confirmed_at: now.toISOString(), confirmed_by: CHECKER, canary_result: { nights: nights.length, observed: verdict.observed } });
    dirty = true;
    out.confirmed.push({ id });
    out.events.push(appendEvent({ event_type: "proposal_auto_applied", actor: CHECKER, subject_type: "proposal", subject_id: id, payload: { stage: "confirmed", nights: nights.length, baseline: p.baseline, observed: verdict.observed, category: p.category, target_files: Array.isArray(p.target_files) ? p.target_files : [] } }));
    log(`  ${id}：${nights.length} 夜未退化（verified ${verdict.observed.verified_rate}、priority ${verdict.observed.priority_hit_rate}）→ auto_applied`);
  }

  if (!dryRun) {
    if (dirty) {
      index.updated_at = now.toISOString();
      fs.writeFileSync(assertWritable(root, "data/agent/proposals.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
      for (const p of proposals) {
        if (!p || !p.proposal_id || !(p.reverted_by === CHECKER || p.confirmed_by === CHECKER)) continue;
        const detailRel = `data/agent/proposals/${p.proposal_id}.json`;
        const prev = readJsonIfExists(path.join(root, detailRel)) || {};
        fs.mkdirSync(path.dirname(assertWritable(root, detailRel)), { recursive: true });
        fs.writeFileSync(assertWritable(root, detailRel), `${JSON.stringify({ ...prev, ...p }, null, 2)}\n`, "utf8");
      }
    }
    // 每晚新建 staged.txt（列出回退的檔，可為空）；08e 之後只追加。
    const stagedRel = "data/agent/.preview/apply-change-staged.txt";
    fs.mkdirSync(path.dirname(assertWritable(root, stagedRel)), { recursive: true });
    fs.writeFileSync(assertWritable(root, stagedRel), staged.map((s) => `${s}\n`).join(""), "utf8");
  }
  out.changed_files = [...staged];
  log(`canary-check：canary ${out.canaries}、觀察中 ${out.observing}、回滾 ${out.reverted.length}、確認 ${out.confirmed.length}、略過 ${out.skipped.length}${dryRun ? "（dry-run）" : ""}`);
  return out;
}

// ── 自測 C-1..C-9 ────────────────────────────────────────────────────────────
// canary fixture 不手寫：在暫存 root 直接跑 apply-change.mjs 的 run() 產生（與正式流程同一條路）。
function selfTest() {
  let fails = 0;
  const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) fails += 1; };
  const APPLY_NOW = new Date("2026-09-05T10:00:00.000Z");
  const CHECK_NOW = new Date("2026-09-09T10:00:00.000Z");
  const w = (root, rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text, "utf8"); };
  const r = (root, rel) => fs.readFileSync(path.join(root, rel), "utf8");
  const has = (root, rel) => fs.existsSync(path.join(root, rel));
  const USA = "Search the web.\n\n<!-- SEARCH_QUERIES:BEGIN -->\n- q1 OR q2 2026\n- q3 2026\n<!-- SEARCH_QUERIES:END -->\n\n<!-- PRIORITY:BEGIN -->\n1. Agent\n2. LLM\n<!-- PRIORITY:END -->\n\nOutput JSON.\n";
  const CANARIES = { weekly_cap: 3, per_category_cap: 1, canary_nights: 3, revert_drop_pp: 10, auto_opt: { enabled: true } };
  const row = (date, cat, vr, pr) => JSON.stringify({ schema: "category-metrics-v0.1", date, cat, items: 20, verified_rate: vr, priority_hit_rate: pr, validation_pass_rate: 95 });
  // baseline：usa 近 7 夜中位數 → verified_rate 0.725、priority_hit_rate 0.8
  const BASE_ROWS = ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"].map((d, i) => row(d, "usa", 0.7 + i * 0.01, 0.8));
  const BASELINE_VR = 0.725;

  // 用 apply-change 的 run() 產生 canary fixture；withPatch=false 時提案沒有 patch → 維持 evaluated
  const setup = ({ withPatch = true, canaries = CANARIES } = {}) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "canary-check-"));
    w(root, "scripts/prompts/usa.md", USA);
    w(root, "agents/_control/canaries.json", JSON.stringify(canaries));
    w(root, "data/agent/metrics-history.jsonl", BASE_ROWS.join("\n") + "\n");
    w(root, "data/agent/learning-status.json", JSON.stringify({ mode: "auto-opt-v2", proposal_count: 1 }));
    w(root, "data/agent/proposals.json", JSON.stringify({ generated_at: "2026-09-05T09:00:00Z", proposal_count: 1, proposals: [
      { proposal_id: "prop-legacy", status: "pending_review", target_files: ["scripts/prompts/usa.md"], evidence: ["e"], requires_human_review: true, advisory_only: true, production_applied: false },
    ] }));
    const prop = { proposal_id: "SP-001", category: "usa", region: "SEARCH_QUERIES", change_type: "add_query", target_files: ["scripts/prompts/usa.md"], risk: "low", status: "pending_review", summary_zh: "加一條 agent eval 查詢", evidence: ["usa 近 7 夜 priority_hit_rate 0.62"] };
    if (withPatch) prop.patch = { add: "- \"agent eval\" OR \"agentbench\" 2026" };
    w(root, "data/agent/.preview/search-review.json", JSON.stringify({ schema: "agent-search-review-v0.1", proposals: [prop] }));
    w(root, "data/agent/.preview/change-eval.json", JSON.stringify({ schema: "agent-change-eval-v0.1", verdicts: [
      { proposal_id: "SP-001", verdict: "accept", reasons_zh: ["符合 R1"], rubric_hits: ["R1"], security_flag: false },
    ] }));
    const applied = applyRun(root, { now: APPLY_NOW, log: () => {}, appendEvent: (e) => e });
    return { root, applied };
  };
  const addNights = (root, rows) => fs.appendFileSync(path.join(root, "data/agent/metrics-history.jsonl"), rows.join("\n") + "\n", "utf8");
  const nightsOf = (dates, vr) => dates.map((d) => row(d, "usa", vr, 0.8));
  const D3 = ["2026-09-06", "2026-09-07", "2026-09-08"];
  const idx = (root) => JSON.parse(r(root, "data/agent/proposals.json"));
  const sp = (root) => idx(root).proposals.find((p) => p.proposal_id === "SP-001");
  const events = [];
  const opts = { now: CHECK_NOW, log: () => {}, appendEvent: (e) => { events.push(e); return e; } };
  const roots = [];

  // fixture 本身：apply-change 真的把 SP-001 變成 canary
  {
    const { root, applied } = setup(); roots.push(root);
    const p = sp(root);
    check("C-0 fixture 由 apply-change run() 產生：SP-001 status=canary、production_applied=true、baseline 0.725/0.8、snapshot 齊全", applied.applied === 1 && isActiveCanary(p) && p.baseline.verified_rate === BASELINE_VR && p.baseline.priority_hit_rate === 0.8 && p.rollback.snapshot.file === "scripts/prompts/usa.md" && p.rollback.snapshot.region === "SEARCH_QUERIES" && p.canary_started === "2026-09-05");
  }
  // C-1 夜數不足 → 不改任何東西（即使數字已經很差）
  {
    events.length = 0;
    const { root } = setup(); roots.push(root);
    addNights(root, nightsOf(D3.slice(0, 2), 0.3));
    const before = r(root, "scripts/prompts/usa.md"), beforeIdx = r(root, "data/agent/proposals.json");
    const logs = []; const res = run(root, { ...opts, log: (s) => logs.push(s) });
    check("C-1 夜數 2/3 不足 → 只印「觀察中 2/3」、檔案與索引位元組不變、無帳本事件", res.observing === 1 && logs.some((l) => l.includes("觀察中 2/3")) && r(root, "scripts/prompts/usa.md") === before && r(root, "data/agent/proposals.json") === beforeIdx && events.length === 0 && sp(root).status === "canary");
  }
  // C-2 邊界：掉 10.1pp 回滾、9.9pp 不回滾（門檻 10 讀自 canaries.json）；C-3 回滾後區段與 snapshot 位元組相同
  {
    events.length = 0;
    const { root } = setup(); roots.push(root);
    const snapBefore = sp(root).rollback.snapshot.before;
    addNights(root, nightsOf(D3, Math.round((BASELINE_VR - 0.101) * 1000) / 1000));
    const res = run(root, opts);
    const after = r(root, "scripts/prompts/usa.md");
    const p = sp(root);
    check("C-2a 掉 10.1pp（> 10）→ reverted、reverted_at、canary_reverted 事件 {metric, baseline, observed, drop_pp}", res.reverted.length === 1 && p.status === "reverted" && typeof p.reverted_at === "string" && events.length === 1 && events[0].event_type === "canary_reverted" && events[0].payload.metric === "verified_rate" && events[0].payload.baseline === BASELINE_VR && events[0].payload.observed === 0.624 && Math.abs(events[0].payload.drop_pp - 10.1) < 1e-9);
    check("C-3 回滾後整檔與套用前位元組相同、區段 === snapshot.before", after === USA && splitRegion(after, "SEARCH_QUERIES").body === snapBefore);
    check("C-3b 回退的檔寫進 apply-change-staged.txt", r(root, "data/agent/.preview/apply-change-staged.txt") === "scripts/prompts/usa.md\n");
    check("C-3c 明細 data/agent/proposals/SP-001.json 同步 reverted", JSON.parse(r(root, "data/agent/proposals/SP-001.json")).status === "reverted");
    // C-5 同一筆不再重判
    const idxAfter = r(root, "data/agent/proposals.json"); events.length = 0;
    const res2 = run(root, opts);
    check("C-5 再跑一次：reverted 不再被看、無事件、索引位元組不變、staged.txt 清空", res2.canaries === 0 && events.length === 0 && r(root, "data/agent/proposals.json") === idxAfter && r(root, "data/agent/.preview/apply-change-staged.txt") === "");
  }
  {
    events.length = 0;
    const { root } = setup(); roots.push(root);
    addNights(root, nightsOf(D3, Math.round((BASELINE_VR - 0.099) * 1000) / 1000));
    const res = run(root, opts);
    const p = sp(root);
    check("C-2b 掉 9.9pp（≤ 10）→ auto_applied、confirmed_at、proposal_auto_applied {stage:'confirmed'}、檔案保留新查詢", res.confirmed.length === 1 && p.status === "auto_applied" && typeof p.confirmed_at === "string" && events.length === 1 && events[0].event_type === "proposal_auto_applied" && events[0].payload.stage === "confirmed" && r(root, "scripts/prompts/usa.md").includes("agentbench") && r(root, "data/agent/.preview/apply-change-staged.txt") === "");
    const idxAfter = r(root, "data/agent/proposals.json"); events.length = 0;
    const res2 = run(root, opts);
    check("C-5b auto_applied 也不再重判", res2.canaries === 0 && events.length === 0 && r(root, "data/agent/proposals.json") === idxAfter);
  }
  // C-2c dry-run：該回滾的只印不寫
  {
    events.length = 0;
    const { root } = setup(); roots.push(root);
    addNights(root, nightsOf(D3, 0.3));
    const before = r(root, "scripts/prompts/usa.md"), beforeIdx = r(root, "data/agent/proposals.json");
    const stagedRel = "data/agent/.preview/apply-change-staged.txt", beforeStaged = has(root, stagedRel) ? r(root, stagedRel) : null; // 08e 已寫過
    const logs = []; const res = run(root, { ...opts, dryRun: true, log: (s) => logs.push(s) });
    check("C-2c dry-run：印出將回滾、檔案／索引／staged.txt 位元組不變、無事件", res.reverted.length === 1 && logs.some((l) => l.includes("將回滾")) && r(root, "scripts/prompts/usa.md") === before && r(root, "data/agent/proposals.json") === beforeIdx && events.length === 0 && (has(root, stagedRel) ? r(root, stagedRel) : null) === beforeStaged && sp(root).status === "canary");
  }
  // C-4 缺夜不計：09-06、09-08 有 usa，09-07 只有 models → 夜數 2，不判
  {
    events.length = 0;
    const { root } = setup(); roots.push(root);
    addNights(root, [row("2026-09-06", "usa", 0.3, 0.8), row("2026-09-07", "models", 0.3, 0.8), row("2026-09-08", "usa", 0.3, 0.8)]);
    const logs = []; const res = run(root, { ...opts, log: (s) => logs.push(s) });
    check("C-4 某天沒有該類別的列不算一夜 → 觀察中 2/3、不回滾", res.observing === 1 && logs.some((l) => l.includes("觀察中 2/3")) && sp(root).status === "canary" && events.length === 0);
    check("C-4b canary_started 當天與之前的列不算夜", canaryNights(path.join(root, "data/agent/metrics-history.jsonl"), "usa", "2026-09-05").map((n) => n.date).join(",") === "2026-09-06,2026-09-08");
  }
  // C-6 帳本事件不含 title／URL
  {
    events.length = 0;
    const { root } = setup(); roots.push(root);
    addNights(root, nightsOf(D3, 0.3));
    run(root, opts);
    const s = JSON.stringify(events);
    check("C-6 帳本事件無 title／url／http", events.length === 1 && !/"title"|"url"|http/i.test(s) && events[0].subject_id === "SP-001");
  }
  // C-7 門檻改成 5：掉 5.1pp 回滾、4.9pp 不回滾（證明不是寫死 10）
  {
    const c5 = { ...CANARIES, revert_drop_pp: 5 };
    const a = setup({ canaries: c5 }); roots.push(a.root);
    addNights(a.root, nightsOf(D3, Math.round((BASELINE_VR - 0.051) * 1000) / 1000));
    const ra = run(a.root, opts);
    const b = setup({ canaries: c5 }); roots.push(b.root);
    addNights(b.root, nightsOf(D3, Math.round((BASELINE_VR - 0.049) * 1000) / 1000));
    const rb = run(b.root, opts);
    check("C-7 revert_drop_pp=5 → 掉 5.1pp 回滾、4.9pp 確認（門檻讀自 canaries.json）", ra.reverted.length === 1 && sp(a.root).status === "reverted" && rb.confirmed.length === 1 && sp(b.root).status === "auto_applied");
    const c = setup(); roots.push(c.root);
    w(c.root, "agents/_control/canaries.json", JSON.stringify({ ...CANARIES, auto_opt: { enabled: false } }));
    addNights(c.root, nightsOf(D3, 0.3));
    const rc = run(c.root, opts);
    check("C-7b auto_opt.enabled=false → 只印不改", rc.disabled === true && sp(c.root).status === "canary" && r(c.root, "scripts/prompts/usa.md").includes("agentbench"));
  }
  // C-8 零 canary 提案 → 零寫入（只留空的 staged.txt，讓 08e 追加）
  {
    events.length = 0;
    const { root } = setup({ withPatch: false }); roots.push(root);
    addNights(root, nightsOf(D3, 0.3));
    const beforeIdx = r(root, "data/agent/proposals.json"), beforeUsa = r(root, "scripts/prompts/usa.md");
    const detailBefore = r(root, "data/agent/proposals/SP-001.json");
    const res = run(root, opts);
    check("C-8 零 canary → canaries 0、索引／明細／目標檔位元組不變、無事件、staged.txt 空", res.canaries === 0 && r(root, "data/agent/proposals.json") === beforeIdx && r(root, "scripts/prompts/usa.md") === beforeUsa && r(root, "data/agent/proposals/SP-001.json") === detailBefore && events.length === 0 && r(root, "data/agent/.preview/apply-change-staged.txt") === "");
    // C-9 evaluated（無 patch）且 production_applied:false：即使指標大跌也不回滾、不記帳
    const p = sp(root);
    check("C-9 evaluated + production_applied:false 不被看：status 仍 evaluated、無 reverted_at、無事件", p.status === "evaluated" && p.production_applied === false && !p.reverted_at && events.length === 0 && !isActiveCanary(p));
    check("C-9b isActiveCanary 只認 status=canary 且 production_applied===true", !isActiveCanary({ status: "canary", production_applied: false }) && !isActiveCanary({ status: "evaluated", production_applied: true }) && !isActiveCanary({ status: "canary" }) && isActiveCanary({ status: "canary", production_applied: true }));
  }
  for (const x of roots) fs.rmSync(x, { recursive: true, force: true });
  console.log(fails ? `\n${fails} 項失敗` : "\ncanary-check 自測全綠");
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
    try {
      run(root, { dryRun: flags.has("--dry-run") });
    } catch (e) {
      console.error(`canary-check 失敗：${e && e.message ? e.message : e}`);
      process.exit(1);
    }
  }
}
