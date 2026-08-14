#!/usr/bin/env node
/**
 * ANH-006 public-preview review packet builder.
 *
 * Produces a content-addressed, hash-only evidence packet under .preview.
 * The packet prepares an exact Owner approve/reject request; it never records
 * a decision and never promotes or mutates public artifacts.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildCurrentStateManifest } from "./build-current-state-manifest.mjs";
import { buildSystemStatus } from "./build-system-status.mjs";
import {
  CANDIDATE_PATHS,
  evaluateFreshnessRelease,
} from "./freshness-release-gate.mjs";

export const REVIEW_PACKET_SCHEMA_VERSION = "public-preview-review-packet-v1";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "../..");
const DEFAULT_SCHEMA = join(ROOT, "schemas/system-status-v1.schema.json");

function sha256(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(canonical(value))}\n`, "utf8");
}

function validSha(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validCommit(value) {
  return typeof value === "string" && /^[a-f0-9]{40,64}$/.test(value);
}

function fileEvidence(path) {
  if (!existsSync(path)) return { status: "missing", sha256: null, bytes: null };
  const stat = statSync(path);
  if (!stat.isFile()) return { status: "invalid_type", sha256: null, bytes: null };
  const raw = readFileSync(path);
  return { status: "available", sha256: sha256(raw), bytes: raw.byteLength };
}

function repoCommit(rootDir) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function repoWorktreeState(rootDir) {
  try {
    const output = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trimEnd();
    const changes = output ? output.split("\n").map((line) => ({
      status: line.slice(0, 2),
      path: line.slice(3).split(" -> ").at(-1),
    })) : [];
    return { clean: changes.length === 0, changes };
  } catch {
    return { clean: null, changes: [] };
  }
}

function assertPacket(packet) {
  const failures = [];
  if (packet.schema_version !== REVIEW_PACKET_SCHEMA_VERSION) failures.push("schema_version");
  if (!/^anh-review-[a-f0-9]{16}$/.test(packet.request_id || "")) failures.push("request_id");
  for (const field of ["candidate_hash", "diff_hash", "report_hash"]) {
    if (!validSha(packet.hashes?.[field])) failures.push(field);
  }
  if (packet.authority?.publish_authority !== "owner_only"
    || packet.authority?.manual_only !== true
    || packet.authority?.advisory !== true
    || packet.authority?.production_write !== false) failures.push("authority");
  if (packet.decision_contract?.vague_reply_valid !== false
    || packet.decision_contract?.stale_hash_action !== "block") failures.push("decision_contract");
  if (!Array.isArray(packet.candidate?.artifacts)
    || packet.candidate.artifacts.length !== CANDIDATE_PATHS.length) failures.push("candidate_artifacts");
  if (sha256(canonicalBytes(normalizedForReportHash(packet))) !== packet.hashes.report_hash) {
    failures.push("report_hash_mismatch");
  }
  if (!packet.decision_contract?.exact_approve?.includes(packet.request_id)
    || !packet.decision_contract.exact_approve.includes(packet.hashes.candidate_hash)
    || !packet.decision_contract.exact_approve.includes(packet.hashes.diff_hash)
    || !packet.decision_contract.exact_approve.includes(packet.hashes.report_hash)) failures.push("approve_syntax");
  if (!packet.decision_contract?.exact_reject?.includes(packet.request_id)
    || !packet.decision_contract.exact_reject.includes(packet.hashes.report_hash)) failures.push("reject_syntax");
  if (failures.length) throw new Error(`invalid_review_packet:${failures.join(",")}`);
}

export function parseOwnerDecision(packet, reply) {
  if (!packet || typeof packet !== "object" || typeof reply !== "string") {
    return { valid: false, decision: null, reason: "invalid_decision_input" };
  }
  if (reply === packet.decision_contract?.exact_approve) {
    return { valid: true, decision: "approve", reason: null, request_id: packet.request_id };
  }
  if (reply === packet.decision_contract?.exact_reject) {
    return { valid: true, decision: "reject", reason: null, request_id: packet.request_id };
  }
  return { valid: false, decision: null, reason: "exact_request_bound_reply_required" };
}

export function buildReviewPacket({
  rootDir = ROOT,
  manifestRaw,
  statusRaw,
  schema,
  generatedAt = new Date().toISOString(),
  commit = null,
} = {}) {
  const root = resolve(rootDir);
  const gate = evaluateFreshnessRelease({
    rootDir: root,
    manifestRaw,
    statusRaw,
    schema,
    evaluationAt: generatedAt,
  });
  if (!gate.eligible) throw new Error(`freshness_gate_blocked:${gate.reasons.join("|")}`);

  const candidateArtifacts = gate.candidate_artifacts.map((artifact) => ({
    path: artifact.path,
    sha256: artifact.sha256,
    status: artifact.status,
  }));
  if (!candidateArtifacts.every((artifact) => artifact.status === "available" && validSha(artifact.sha256))) {
    throw new Error("candidate_artifact_invalid");
  }
  const candidateHash = sha256(canonicalBytes(candidateArtifacts));

  const diffEntries = candidateArtifacts.map((artifact) => {
    const publicPath = `data/agent/${basename(artifact.path)}`;
    const publicEvidence = fileEvidence(resolve(root, publicPath));
    const change = publicEvidence.status !== "available"
      ? "add"
      : publicEvidence.sha256 === artifact.sha256 ? "same" : "change";
    return {
      path: publicPath,
      preview_path: artifact.path,
      change,
      preview_sha256: artifact.sha256,
      public_sha256: publicEvidence.sha256,
      public_status: publicEvidence.status,
      public_bytes: publicEvidence.bytes,
    };
  });
  const diffHash = sha256(canonicalBytes(diffEntries));
  const requestSeed = {
    action: "public_promotion",
    candidate_hash: candidateHash,
    diff_hash: diffHash,
    source_latest_date: gate.source_latest_date,
    stored_manifest_sha256: gate.stored_manifest_sha256,
  };
  const requestId = `anh-review-${sha256(canonicalBytes(requestSeed)).slice(0, 16)}`;
  const commitSha = commit || repoCommit(root);
  const worktree = repoWorktreeState(root);

  const packet = {
    schema_version: REVIEW_PACKET_SCHEMA_VERSION,
    request_id: requestId,
    generated_at: generatedAt,
    project: "ai-news-hub",
    action: "public_promotion",
    repository: {
      commit: validCommit(commitSha) ? commitSha : null,
      worktree_clean: worktree.clean,
      worktree_changes: worktree.changes,
      worktree_required_clean_for_apply: true,
    },
    source_dates: {
      source_latest_date: gate.source_latest_date,
      preview_generated_at: JSON.parse(statusRaw).preview_generated_at,
      public_generated_at: JSON.parse(statusRaw).public_generated_at,
      lag_hours: JSON.parse(statusRaw).lag_hours,
    },
    freshness_gate: {
      schema_version: gate.schema_version,
      checked_at: gate.checked_at,
      decision: gate.decision,
      eligible: gate.eligible,
      current_state_match: gate.current_state_match,
      stored_status_match: gate.stored_status_match,
      freshness_state: gate.freshness_state,
      publish_state: gate.publish_state,
      stored_manifest_sha256: gate.stored_manifest_sha256,
      evaluation_manifest_sha256: gate.evaluation_manifest_sha256,
    },
    candidate: {
      artifact_count: candidateArtifacts.length,
      artifacts: candidateArtifacts,
    },
    diff: {
      changed_count: diffEntries.filter((entry) => entry.change !== "same").length,
      entries: diffEntries,
    },
    hashes: {
      algorithm: "sha256",
      candidate_hash: candidateHash,
      diff_hash: diffHash,
    },
    authority: {
      publish_authority: "owner_only",
      manual_only: true,
      advisory: true,
      production_write: false,
      packet_is_approval: false,
    },
    decision_contract: {
      accepted_decisions: ["APPROVE", "REJECT"],
      exact_approve: null,
      exact_reject: null,
      vague_reply_valid: false,
      reply_match: "exact_string",
      stale_hash_action: "block",
      notification_implies_approval: false,
    },
    hash_contract: {
      candidate_hash: "sha256(canonical candidate artifact path/status/hash array)",
      diff_hash: "sha256(canonical public-preview diff evidence array)",
      report_hash: "sha256(canonical packet excluding hashes.report_hash, with decision syntax normalized to hash templates)",
    },
  };
  packet.decision_contract.exact_approve = `APPROVE ${requestId} candidate=${candidateHash} diff=${diffHash} report={report_hash}`;
  packet.decision_contract.exact_reject = `REJECT ${requestId} candidate=${candidateHash} diff=${diffHash} report={report_hash}`;
  packet.hashes.report_hash = sha256(canonicalBytes(normalizedForReportHash(packet)));
  packet.decision_contract.exact_approve = `APPROVE ${requestId} candidate=${candidateHash} diff=${diffHash} report=${packet.hashes.report_hash}`;
  packet.decision_contract.exact_reject = `REJECT ${requestId} candidate=${candidateHash} diff=${diffHash} report=${packet.hashes.report_hash}`;

  assertPacket(packet);
  return packet;
}

function normalizedForReportHash(packet) {
  const normalized = structuredClone(packet);
  delete normalized.hashes.report_hash;
  normalized.decision_contract.exact_approve = `APPROVE ${packet.request_id} candidate=${packet.hashes.candidate_hash} diff=${packet.hashes.diff_hash} report={report_hash}`;
  normalized.decision_contract.exact_reject = `REJECT ${packet.request_id} candidate=${packet.hashes.candidate_hash} diff=${packet.hashes.diff_hash} report={report_hash}`;
  return normalized;
}

function writePacket(rootDir, outDir, packet) {
  const previewRoot = resolve(rootDir, "data/agent/.preview/review-packets");
  const targetDir = resolve(outDir);
  if (targetDir !== previewRoot && !targetDir.startsWith(`${previewRoot}${sep}`)) {
    throw new Error(`output_outside_review_preview:${targetDir}`);
  }
  mkdirSync(targetDir, { recursive: true });
  const path = join(targetDir, `${packet.request_id}-${packet.hashes.report_hash}.json`);
  const bytes = Buffer.from(`${JSON.stringify(packet, null, 2)}\n`, "utf8");
  if (existsSync(path)) {
    if (!readFileSync(path).equals(bytes)) throw new Error("immutable_packet_collision");
    return { path, created: false };
  }
  writeFileSync(path, bytes, { flag: "wx" });
  return { path, created: true };
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "anh-review-packet-"));
  writeJson(join(root, "data/latest.json"), { date: "2026-08-13", time: "2026-08-13T23:00:00.000Z" });
  writeJson(join(root, "data/health.json"), { last_date: "2026-08-13", last_run: "2026-08-13T23:05:00.000Z" });
  const names = [
    "timeline", "trends", "trend-assessment", "roadmap", "brief-latest",
    "candidates", "recommendations", "learning-status",
  ];
  for (const name of names) {
    const value = {
      schema_version: `${name}-v1`, source_latest_date: "2026-08-13",
      generated_at: "2026-08-13T23:10:00.000Z",
      ...(["trend-assessment", "roadmap", "brief-latest"].includes(name) ? { source: "model" } : {}),
    };
    writeJson(join(root, `data/agent/.preview/${name}.json`), value);
    if (name !== "roadmap") writeJson(join(root, `data/agent/${name}.json`), { ...value, generated_at: "2026-08-12T20:00:00.000Z" });
  }
  return root;
}

function capture(root, generatedAt) {
  const manifest = buildCurrentStateManifest({ rootDir: root, generatedAt });
  const manifestRaw = `${JSON.stringify(manifest, null, 2)}\n`;
  const statusRaw = `${JSON.stringify(buildSystemStatus({ manifestRaw }), null, 2)}\n`;
  return { manifestRaw, statusRaw };
}

function selfTest() {
  const schema = JSON.parse(readFileSync(DEFAULT_SCHEMA, "utf8"));
  const roots = [];
  let total = 0;
  let failures = 0;
  const check = (name, condition) => {
    total += 1;
    if (condition) console.log(`  ok   ${name}`);
    else { console.log(`  FAIL ${name}`); failures += 1; }
  };
  try {
    const root = fixtureRoot(); roots.push(root);
    const at = "2026-08-14T00:00:00.000Z";
    const evidence = capture(root, at);
    const first = buildReviewPacket({ rootDir: root, ...evidence, schema, generatedAt: at, commit: "a".repeat(40) });
    const second = buildReviewPacket({ rootDir: root, ...evidence, schema, generatedAt: at, commit: "a".repeat(40) });
    check("same evidence produces byte-identical packet", JSON.stringify(first) === JSON.stringify(second));
    check("candidate and diff hashes are explicit", validSha(first.hashes.candidate_hash) && validSha(first.hashes.diff_hash));
    check("source dates and lag are captured", first.source_dates.source_latest_date === "2026-08-13"
      && typeof first.source_dates.lag_hours === "number");
    check("missing public artifact is represented as add", first.diff.entries.some((entry) => entry.change === "add"));
    check("exact approve binds request and all hashes", first.decision_contract.exact_approve.includes(first.request_id)
      && [first.hashes.candidate_hash, first.hashes.diff_hash, first.hashes.report_hash]
        .every((hash) => first.decision_contract.exact_approve.includes(hash)));
    check("vague reply is invalid and packet is not approval", first.decision_contract.vague_reply_valid === false
      && first.authority.packet_is_approval === false);
    check("exact approve reply parses as request-bound decision",
      parseOwnerDecision(first, first.decision_contract.exact_approve).decision === "approve");
    check("vague or stale-hash replies are rejected",
      !parseOwnerDecision(first, "approve").valid
      && !parseOwnerDecision(first, `${first.decision_contract.exact_approve} stale`).valid);
    check("report hash verifies normalized packet", sha256(canonicalBytes(normalizedForReportHash(first))) === first.hashes.report_hash);

    const written = writePacket(root, join(root, "data/agent/.preview/review-packets"), first);
    const repeated = writePacket(root, join(root, "data/agent/.preview/review-packets"), first);
    check("packet write is content-addressed and immutable", written.created && !repeated.created && written.path === repeated.path);
    let confined = false;
    try { writePacket(root, join(root, "data/agent/review-packets"), first); }
    catch (error) { confined = String(error.message).startsWith("output_outside_review_preview:"); }
    check("packet cannot write outside preview", confined);

    const changedRoot = fixtureRoot(); roots.push(changedRoot);
    const changedPreview = JSON.parse(readFileSync(join(changedRoot, "data/agent/.preview/trends.json"), "utf8"));
    changedPreview.value = 2;
    writeJson(join(changedRoot, "data/agent/.preview/trends.json"), changedPreview);
    const refreshed = capture(changedRoot, at);
    const changedPacket = buildReviewPacket({ rootDir: changedRoot, ...refreshed, schema, generatedAt: at, commit: "a".repeat(40) });
    check("candidate mutation changes candidate and report hashes",
      changedPacket.hashes.candidate_hash !== first.hashes.candidate_hash
      && changedPacket.hashes.report_hash !== first.hashes.report_hash);

    const publicChangedRoot = fixtureRoot(); roots.push(publicChangedRoot);
    writeJson(join(publicChangedRoot, "data/agent/trends.json"), { public: "different" });
    const publicEvidence = capture(publicChangedRoot, at);
    const publicPacket = buildReviewPacket({ rootDir: publicChangedRoot, ...publicEvidence, schema, generatedAt: at, commit: "a".repeat(40) });
    check("public mutation changes diff hash", publicPacket.hashes.diff_hash !== first.hashes.diff_hash);

    let staleBlocked = false;
    try {
      buildReviewPacket({ rootDir: root, ...evidence, schema, generatedAt: "2026-08-15T02:00:00.000Z", commit: "a".repeat(40) });
    } catch (error) { staleBlocked = String(error.message).startsWith("freshness_gate_blocked:"); }
    check("stale freshness gate blocks packet generation", staleBlocked);
    check("packet remains advisory and production-write false", first.authority.advisory && !first.authority.production_write);
    check("worktree state is explicit even outside a git checkout",
      Object.hasOwn(first.repository, "worktree_clean") && Array.isArray(first.repository.worktree_changes));
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
  console.log(`[review-packet] self-test: ${total} cases, ${failures} failed`);
  return failures === 0 ? 0 : 1;
}

function parseArgs(argv) {
  const options = { root: ROOT, outDir: null, generatedAt: null, selfTest: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--self-test") { options.selfTest = true; continue; }
    if (flag === "--dry-run") { options.dryRun = true; continue; }
    const key = { "--root": "root", "--out-dir": "outDir" }[flag];
    if (!key || !argv[index + 1]) throw new Error(`unknown_or_incomplete_argument:${flag}`);
    options[key] = resolve(argv[index + 1]);
    index += 1;
  }
  options.outDir ||= join(options.root, "data/agent/.preview/review-packets");
  return options;
}

function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(`[review-packet] ${error.message}`); process.exit(2); }
  if (options.selfTest) process.exit(selfTest());
  try {
    const generatedAt = new Date().toISOString();
    const manifestPath = join(options.root, "data/agent/.preview/current-state-manifest.json");
    const statusPath = join(options.root, "data/agent/.preview/system-status.json");
    const packet = buildReviewPacket({
      rootDir: options.root,
      manifestRaw: readFileSync(manifestPath),
      statusRaw: readFileSync(statusPath),
      schema: JSON.parse(readFileSync(join(options.root, "schemas/system-status-v1.schema.json"), "utf8")),
      generatedAt,
    });
    if (options.dryRun) {
      console.log(JSON.stringify({ ok: true, dry_run: true, packet }));
      process.exit(0);
    }
    const result = writePacket(options.root, options.outDir, packet);
    console.log(JSON.stringify({
      ok: true,
      created: result.created,
      output: relative(options.root, result.path).split(sep).join("/"),
      request_id: packet.request_id,
      candidate_hash: packet.hashes.candidate_hash,
      diff_hash: packet.hashes.diff_hash,
      report_hash: packet.hashes.report_hash,
      exact_approve: packet.decision_contract.exact_approve,
      exact_reject: packet.decision_contract.exact_reject,
      advisory: true,
      production_write: false,
    }));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, status: "blocked", reason: error.message }));
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith("build-review-packet.mjs")) main();
