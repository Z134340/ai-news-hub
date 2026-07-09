#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const selfTestBoundary = args.has("--self-test-boundary");

const REQUIRED_BOUNDARIES = [
  "agent_outputs_advisory_only",
  "no_direct_prompt_patch",
  "raw_feedback_off_repo",
  "human_review_required_for_proposals",
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

function assertBoundaryList(name, values, required) {
  const present = new Set(asArray(values));
  for (const boundary of required) {
    if (!present.has(boundary)) fail(`${name} missing boundary: ${boundary}`);
  }
}

function validateLearningStatus() {
  const status = readJson("data/agent/learning-status.json");
  if (strict && status.mode !== "ranking-only") fail("learning-status.mode must be ranking-only");
  if (!Number.isFinite(Number(status.proposal_count))) fail("learning-status.proposal_count must be numeric");
  assertBoundaryList("learning-status.active_boundaries", status.active_boundaries, REQUIRED_BOUNDARIES);
  if (status.last_error) fail(`learning-status.last_error is set: ${status.last_error}`);
  return status;
}

function validateProposal(proposal, index) {
  const id = proposal.proposal_id || `proposal[${index}]`;
  if (!proposal.proposal_id) fail(`proposal[${index}] missing proposal_id`);
  if (proposal.status !== "pending_review") fail(`${id} must remain pending_review`);
  if (proposal.requires_human_review !== true) fail(`${id} must require human review`);
  if (proposal.advisory_only !== true) fail(`${id} must be advisory_only`);
  if (proposal.production_applied !== false) fail(`${id} must not be production_applied`);
  for (const target of asArray(proposal.target_files)) {
    if (isBlockedTarget(target)) fail(`${id} targets blocked path: ${target}`);
  }
  if (!asArray(proposal.evidence).length) fail(`${id} must include sanitized evidence`);
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
  const cases = [
    ["B-1 prompt proposal pending", { status: "pending_review", requires_human_review: true, advisory_only: true, production_applied: false }, true],
    ["B-2 prompt proposal applied", { status: "applied", requires_human_review: true, advisory_only: true, production_applied: true }, false],
    ["B-3 missing human review", { status: "pending_review", requires_human_review: false, advisory_only: true, production_applied: false }, false],
    ["B-4 blocked target", { status: "pending_review", requires_human_review: true, advisory_only: true, production_applied: false, target_files: ["data/latest.json"], evidence: [{}] }, false],
    ["B-5 safe target", { status: "pending_review", requires_human_review: true, advisory_only: true, production_applied: false, target_files: ["scripts/prompts/models.md"], evidence: [{}] }, true],
    ["B-6 skill proposal manual-only", { production_applied: false, requires_human_review: true, manual_only: true, target_files: ["SKILL.md"] }, true],
    ["B-7 skill proposal auto-applied", { production_applied: true, requires_human_review: true, manual_only: true, target_files: ["SKILL.md"] }, false],
    ["B-8 skill tool scope change blocked", { production_applied: false, requires_human_review: true, manual_only: true, target_files: [".github/workflows/deploy.yml"] }, false],
  ];
  for (const [label, proposal, expected] of cases) {
    let ok = true;
    try {
      if (label.startsWith("B-") && Number(label.slice(2, 3)) <= 5) {
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
  if (selfTestBoundary) console.log("boundary self-test cases checked: B-1..B-8");
  console.log(`skill proposals checked: ${asArray(skillStatus.proposals).length}`);
  console.log("agent output check passed");
} catch (error) {
  console.error(`agent output check failed: ${error.message}`);
  process.exit(1);
}
