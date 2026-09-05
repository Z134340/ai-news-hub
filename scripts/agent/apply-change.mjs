#!/usr/bin/env node
// apply-change.mjs — Phase 3-C：change-evaluator（閘2）accept 之後，唯一會真的改檔的確定性步驟。
//
// 資料流：.preview/change-eval.json（verdicts）→ 併回 data/agent/proposals.json（evaluated / rejected）
//        → 對 evaluated 且配額內的提案，只改 marker 區段內的行 → status: canary → 帳本 proposal_auto_applied
//        → 實際改過的檔路徑寫到 .preview/apply-change-staged.txt，讓 run-daily.sh 補 git add。
//
// 紅線（見 HANDOFF.md §1 / §2b）：
//   ① 只能改 scripts/prompts/[a-z]+.md、assets/js/config.js、scripts/tier-b-domains.json，且只動 marker 區段內的行；
//      agents/_control/**、memory/**、skills/**、.github/**、hermes.project.yaml 永遠不在名單。
//   ② 配額數字（週上限、每類上限、canary 夜數、回滾門檻）只從 agents/_control/canaries.json 讀，程式裡不放常數。
//   ③ 所有 writeFileSync 都必須經過 assertWritable()（run-agents.sh 的 S-2c 用靜態字串檢查釘住這件事）。
//   ④ 帳本 payload 不放標題 / URL；提案本身的 evidence 已由上游去敏。
//
// 提案要能被套用，必須帶結構化的 patch 欄位（apply-change 不從 summary_zh 之類的自由文字推斷要改什麼）：
//   add_query / add_keyword / add_domain : { "add": "<一整行 / 關鍵字 / 網域>", "list": "latin|cjk|cjkPatterns"(僅 keyword) }
//   drop_query / drop_keyword            : { "remove": "<與區段內某行完全相同的字串>", "list": ... }
//   rephrase_query                       : { "replace": { "from": "<原行>", "to": "<新行>" } }
// 缺 patch 或 patch 不合法的提案只停在 evaluated（不改檔、不進 canary），並印出原因。
//
// 用法：node scripts/agent/apply-change.mjs [--dry-run] [--self-test] [--root DIR]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvent as ledgerAppend } from "./lib/ledger.mjs";
import { loadMetrics } from "./build-search-review-input.mjs";
import { IN_FLIGHT_STATUSES, IN_FLIGHT_WINDOW_DAYS, resolveSince } from "./build-change-eval-input.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..", "..");

export const SCHEMA = "apply-change-v0.1";
export const ACTOR = "change-evaluator";
export const APPLIER = "apply-change";

// ── 路徑白名單 ────────────────────────────────────────────────────────────────
// 可被「編輯」的目標檔（與 check-agent-outputs.mjs 的 AUTO_APPLY_ALLOWED_TARGETS 一致）。
export const EDIT_ALLOWLIST = [
  /^scripts\/prompts\/[a-z]+\.md$/,
  /^assets\/js\/config\.js$/,
  /^scripts\/tier-b-domains\.json$/,
];
// 本支自己的狀態檔（提案索引、提案明細、learning-status 的 proposal_count、.preview 產物）。
export const STATE_ALLOWLIST = [
  /^data\/agent\/proposals\.json$/,
  /^data\/agent\/proposals\/[A-Za-z0-9._-]+\.json$/,
  /^data\/agent\/learning-status\.json$/,
  /^data\/agent\/\.preview\/[A-Za-z0-9._\/-]+$/,
];
// 不論白名單怎麼寫，這些前綴永遠拒絕（雙重保險，白名單 regex 改壞也擋得住）。
export const HARD_DENY_PREFIXES = ["agents/_control/", "memory/", "skills/", ".github/", "hermes.project.yaml", "agents/"];

function toRel(root, p) {
  const abs = path.resolve(root, p);
  const rel = path.relative(root, abs).split(path.sep).join("/");
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`路徑逃出 repo：${p}`);
  return rel;
}
export function isEditTarget(rel) {
  if (HARD_DENY_PREFIXES.some((pre) => rel === pre || rel.startsWith(pre))) return false;
  return EDIT_ALLOWLIST.some((re) => re.test(rel));
}
export function isStatePath(rel) {
  if (HARD_DENY_PREFIXES.some((pre) => rel === pre || rel.startsWith(pre))) return false;
  return STATE_ALLOWLIST.some((re) => re.test(rel));
}
// 所有寫檔的唯一入口。回傳絕對路徑，讓呼叫端寫成 fs.writeFileSync(assertWritable(root, rel), ...)。
export function assertWritable(root, rel, { edit = false } = {}) {
  const r = toRel(root, rel);
  const ok = edit ? isEditTarget(r) : (isEditTarget(r) || isStatePath(r));
  if (!ok) throw new Error(`拒絕寫入白名單外的路徑：${r}`);
  return path.join(root, r);
}

// ── 小工具 ───────────────────────────────────────────────────────────────────
function readJsonIfExists(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}
function todayISO(now) { return (now || new Date()).toISOString().slice(0, 10); }
function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Number(((a[m - 1] + a[m]) / 2).toFixed(4));
}
function hasUrl(s) { return /https?:\/\//i.test(s); }
// 套進檔案的字串必須是一行、不含 marker、不含 URL、不含控制字元、長度合理。
export function validPayloadLine(s, { maxLen = 300 } = {}) {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (!t || t.length > maxLen) return false;
  if (/[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(t)) return false;
  if (t.includes("<!--") || t.includes("-->")) return false;
  if (hasUrl(t)) return false;
  return true;
}
function validKeyword(s) {
  return validPayloadLine(s, { maxLen: 80 }) && !/['"\\`$]/.test(s);
}
function validDomain(s) {
  return typeof s === "string" && /^[a-z0-9][a-z0-9.-]{0,120}\.[a-z]{2,}$/.test(s.trim());
}

// ── 區段編輯（純函式：吃整檔字串，回傳新字串；區段外的位元組不動）────────────
const MARKER = (name, kind) => `<!-- ${name}:${kind} -->`;

export function splitRegion(md, name) {
  const b = MARKER(name, "BEGIN"), e = MARKER(name, "END");
  const bi = md.indexOf(b), ei = md.indexOf(e);
  if (bi < 0 || ei < 0 || ei < bi) return null;
  const bodyStart = bi + b.length;
  return { head: md.slice(0, bodyStart), body: md.slice(bodyStart, ei), tail: md.slice(ei) };
}
// 區段 body 是「\n行\n行\n」的形式；把它拆成行陣列（去掉首尾的換行空行）。
function bodyLines(body) {
  const lines = body.split("\n");
  if (lines.length && lines[0] === "") lines.shift();
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
function joinBody(lines) { return lines.length ? `\n${lines.join("\n")}\n` : "\n"; }

// 回傳 { text, changed, op }；找不到區段或 patch 無效則丟錯。冪等：已存在的 add 不重複、不存在的 remove 不動。
export function editMarkerRegion(md, region, changeType, patch) {
  const parts = splitRegion(md, region);
  if (!parts) throw new Error(`找不到 <!-- ${region}:BEGIN/END --> 區段`);
  const lines = bodyLines(parts.body);
  let changed = false, op = "noop";
  if (changeType === "add_query") {
    const line = patch && patch.add;
    if (!validPayloadLine(line)) throw new Error("patch.add 不是合法的一行");
    if (!lines.some((l) => l.trim() === line.trim())) { lines.push(line.trim()); changed = true; op = "+1 line"; }
  } else if (changeType === "drop_query") {
    const target = patch && patch.remove;
    if (!validPayloadLine(target)) throw new Error("patch.remove 不是合法的一行");
    const idx = lines.findIndex((l) => l.trim() === target.trim());
    if (idx >= 0) { lines.splice(idx, 1); changed = true; op = "-1 line"; }
  } else if (changeType === "rephrase_query") {
    const from = patch && patch.replace && patch.replace.from, to = patch && patch.replace && patch.replace.to;
    if (!validPayloadLine(from) || !validPayloadLine(to)) throw new Error("patch.replace.from/to 不是合法的一行");
    const idx = lines.findIndex((l) => l.trim() === from.trim());
    if (idx >= 0 && lines[idx].trim() !== to.trim()) { lines[idx] = to.trim(); changed = true; op = "~1 line"; }
  } else {
    throw new Error(`區段 ${region} 不支援 change_type=${changeType}`);
  }
  return { text: parts.head + (changed ? joinBody(lines) : parts.body) + parts.tail, changed, op };
}

// config.js 的 PRIORITY_KEYWORDS：只動 const PRIORITY_KEYWORDS = { ... }; 這個區塊裡指定陣列的元素。
const PK_LISTS = new Set(["latin", "cjk", "cjkPatterns"]);
export function splitPriorityKeywords(js) {
  const start = js.indexOf("const PRIORITY_KEYWORDS = {");
  if (start < 0) return null;
  const end = js.indexOf("\n};", start);
  if (end < 0) return null;
  return { head: js.slice(0, start), body: js.slice(start, end + 3), tail: js.slice(end + 3) };
}
function findArray(body, list) {
  const re = new RegExp(`(\\n\\s*${list}:\\s*\\[)`);
  const m = re.exec(body);
  if (!m) return null;
  const open = m.index + m[0].length;
  const close = body.indexOf("]", open);
  if (close < 0) return null;
  return { open, close };
}
export function editPriorityKeywords(js, changeType, patch) {
  const parts = splitPriorityKeywords(js);
  if (!parts) throw new Error("找不到 const PRIORITY_KEYWORDS = { ... }; 區塊");
  const list = (patch && patch.list) || "latin";
  if (!PK_LISTS.has(list)) throw new Error(`patch.list 必須是 latin/cjk/cjkPatterns，收到 ${list}`);
  const value = changeType === "add_keyword" ? patch && patch.add : patch && patch.remove;
  if (!validKeyword(value)) throw new Error("關鍵字不合法（含引號／反斜線／URL／過長）");
  const arr = findArray(parts.body, list);
  if (!arr) throw new Error(`找不到 PRIORITY_KEYWORDS.${list} 陣列`);
  const inner = parts.body.slice(arr.open, arr.close);
  const token = `'${value}'`;
  const present = (inner.match(/'(?:[^'\\]|\\.)*'/g) || []).includes(token);
  let newInner = inner, changed = false, op = "noop";
  if (changeType === "add_keyword") {
    if (!present) {
      const trimmedEnd = inner.replace(/\s+$/, "");
      const trailingWs = inner.slice(trimmedEnd.length);
      newInner = trimmedEnd.trim() ? `${trimmedEnd},${token}${trailingWs}` : `${token}${trailingWs}`;
      changed = true; op = `+1 keyword (${list})`;
    }
  } else if (changeType === "drop_keyword") {
    if (present) {
      // 拿掉 token 以及它左邊或右邊的一個逗號（保持陣列語法正確）。
      newInner = inner.replace(new RegExp(`,\\s*${escapeRe(token)}(?=[\\s,\\]]|$)`), "");
      if (newInner === inner) newInner = inner.replace(new RegExp(`${escapeRe(token)}\\s*,\\s*`), "");
      if (newInner === inner) newInner = inner.replace(token, "");
      changed = true; op = `-1 keyword (${list})`;
    }
  } else {
    throw new Error(`PRIORITY_KEYWORDS 不支援 change_type=${changeType}`);
  }
  const body = parts.body.slice(0, arr.open) + newInner + parts.body.slice(arr.close);
  return { text: parts.head + body + parts.tail, changed, op };
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export function editTierBDomains(jsonText, changeType, patch) {
  if (changeType !== "add_domain") throw new Error(`tier-b-domains 只支援 add_domain，收到 ${changeType}`);
  const domain = String((patch && patch.add) || "").trim().toLowerCase();
  if (!validDomain(domain)) throw new Error("patch.add 不是合法網域");
  let doc = jsonText ? JSON.parse(jsonText) : null;
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.domains)) doc = { schema: "tier-b-domains-v0.1", domains: [] };
  if (doc.domains.includes(domain)) return { text: `${JSON.stringify(doc, null, 2)}\n`, changed: false, op: "noop" };
  doc.domains.push(domain);
  return { text: `${JSON.stringify(doc, null, 2)}\n`, changed: true, op: "+1 domain" };
}

// ── 配額（只從 canaries.json 讀）────────────────────────────────────────────
export function loadCanaries(root) {
  const c = readJsonIfExists(path.join(root, "agents/_control/canaries.json"));
  if (!c) return { present: false, enabled: false, weekly_cap: 0, per_category_cap: 0, canary_nights: null, revert_drop_pp: null };
  return {
    present: true,
    enabled: !!(c.auto_opt && c.auto_opt.enabled),
    weekly_cap: Number.isFinite(Number(c.weekly_cap)) ? Number(c.weekly_cap) : 0,
    per_category_cap: Number.isFinite(Number(c.per_category_cap)) ? Number(c.per_category_cap) : 0,
    canary_nights: c.canary_nights ?? null,
    revert_drop_pp: c.revert_drop_pp ?? null,
  };
}
// 週視窗內的 in-flight（evaluated / canary）：與 build-change-eval-input.mjs 同一把尺。
export function countInFlight(proposals, indexGeneratedAt, now) {
  const cutoff = new Date(now.getTime() - IN_FLIGHT_WINDOW_DAYS * 86400000);
  const byCat = {}; let total = 0;
  for (const p of proposals) {
    if (!IN_FLIGHT_STATUSES.has(p.status)) continue;
    const since = resolveSince(p, indexGeneratedAt);
    if (since && since < cutoff) continue;
    total += 1;
    const cat = p.category || "(none)";
    byCat[cat] = (byCat[cat] || 0) + 1;
  }
  return { total, byCat };
}

// ── baseline：該類別近 7 夜的中位數 ─────────────────────────────────────────
export function baselineFor(root, cat) {
  const m = loadMetrics(path.join(root, "data/agent/metrics-history.jsonl"), 7);
  const rows = (m.by_category && m.by_category[cat]) || [];
  return {
    verified_rate: median(rows.map((r) => r.verified_rate)),
    priority_hit_rate: median(rows.map((r) => r.priority_hit_rate)),
    nights: rows.length,
  };
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
function inputProposals(root) {
  // 提案本體來源：先看 search-review.json（原始、可能帶 patch），再看 change-eval-input.json（slim）。
  const review = readJsonIfExists(path.join(root, "data/agent/.preview/search-review.json"));
  const input = readJsonIfExists(path.join(root, "data/agent/.preview/change-eval-input.json"));
  const byId = new Map();
  for (const p of (input && Array.isArray(input.proposals) ? input.proposals : [])) if (p && p.proposal_id) byId.set(p.proposal_id, { ...p });
  for (const p of (review && Array.isArray(review.proposals) ? review.proposals : [])) {
    if (!p || !p.proposal_id) continue;
    const prev = byId.get(p.proposal_id) || {};
    byId.set(p.proposal_id, { ...prev, ...p });
  }
  return byId;
}

function targetForRegion(p) {
  const targets = Array.isArray(p.target_files) ? p.target_files : [];
  return targets[0] || null;
}

function upsertProposal(list, id, fields) {
  const idx = list.findIndex((p) => p && p.proposal_id === id);
  if (idx >= 0) { list[idx] = { ...list[idx], ...fields }; return list[idx]; }
  const rec = { proposal_id: id, ...fields };
  list.push(rec);
  return rec;
}

export function run(root, opts = {}) {
  const now = opts.now || new Date();
  const dryRun = !!opts.dryRun;
  const log = opts.log || ((s) => console.log(s));
  const appendEvent = dryRun ? () => null : (opts.appendEvent || ledgerAppend);
  const today = todayISO(now);
  const out = { schema: SCHEMA, dry_run: dryRun, evaluated: 0, rejected: 0, applied: 0, held: [], changed_files: [], events: [] };

  const canaries = loadCanaries(root);
  if (!canaries.present || !canaries.enabled) {
    log(`apply-change：auto_opt 未啟用（canaries.json ${canaries.present ? "auto_opt.enabled=false" : "不存在"}），只印不改。`);
    out.disabled = true;
    return out;
  }

  const evalPath = path.join(root, "data/agent/.preview/change-eval.json");
  const ev = readJsonIfExists(evalPath);
  const verdicts = ev && Array.isArray(ev.verdicts) ? ev.verdicts : [];
  if (!verdicts.length) { log("apply-change：沒有 change-eval.json 或 verdicts 為空，無事可做。"); out.no_input = true; return out; }

  const indexPath = path.join(root, "data/agent/proposals.json");
  const index = readJsonIfExists(indexPath) || { proposals: [] };
  if (!Array.isArray(index.proposals)) index.proposals = [];
  const proposals = index.proposals;
  const inputs = inputProposals(root);

  // 配額基準：併入 verdict 之前的 in-flight（今晚新 evaluated 的不算在自己頭上）。
  const inflight = countInFlight(proposals, index.generated_at, now);
  let weeklyRemaining = Math.max(0, canaries.weekly_cap - inflight.total);
  const catUsed = { ...inflight.byCat };

  // ① 併入裁定
  let indexDirty = false;
  const evaluatedNow = [];
  for (const v of verdicts) {
    const id = v && v.proposal_id; if (!id) continue;
    const verdict = v.verdict === "accept" ? "accept" : v.verdict === "reject" ? "reject" : null;
    if (!verdict) { log(`  ${id}：verdict=${v.verdict} 不是 accept/reject，略過`); continue; }
    const reasons = Array.isArray(v.reasons_zh) ? v.reasons_zh : Array.isArray(v.reasons) ? v.reasons : [];
    const existing = proposals.find((p) => p && p.proposal_id === id);
    const src = inputs.get(id) || {};
    const targets = Array.isArray(existing && existing.target_files) && existing.target_files.length
      ? existing.target_files : Array.isArray(src.target_files) ? src.target_files : [];
    if (!targets.length || !targets.every((t) => isEditTarget(t))) {
      log(`  ${id}：target_files 不在白名單（${targets.join(", ") || "空"}），不併入`); continue;
    }
    const newStatus = verdict === "accept" ? "evaluated" : "rejected";
    if (existing && existing.evaluated_at && (existing.status === newStatus || existing.status === "canary" || existing.status === "auto_applied" || existing.status === "reverted")) {
      // 已處理過（冪等）：不重寫、不重記帳。
      if (existing.status === "evaluated") evaluatedNow.push(existing);
      continue;
    }
    const evidence = Array.isArray(src.evidence) && src.evidence.length ? src.evidence.filter((e) => typeof e === "string" && !hasUrl(e))
      : Array.isArray(existing && existing.evidence) && existing.evidence.length ? existing.evidence : reasons.slice(0, 3);
    const fields = {
      category: (existing && existing.category) || src.category || null,
      region: (existing && existing.region) || src.region || null,
      change_type: (existing && existing.change_type) || src.change_type || null,
      target_files: targets,
      risk: (existing && existing.risk) || src.risk || null,
      summary_zh: (existing && existing.summary_zh) || src.summary_zh || "",
      evidence: evidence.length ? evidence : ["change-evaluator 裁定（無上游證據字串）"],
      expected_effect: (existing && existing.expected_effect) || src.expected_effect || null,
      patch: (existing && existing.patch) || src.patch || null,
      status: newStatus,
      evaluated_by: ACTOR,
      evaluated_at: now.toISOString(),
      verdict, reasons,
      requires_human_review: false,
      advisory_only: false,
      production_applied: false,
      proposed_by: (existing && existing.proposed_by) || src.proposed_by || "search-reviewer",
      created_at: (existing && existing.created_at) || src.created_at || now.toISOString(),
    };
    if (!dryRun) {
      const rec = upsertProposal(proposals, id, fields);
      indexDirty = true;
      if (newStatus === "evaluated") evaluatedNow.push(rec);
      out.events.push(appendEvent({ event_type: "proposal_evaluated", actor: ACTOR, subject_type: "proposal", subject_id: id, payload: { verdict, reasons, category: fields.category, change_type: fields.change_type } }));
    } else if (newStatus === "evaluated") {
      evaluatedNow.push({ proposal_id: id, ...fields });
    }
    if (newStatus === "evaluated") out.evaluated += 1; else out.rejected += 1;
    log(`  ${id}：${verdict} → ${newStatus}${dryRun ? "（dry-run，不寫）" : ""}`);
  }

  // ② 對 evaluated 且配額內的提案套用 patch
  const staged = new Set();
  for (const p of evaluatedNow) {
    const id = p.proposal_id;
    const cat = p.category || "(none)";
    if (weeklyRemaining <= 0) { out.held.push({ id, why: "週配額用盡" }); log(`  ${id}：週配額用盡，維持 evaluated`); continue; }
    if ((catUsed[cat] || 0) >= canaries.per_category_cap) { out.held.push({ id, why: `類別 ${cat} 配額用盡` }); log(`  ${id}：類別 ${cat} 配額用盡，維持 evaluated`); continue; }
    if (!p.patch || typeof p.patch !== "object") { out.held.push({ id, why: "無可套用的 patch" }); log(`  ${id}：無可套用的 patch，維持 evaluated`); continue; }
    const target = targetForRegion(p);
    let rel;
    try { rel = toRel(root, target); if (!isEditTarget(rel)) throw new Error("非白名單"); }
    catch (e) { out.held.push({ id, why: `目標檔拒絕：${e.message}` }); log(`  ${id}：${e.message}`); continue; }

    const abs = path.join(root, rel);
    const before = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
    let result, snapshot;
    try {
      if (rel.startsWith("scripts/prompts/")) {
        if (!["SEARCH_QUERIES", "PRIORITY"].includes(p.region)) throw new Error(`prompt 只允許 SEARCH_QUERIES / PRIORITY 區段，收到 ${p.region}`);
        const parts = splitRegion(before, p.region);
        if (!parts) throw new Error(`找不到區段 ${p.region}`);
        snapshot = { file: rel, region: p.region, before: parts.body };
        result = editMarkerRegion(before, p.region, p.change_type, p.patch);
      } else if (rel === "assets/js/config.js") {
        if (p.region !== "PRIORITY_KEYWORDS") throw new Error(`config.js 只允許 PRIORITY_KEYWORDS 區段，收到 ${p.region}`);
        const parts = splitPriorityKeywords(before);
        if (!parts) throw new Error("找不到 PRIORITY_KEYWORDS 區塊");
        snapshot = { file: rel, region: "PRIORITY_KEYWORDS", before: parts.body };
        result = editPriorityKeywords(before, p.change_type, p.patch);
      } else if (rel === "scripts/tier-b-domains.json") {
        if (p.region !== "TIER_B_DOMAINS") throw new Error(`tier-b-domains 只允許 TIER_B_DOMAINS 區段，收到 ${p.region}`);
        snapshot = { file: rel, region: "TIER_B_DOMAINS", before };
        result = editTierBDomains(before, p.change_type, p.patch);
      } else {
        throw new Error("未知的白名單目標");
      }
    } catch (e) {
      out.held.push({ id, why: `patch 無法套用：${e.message}` }); log(`  ${id}：patch 無法套用：${e.message}，維持 evaluated`); continue;
    }

    if (!result.changed) {
      // patch 內容已存在：沒有實際變更就沒有 canary 可觀察，不進 canary、不占配額。
      out.held.push({ id, why: "patch 內容已存在（noop）" }); log(`  ${id}：patch 內容已存在（noop），維持 evaluated、不占配額`); continue;
    }
    const baseline = baselineFor(root, p.category);
    const diffSummary = `${result.op} in ${rel}${snapshot.region ? ` [${snapshot.region}]` : ""}`;
    if (dryRun) {
      log(`  ${id}：dry-run，將套用 ${diffSummary}，不寫檔`);
      out.applied += 1; weeklyRemaining -= 1; catUsed[cat] = (catUsed[cat] || 0) + 1;
      continue;
    }
    // 先存快照（.preview 內），再改檔。
    const snapRel = `data/agent/.preview/apply-snapshots/${id}.json`;
    fs.mkdirSync(path.dirname(assertWritable(root, snapRel)), { recursive: true });
    fs.writeFileSync(assertWritable(root, snapRel), `${JSON.stringify({ schema: "apply-snapshot-v0.1", proposal_id: id, saved_at: now.toISOString(), ...snapshot }, null, 2)}\n`, "utf8");
    fs.writeFileSync(assertWritable(root, rel, { edit: true }), result.text, "utf8");
    staged.add(rel);
    Object.assign(p, {
      status: "canary", production_applied: true,
      canary_started: today, canary_started_at: now.toISOString(),
      baseline: { verified_rate: baseline.verified_rate, priority_hit_rate: baseline.priority_hit_rate, nights: baseline.nights },
      applied_by: APPLIER, diff_summary: diffSummary,
      rollback: { snapshot, note: "還原 snapshot.before 到同一區段即可回滾（canary-check.mjs 負責）" },
    });
    indexDirty = true;
    weeklyRemaining -= 1; catUsed[cat] = (catUsed[cat] || 0) + 1;
    out.applied += 1;
    out.events.push(appendEvent({ event_type: "proposal_auto_applied", actor: APPLIER, subject_type: "proposal", subject_id: id, payload: { target_files: [rel], diff_summary: diffSummary, canary_started: today, category: p.category, change_type: p.change_type, baseline: p.baseline } }));
    log(`  ${id}：已套用 ${diffSummary} → canary（起算 ${today}）`);
  }

  // ③ 落地索引 / 明細 / learning-status.proposal_count / staged.txt
  if (!dryRun) {
    if (indexDirty) {
      index.proposal_count = proposals.length;
      index.updated_at = now.toISOString();
      fs.writeFileSync(assertWritable(root, "data/agent/proposals.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
      for (const p of proposals) {
        if (!p || !p.proposal_id || !(p.evaluated_by === ACTOR)) continue;
        const detailRel = `data/agent/proposals/${p.proposal_id}.json`;
        fs.mkdirSync(path.dirname(assertWritable(root, detailRel)), { recursive: true });
        fs.writeFileSync(assertWritable(root, detailRel), `${JSON.stringify({ ...p, review_guidance: "由 change-evaluator 裁定、apply-change 套用；canary 期間由 canary-check.mjs 監看" }, null, 2)}\n`, "utf8");
      }
      const lsPath = path.join(root, "data/agent/learning-status.json");
      const ls = readJsonIfExists(lsPath);
      if (ls && typeof ls === "object") {
        ls.proposal_count = proposals.length;
        fs.writeFileSync(assertWritable(root, "data/agent/learning-status.json"), `${JSON.stringify(ls, null, 2)}\n`, "utf8");
      }
    }
    const stagedRel = "data/agent/.preview/apply-change-staged.txt";
    fs.mkdirSync(path.dirname(assertWritable(root, stagedRel)), { recursive: true });
    fs.writeFileSync(assertWritable(root, stagedRel), [...staged].map((s) => `${s}\n`).join(""), "utf8");
  }
  out.changed_files = [...staged];
  log(`apply-change：evaluated ${out.evaluated}、rejected ${out.rejected}、applied ${out.applied}、held ${out.held.length}、changed files ${out.changed_files.length}${dryRun ? "（dry-run）" : ""}`);
  return out;
}

// ── 自測 A-1..A-9 ────────────────────────────────────────────────────────────
function selfTest() {
  let fails = 0;
  const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) fails += 1; };
  const NOW = new Date("2026-09-05T10:00:00.000Z");
  const w = (root, rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text, "utf8"); };
  const r = (root, rel) => fs.readFileSync(path.join(root, rel), "utf8");

  const USA = "Search the web.\n\n<!-- SEARCH_QUERIES:BEGIN -->\n- q1 OR q2 2026\n- q3 2026\n<!-- SEARCH_QUERIES:END -->\n\n<!-- PRIORITY:BEGIN -->\n1. Agent\n2. LLM\n<!-- PRIORITY:END -->\n\nOutput JSON.\n";
  const MODELS = "Cumulative.\n\n<!-- PRIORITY:BEGIN -->\nPriority topics: agent models.\n<!-- PRIORITY:END -->\n\n<!-- SEARCH_QUERIES:BEGIN -->\nSearch: Hugging Face, LMSYS\n<!-- SEARCH_QUERIES:END -->\n";
  const CONFIG = "const X = 1;\nconst PRIORITY_KEYWORDS = {\n  latin: [\n    'ai agent','agentic',\n    'openai'\n  ],\n  cjk: [\n    '資安','漏洞'\n  ],\n  cjkPatterns: ['Agent.*評','代理.*評']\n};\nfunction f(){}\n";
  const METRICS = ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"].map((d, i) =>
    JSON.stringify({ schema: "category-metrics-v0.1", date: d, cat: "usa", items: 20, verified_rate: 0.7 + i * 0.01, priority_hit_rate: 0.8, validation_pass_rate: 95 })).join("\n") + "\n";

  const setup = (over = {}) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "apply-change-"));
    w(root, "scripts/prompts/usa.md", USA);
    w(root, "scripts/prompts/models.md", MODELS);
    w(root, "assets/js/config.js", CONFIG);
    w(root, "agents/_control/canaries.json", JSON.stringify(over.canaries || { weekly_cap: 3, per_category_cap: 1, canary_nights: 3, revert_drop_pp: 10, auto_opt: { enabled: true } }));
    w(root, "data/agent/metrics-history.jsonl", METRICS);
    w(root, "data/agent/learning-status.json", JSON.stringify({ mode: "auto-opt-v2", proposal_count: 1 }));
    w(root, "data/agent/proposals.json", JSON.stringify({ generated_at: "2026-09-05T09:00:00Z", proposal_count: 1, proposals: over.proposals || [
      { proposal_id: "prop-legacy", status: "pending_review", target_files: ["scripts/prompts/usa.md"], evidence: ["e"], requires_human_review: true, advisory_only: true, production_applied: false },
    ] }));
    const props = over.inputs || [
      { proposal_id: "SP-001", category: "usa", region: "SEARCH_QUERIES", change_type: "add_query", target_files: ["scripts/prompts/usa.md"], risk: "low", status: "pending_review", summary_zh: "加一條 agent eval 查詢", evidence: ["usa 近 7 夜 priority_hit_rate 0.62"], patch: { add: "- \"agent eval\" OR \"agentbench\" 2026" } },
    ];
    w(root, "data/agent/.preview/search-review.json", JSON.stringify({ schema: "agent-search-review-v0.1", proposals: props }));
    w(root, "data/agent/.preview/change-eval.json", JSON.stringify({ schema: "agent-change-eval-v0.1", verdicts: over.verdicts || [
      { proposal_id: "SP-001", verdict: "accept", reasons_zh: ["符合 R1"], rubric_hits: ["R1"], security_flag: false },
    ] }));
    return root;
  };
  const events = [];
  const opts = { now: NOW, log: () => {}, appendEvent: (e) => { events.push(e); return e; } };

  // A-1 區段外位元組完全相同；A-7 帳本事件完整且無 title/URL；A-8 冪等
  {
    events.length = 0;
    const root = setup();
    const res = run(root, opts);
    const after = r(root, "scripts/prompts/usa.md");
    const pa = splitRegion(USA, "SEARCH_QUERIES"), pb = splitRegion(after, "SEARCH_QUERIES");
    check("A-1 區段外（head/tail）位元組完全相同", pa.head === pb.head && pa.tail === pb.tail && after.includes("agentbench") && res.applied === 1);
    const idx = JSON.parse(r(root, "data/agent/proposals.json"));
    const sp = idx.proposals.find((p) => p.proposal_id === "SP-001");
    check("A-1b 提案進 canary，帶 canary_started / baseline / rollback.snapshot", sp && sp.status === "canary" && sp.canary_started === "2026-09-05" && sp.baseline.verified_rate === 0.725 && sp.rollback.snapshot.before === pa.body && sp.production_applied === true && sp.evaluated_by === ACTOR);
    check("A-1c staged.txt 只列實際改過的檔", r(root, "data/agent/.preview/apply-change-staged.txt") === "scripts/prompts/usa.md\n");
    check("A-1d proposal_count 同步到 learning-status.json 與明細檔存在", JSON.parse(r(root, "data/agent/learning-status.json")).proposal_count === 2 && fs.existsSync(path.join(root, "data/agent/proposals/SP-001.json")));
    const types = events.map((e) => e.event_type);
    const blob = JSON.stringify(events);
    check("A-7 帳本事件 proposal_evaluated + proposal_auto_applied 齊全", types.join(",") === "proposal_evaluated,proposal_auto_applied" && events[1].payload.target_files[0] === "scripts/prompts/usa.md" && events[1].payload.canary_started === "2026-09-05" && events[0].payload.verdict === "accept");
    check("A-7b 帳本 payload 無 title / url / URL 字串", !/"title"|"url"|https?:\/\//i.test(blob));
    events.length = 0;
    const res2 = run(root, opts);
    const after2 = r(root, "scripts/prompts/usa.md");
    check("A-8 同一提案跑第二次：檔案不變、不重記帳、不重套用", after2 === after && events.length === 0 && res2.applied === 0 && (after2.match(/agentbench/g) || []).length === 1);
    fs.rmSync(root, { recursive: true, force: true });
  }
  // A-2 非白名單路徑拒絕；A-3 agents/_control/** 拒絕
  {
    const root = setup();
    let e2 = null, e3 = null, e3b = null;
    try { assertWritable(root, "scripts/run-daily.sh", { edit: true }); } catch (e) { e2 = e; }
    try { assertWritable(root, "agents/_control/canaries.json"); } catch (e) { e3 = e; }
    try { assertWritable(root, "agents/change-evaluator/memory/precedents.jsonl"); } catch (e) { e3b = e; }
    check("A-2 非白名單路徑（scripts/run-daily.sh）被拒", !!e2 && !isEditTarget("scripts/run-daily.sh") && !isEditTarget("../x.md") && !isEditTarget("scripts/prompts/../run-daily.sh"));
    check("A-3 agents/_control/** 與 agents/*/memory/** 被拒", !!e3 && !!e3b && !isEditTarget("agents/_control/canaries.json") && !isStatePath("agents/_control/canaries.json"));
    // 提案 target 指到白名單外 → 不併入、檔案不動
    const bad = setup({ inputs: [{ proposal_id: "SP-009", category: "usa", region: "SEARCH_QUERIES", change_type: "add_query", target_files: ["agents/_control/canaries.json"], evidence: ["e"], patch: { add: "- x" } }], verdicts: [{ proposal_id: "SP-009", verdict: "accept", reasons_zh: ["r"] }] });
    const cBefore = r(bad, "agents/_control/canaries.json");
    const resBad = run(bad, opts);
    check("A-3b 提案 target 指向 agents/_control → 不併入、檔案未動", r(bad, "agents/_control/canaries.json") === cBefore && resBad.evaluated === 0 && resBad.applied === 0);
    fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(bad, { recursive: true, force: true });
  }
  // A-4 超配額維持 evaluated、檔案不動
  {
    events.length = 0;
    const root = setup({
      proposals: [{ proposal_id: "SP-000", category: "usa", status: "canary", canary_started_at: "2026-09-03T10:00:00Z", target_files: ["scripts/prompts/usa.md"], evidence: ["e"], evaluated_by: ACTOR, production_applied: true }],
    });
    const res = run(root, opts);
    const idx = JSON.parse(r(root, "data/agent/proposals.json"));
    const sp = idx.proposals.find((p) => p.proposal_id === "SP-001");
    check("A-4 類別配額已被 canary 占用 → 新提案停在 evaluated、檔案未動", sp.status === "evaluated" && r(root, "scripts/prompts/usa.md") === USA && res.applied === 0 && res.held.length === 1 && events.length === 1);
    fs.rmSync(root, { recursive: true, force: true });
    const root2 = setup({ canaries: { weekly_cap: 0, per_category_cap: 1, auto_opt: { enabled: true } } });
    const res2 = run(root2, opts);
    check("A-4b weekly_cap=0（只從 canaries.json 讀）→ 不套用", res2.applied === 0 && r(root2, "scripts/prompts/usa.md") === USA);
    fs.rmSync(root2, { recursive: true, force: true });
  }
  // A-5 auto_opt.enabled=false → 零寫入（連 proposals.json 都不動）
  {
    events.length = 0;
    const root = setup({ canaries: { weekly_cap: 3, per_category_cap: 1, auto_opt: { enabled: false } } });
    const idxBefore = r(root, "data/agent/proposals.json");
    const res = run(root, opts);
    check("A-5 auto_opt.enabled=false → 零寫入、零帳本", res.disabled === true && r(root, "data/agent/proposals.json") === idxBefore && r(root, "scripts/prompts/usa.md") === USA && events.length === 0 && !fs.existsSync(path.join(root, "data/agent/.preview/apply-change-staged.txt")));
    fs.rmSync(root, { recursive: true, force: true });
    // dry-run：不改檔、不寫帳本、不寫 staged
    const root2 = setup();
    const idxBefore2 = r(root2, "data/agent/proposals.json");
    const res2 = run(root2, { ...opts, dryRun: true });
    check("A-5b --dry-run 不改任何檔、不寫帳本", res2.applied === 1 && r(root2, "data/agent/proposals.json") === idxBefore2 && r(root2, "scripts/prompts/usa.md") === USA && events.length === 0 && !fs.existsSync(path.join(root2, "data/agent/.preview/apply-change-staged.txt")));
    fs.rmSync(root2, { recursive: true, force: true });
  }
  // A-6 快照還原後位元組相同（prompt / config / tier-b 三種）
  {
    const root = setup();
    run(root, opts);
    const idx = JSON.parse(r(root, "data/agent/proposals.json"));
    const sp = idx.proposals.find((p) => p.proposal_id === "SP-001");
    const after = r(root, "scripts/prompts/usa.md");
    const parts = splitRegion(after, "SEARCH_QUERIES");
    const restored = parts.head + sp.rollback.snapshot.before + parts.tail;
    check("A-6 用 rollback.snapshot 還原 prompt 區段 → 與原檔位元組相同", restored === USA);
    const snapFile = JSON.parse(r(root, "data/agent/.preview/apply-snapshots/SP-001.json"));
    check("A-6b .preview/apply-snapshots/<id>.json 與索引內快照一致", snapFile.before === sp.rollback.snapshot.before);
    fs.rmSync(root, { recursive: true, force: true });
    // config.js：加 keyword 再用 drop 還原
    const add = editPriorityKeywords(CONFIG, "add_keyword", { add: "agent harness", list: "latin" });
    const drop = editPriorityKeywords(add.text, "drop_keyword", { remove: "agent harness", list: "latin" });
    const pk = splitPriorityKeywords(CONFIG), pk2 = splitPriorityKeywords(add.text);
    check("A-6c config.js add_keyword 只動 PRIORITY_KEYWORDS 區塊，drop 後位元組還原", add.changed && add.text.includes("'openai','agent harness'") && pk.head === pk2.head && pk.tail === pk2.tail && drop.text === CONFIG);
    const addC = editPriorityKeywords(CONFIG, "add_keyword", { add: "Agent治理", list: "cjk" });
    const addP = editPriorityKeywords(CONFIG, "add_keyword", { add: "Agent.*治理", list: "cjkPatterns" });
    check("A-6d cjk / cjkPatterns 也只在陣列內追加", addC.text.includes("'漏洞','Agent治理'") && addP.text.includes("'代理.*評','Agent.*治理']") && editPriorityKeywords(addC.text, "add_keyword", { add: "Agent治理", list: "cjk" }).changed === false);
    let badKw = null; try { editPriorityKeywords(CONFIG, "add_keyword", { add: "x'); alert(1); ('", list: "latin" }); } catch (e) { badKw = e; }
    check("A-6e 含引號的關鍵字被拒（不會破壞 config.js 語法）", !!badKw);
    const tb = editTierBDomains("", "add_domain", { add: "Example.ORG" });
    const tb2 = editTierBDomains(tb.text, "add_domain", { add: "example.org" });
    check("A-6f tier-b-domains 缺檔時建立 v0.1 骨架、只 append、冪等", tb.changed && JSON.parse(tb.text).schema === "tier-b-domains-v0.1" && JSON.parse(tb.text).domains[0] === "example.org" && tb2.changed === false);
    let badDom = null; try { editTierBDomains("", "add_domain", { add: "https://evil.example" }); } catch (e) { badDom = e; }
    check("A-6g 非網域字串（URL）被拒", !!badDom);
  }
  // A-9 models.md PRIORITY 在前的順序不受影響
  {
    const root = setup({
      inputs: [{ proposal_id: "SP-002", category: "models", region: "SEARCH_QUERIES", change_type: "add_query", target_files: ["scripts/prompts/models.md"], evidence: ["e"], patch: { add: "Also search: Open LLM Leaderboard" } }],
      verdicts: [{ proposal_id: "SP-002", verdict: "accept", reasons_zh: ["r"] }],
    });
    run(root, opts);
    const after = r(root, "scripts/prompts/models.md");
    const pOrig = splitRegion(MODELS, "PRIORITY"), pAfter = splitRegion(after, "PRIORITY");
    check("A-9 models.md PRIORITY 區段在前且內容不變，SEARCH_QUERIES 只多一行", after.indexOf("PRIORITY:BEGIN") < after.indexOf("SEARCH_QUERIES:BEGIN") && pOrig.body === pAfter.body && after.startsWith(MODELS.slice(0, MODELS.indexOf("<!-- SEARCH_QUERIES:END -->"))) && after.includes("Open LLM Leaderboard\n<!-- SEARCH_QUERIES:END -->"));
    // 無 patch 的提案：維持 evaluated、不改檔
    const root2 = setup({ inputs: [{ proposal_id: "SP-003", category: "usa", region: "SEARCH_QUERIES", change_type: "add_query", target_files: ["scripts/prompts/usa.md"], evidence: ["e"] }], verdicts: [{ proposal_id: "SP-003", verdict: "accept", reasons_zh: ["r"] }] });
    const res2 = run(root2, opts);
    const sp3 = JSON.parse(r(root2, "data/agent/proposals.json")).proposals.find((p) => p.proposal_id === "SP-003");
    check("A-9b 無 patch 的 accept → 停在 evaluated、檔案未動", sp3.status === "evaluated" && res2.held[0].why === "無可套用的 patch" && r(root2, "scripts/prompts/usa.md") === USA);
    // reject → rejected
    const root3 = setup({ verdicts: [{ proposal_id: "SP-001", verdict: "reject", reasons_zh: ["R4 風險"] }] });
    const res3 = run(root3, opts);
    const sp1 = JSON.parse(r(root3, "data/agent/proposals.json")).proposals.find((p) => p.proposal_id === "SP-001");
    check("A-9c reject → rejected、production_applied=false、檔案未動", sp1.status === "rejected" && sp1.production_applied === false && sp1.reasons[0] === "R4 風險" && res3.applied === 0 && r(root3, "scripts/prompts/usa.md") === USA);
    // drop / rephrase 也只動區段內
    const d = editMarkerRegion(USA, "SEARCH_QUERIES", "drop_query", { remove: "- q3 2026" });
    const rp = editMarkerRegion(USA, "SEARCH_QUERIES", "rephrase_query", { replace: { from: "- q1 OR q2 2026", to: "- q1 OR q2 OR q9 2026" } });
    check("A-9d drop_query / rephrase_query 只動區段內、其餘位元組相同", d.changed && !d.text.includes("- q3 2026") && splitRegion(d.text, "SEARCH_QUERIES").tail === splitRegion(USA, "SEARCH_QUERIES").tail && rp.changed && rp.text.includes("q9") && splitRegion(rp.text, "PRIORITY").body === splitRegion(USA, "PRIORITY").body);
    let badLine = null; try { editMarkerRegion(USA, "SEARCH_QUERIES", "add_query", { add: "see https://evil.example" }); } catch (e) { badLine = e; }
    let badMarker = null; try { editMarkerRegion(USA, "SEARCH_QUERIES", "add_query", { add: "<!-- PRIORITY:END -->" }); } catch (e) { badMarker = e; }
    check("A-9e 含 URL 或 marker 的行被拒", !!badLine && !!badMarker);
    for (const x of [root, root2, root3]) fs.rmSync(x, { recursive: true, force: true });
  }
  console.log(fails ? `\n${fails} 項失敗` : "\napply-change 自測全綠");
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
      console.error(`apply-change 失敗：${e && e.message ? e.message : e}`);
      process.exit(1);
    }
  }
}
