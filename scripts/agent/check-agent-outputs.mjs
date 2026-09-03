#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const selfTestBoundary = args.has("--self-test-boundary");

// contract v2（2026-09，僅限本 repo；Hermes 真本不動）：
// 人審只保留給 memory/** 與 skills；prompt 區段、PRIORITY_KEYWORDS、Tier B 網域
// 走 change-evaluator 閘門後自動套用，套用後進 canary 觀察，退化即 revert。
const REQUIRED_BOUNDARIES = [
  "agent_outputs_advisory_only",
  "no_direct_prompt_patch",
  "raw_feedback_off_repo",
  "human_review_required_for_memory_and_skills",
  "evaluator_gated_auto_apply",
];

const ALLOWED_MODES = new Set(["ranking-only", "auto-opt-v2"]);
const ALLOWED_STATUSES = new Set(["pending_review", "evaluated", "rejected", "auto_applied", "canary", "reverted"]);
const APPLIED_STATUSES = new Set(["auto_applied", "canary"]);

// 機器可自動改的檔案白名單。只有「資料化」的區段能進來：prompt 的 marker 區段、
// 前端優先關鍵字陣列、Tier B 網域清單。控制檔 agents/_control/** 刻意不在名單內，
// 機器不能調自己的閘門門檻與 kill switch。
const AUTO_APPLY_ALLOWED_TARGETS = [
  /^scripts\/prompts\/[a-z]+\.md$/,
  /^assets\/js\/config\.js$/,
  /^scripts\/tier-b-domains\.json$/,
];

const REQUIRED_SKILL_BOUNDARIES = [
  "ranking_only",
  "proposal_only_skill_patch",
  "no_direct_skill_patch",
  "no_tool_scope_change",
  "raw_feedback_off_repo",
];

const BLOCKED_TARGETS = [
  ".env",
  "secrets/",
  "firebase.json",
  "firestore.rules",
  ".github/workflows/deploy.yml",
  "data/latest.json",
  "data/index.json",
];

function fail(message) {
  throw new Error(message);
}

function readJson(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) fail(`missing required output: ${relativePath}`);
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (error) {
    fail(`invalid JSON: ${relativePath}: ${error.message}`);
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isBlockedTarget(target) {
  const cleaned = String(target || "").replace(/^\.\/+/, "");
  return BLOCKED_TARGETS.some((blocked) => {
    if (blocked.endsWith("/")) return cleaned.startsWith(blocked);
    return cleaned === blocked || cleaned.startsWith(`${blocked}/`);
  });
}

function isAutoApplyTarget(target) {
  const cleaned = String(target || "").replace(/^\.\/+/, "");
  return AUTO_APPLY_ALLOWED_TARGETS.some((re) => re.test(cleaned));
}

function assertBoundaryList(name, values, required) {
  const present = new Set(asArray(values));
  for (const boundary of required) {
    if (!present.has(boundary)) fail(`${name} missing boundary: ${boundary}`);
  }
}

function validateLearningStatus() {
  const status = readJson("data/agent/learning-status.json");
  if (strict && !ALLOWED_MODES.has(status.mode)) fail(`learning-status.mode must be one of ${[...ALLOWED_MODES].join("/")}`);
  if (!Number.isFinite(Number(status.proposal_count))) fail("learning-status.proposal_count must be numeric");
  assertBoundaryList("learning-status.active_boundaries", status.active_boundaries, REQUIRED_BOUNDARIES);
  if (status.last_error) fail(`learning-status.last_error is set: ${status.last_error}`);
  return status;
}

function validateProposal(proposal, index) {
  const id = proposal.proposal_id || `proposal[${index}]`;
  if (!proposal.proposal_id) fail(`proposal[${index}] missing proposal_id`);
  const status = proposal.status;
  if (!ALLOWED_STATUSES.has(status)) fail(`${id} has unknown status: ${status}`);
  const targets = asArray(proposal.target_files);
  for (const target of targets) {
    if (isBlockedTarget(target)) fail(`${id} targets blocked path: ${target}`);
  }
  if (!asArray(proposal.evidence).length) fail(`${id} must include sanitized evidence`);

  // 路徑一：待人審。完全沿用 v1 的四項硬性要求。
  if (status === "pending_review") {
    if (proposal.requires_human_review !== true) fail(`${id} pending_review must require human review`);
    if (proposal.advisory_only !== true) fail(`${id} pending_review must be advisory_only`);
    if (proposal.production_applied !== false) fail(`${id} pending_review must not be production_applied`);
    return;
  }

  // 路徑二：機器閘門。離開 pending_review 的唯一合法方式是 change-evaluator 簽章，
  // 而且每一個目標檔都在白名單內；production_applied 只能出現在 auto_applied / canary。
  if (!proposal.evaluated_by) fail(`${id} ${status} requires evaluated_by`);
  if (!targets.length) fail(`${id} ${status} must list target_files`);
  for (const target of targets) {
    if (!isAutoApplyTarget(target)) fail(`${id} ${status} targets non-allowlisted path: ${target}`);
  }
  if (APPLIED_STATUSES.has(status) && proposal.production_applied !== true) fail(`${id} ${status} must be production_applied`);
  if (!APPLIED_STATUSES.has(status) && proposal.production_applied !== false) fail(`${id} ${status} must not be production_applied`);
}

function validateProposalsIndex(status) {
  const index = readJson("data/agent/proposals.json");
  const proposals = asArray(index.proposals);
  if (!proposals.length) fail("proposals.json must include proposals[]");
  proposals.forEach(validateProposal);
  if (strict && Number(status.proposal_count) !== proposals.length) {
    fail(`proposal_count mismatch: status=${status.proposal_count}, proposals=${proposals.length}`);
  }
  for (const proposal of proposals) {
    const detailPath = `data/agent/proposals/${proposal.proposal_id}.json`;
    if (!fs.existsSync(path.join(ROOT, detailPath))) fail(`missing proposal detail: ${detailPath}`);
  }
  return proposals;
}

function validateAgentOutputFiles() {
  for (const file of [
    "data/agent/trends.json",
    "data/agent/recommendations.json",
    "data/agent/candidates.json",
  ]) {
    readJson(file);
  }
}

function validateSkillStatus() {
  const status = readJson("data/agent/skills/ai-news-hub.agent-insights/learning-status.json");
  if (status.schema_version !== "skill-learning-status-v1") fail("skill status schema_version must be skill-learning-status-v1");
  if (status.skill_id !== "ai-news-hub.agent-insights") fail("skill status skill_id mismatch");
  if (status.mode !== "shadow") fail("skill mode must be shadow");
  if (status.shared_learning !== "ranking_only") fail("skill shared_learning must be ranking_only");
  if (status.eval_status !== "passed") fail("skill eval_status must be passed");
  assertBoundaryList("skill.active_boundaries", status.active_boundaries, REQUIRED_SKILL_BOUNDARIES);
  for (const proposal of asArray(status.proposals)) {
    const id = proposal.proposal_id || "skill proposal";
    if (proposal.production_applied !== false) fail(`${id} must not be production_applied`);
    if (proposal.requires_human_review !== true) fail(`${id} must require human review`);
    if (proposal.manual_only !== true) fail(`${id} must be manual_only`);
    for (const target of asArray(proposal.target_files)) {
      if (isBlockedTarget(target)) fail(`${id} targets blocked path: ${target}`);
    }
  }
  return status;
}

function validateBoundarySelfTests() {
  const P = "proposal", S = "skill";
  const pend = { status: "pending_review", requires_human_review: true, advisory_only: true, production_applied: false };
  const auto = { status: "auto_applied", requires_human_review: false, advisory_only: false, production_applied: true, evaluated_by: "change-evaluator" };
  const cases = [
    ["B-1 prompt proposal pending", P, pend, true],
    ["B-2 legacy status applied", P, { ...pend, status: "applied", production_applied: true }, false],
    ["B-3 pending missing human review", P, { ...pend, requires_human_review: false }, false],
    ["B-4 blocked target", P, { ...pend, target_files: ["data/latest.json"] }, false],
    ["B-5 safe target", P, { ...pend, target_files: ["scripts/prompts/models.md"] }, true],
    ["B-6 skill proposal manual-only", S, { production_applied: false, requires_human_review: true, manual_only: true, target_files: ["SKILL.md"] }, true],
    ["B-7 skill proposal auto-applied", S, { production_applied: true, requires_human_review: true, manual_only: true, target_files: ["SKILL.md"] }, false],
    ["B-8 skill tool scope change blocked", S, { production_applied: false, requires_human_review: true, manual_only: true, target_files: [".github/workflows/deploy.yml"] }, false],
    ["B-9 auto_applied evaluated allowlisted", P, { ...auto, target_files: ["scripts/prompts/topnews.md"] }, true],
    ["B-10 auto_applied without evaluated_by", P, { ...auto, evaluated_by: "", target_files: ["scripts/prompts/topnews.md"] }, false],
    ["B-11 auto_applied non-allowlisted target", P, { ...auto, target_files: ["scripts/run-daily.sh"] }, false],
    ["B-12 pending marked production_applied", P, { ...pend, production_applied: true }, false],
    ["B-13 canary on config.js", P, { ...auto, status: "canary", target_files: ["assets/js/config.js"] }, true],
    ["B-14 auto path touching _control blocked", P, { ...auto, target_files: ["agents/_control/canaries.json"] }, false],
    ["B-15 reverted must not stay applied", P, { ...auto, status: "reverted", target_files: ["scripts/prompts/usa.md"] }, false],
  ];
  for (const [label, kind, proposal, expected] of cases) {
    let ok = true;
    try {
      if (kind === P) {
        validateProposal({ proposal_id: label, evidence: [{}], target_files: [], ...proposal }, 0);
      } else {
        if (proposal.production_applied !== false) fail("skill proposal applied");
        if (proposal.requires_human_review !== true) fail("skill proposal missing review");
        if (proposal.manual_only !== true) fail("skill proposal not manual-only");
        for (const target of asArray(proposal.target_files)) {
          if (isBlockedTarget(target)) fail("skill proposal blocked target");
        }
      }
    } catch (_) {
      ok = false;
    }
    if (ok !== expected) fail(`boundary self-test failed: ${label}`);
  }
}

try {
  const status = validateLearningStatus();
  const proposals = validateProposalsIndex(status);
  validateAgentOutputFiles();
  const skillStatus = validateSkillStatus();
  if (selfTestBoundary) validateBoundarySelfTests();
  console.log(`proposal files checked: ${proposals.length}`);
  if (selfTestBoundary) console.log("boundary self-test cases checked: B-1..B-15");
  console.log(`skill proposals checked: ${asArray(skillStatus.proposals).length}`);
  console.log("agent output check passed");
} catch (error) {
  console.error(`agent output check failed: ${error.message}`);
  process.exit(1);
}
