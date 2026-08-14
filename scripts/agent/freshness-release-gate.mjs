#!/usr/bin/env node
/**
 * ANH-005 freshness release gate.
 *
 * Read-only and fail-closed: it binds the stored system status to the exact
 * current-state manifest, verifies the recorded artifact inventory still
 * matches the filesystem, then re-evaluates freshness using the invocation
 * clock. Passing this gate never implies approval and never writes public data.
 */

import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCurrentStateManifest } from "./build-current-state-manifest.mjs";
import { buildSystemStatus } from "./build-system-status.mjs";
import { validateInstance, validateSchemaKeywords } from "./validate-system-status-schema.mjs";

export const FRESHNESS_GATE_SCHEMA_VERSION = "freshness-release-gate-v1";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "../..");
const DEFAULT_SCHEMA = join(ROOT, "schemas/system-status-v1.schema.json");

export const CANDIDATE_PATHS = Object.freeze([
  "data/agent/.preview/timeline.json",
  "data/agent/.preview/trends.json",
  "data/agent/.preview/trend-assessment.json",
  "data/agent/.preview/roadmap.json",
  "data/agent/.preview/brief-latest.json",
  "data/agent/.preview/candidates.json",
  "data/agent/.preview/recommendations.json",
]);

const RELEASE_HEALTH_STATUSES = new Set(["ok", "partial"]);

function sha256(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

function parseJson(raw, label, reasons) {
  try {
    const document = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw));
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      reasons.push(`${label}_invalid_type`);
      return null;
    }
    return document;
  } catch {
    reasons.push(`${label}_invalid_json`);
    return null;
  }
}

function artifactMap(artifacts, reasons, label) {
  const map = new Map();
  if (!Array.isArray(artifacts)) {
    reasons.push(`${label}_artifacts_invalid`);
    return map;
  }
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)
      || typeof artifact.path !== "string") {
      reasons.push(`${label}_artifact_invalid`);
      continue;
    }
    if (map.has(artifact.path)) reasons.push(`${label}_duplicate_path`);
    map.set(artifact.path, artifact);
  }
  return map;
}

function unique(values) {
  return [...new Set(values)];
}

function validEvaluationTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}

function operationalHealth(root, reasons) {
  let raw;
  try {
    raw = readFileSync(join(root, "data/health.json"));
  } catch {
    reasons.push("operational_health_unavailable");
    return { status: null, eligible: false };
  }
  const document = parseJson(raw, "operational_health", reasons);
  if (!document) return { status: null, eligible: false };
  const status = typeof document.status === "string" ? document.status : null;
  if (!status) {
    reasons.push("operational_health_status_missing");
    return { status: null, eligible: false };
  }
  if (!RELEASE_HEALTH_STATUSES.has(status)) {
    reasons.push(`operational_health_blocked:${status}`);
    return { status, eligible: false };
  }
  return { status, eligible: true };
}

export function evaluateFreshnessRelease({
  rootDir,
  manifestRaw,
  statusRaw,
  schema,
  evaluationAt,
} = {}) {
  const reasons = [];
  const root = resolve(rootDir || ROOT);
  const checkedAt = evaluationAt || new Date().toISOString();
  if (!validEvaluationTime(checkedAt)) reasons.push("evaluation_time_invalid");

  const manifest = parseJson(manifestRaw, "manifest", reasons);
  const storedStatus = parseJson(statusRaw, "status", reasons);
  let currentManifest = null;
  let currentStatus = null;
  let storedStatusMatches = false;
  let currentStateMatches = false;
  let candidateArtifacts = [];
  const health = operationalHealth(root, reasons);

  if (manifest) {
    if (manifest.schema_version !== "current-state-manifest-v1"
      || manifest.mode !== "preview"
      || manifest.advisory !== true
      || manifest.production_write !== false
      || manifest.publish !== "manual_only") {
      reasons.push("manifest_contract_invalid");
    }
    artifactMap(manifest.artifacts, reasons, "manifest");
  }

  if (storedStatus && schema) {
    const keywordErrors = validateSchemaKeywords(schema);
    if (keywordErrors.length) reasons.push("status_schema_invalid");
    else if (validateInstance(schema, storedStatus).length) reasons.push("status_contract_invalid");
    if (storedStatus.advisory !== true
      || storedStatus.production_write !== false
      || storedStatus.publish_authority !== "owner_only") {
      reasons.push("authority_boundary_invalid");
    }
  } else if (!schema) {
    reasons.push("status_schema_missing");
  }

  if (manifest && storedStatus) {
    const manifestHash = sha256(manifestRaw);
    if (storedStatus.source_manifest?.sha256 !== manifestHash) {
      reasons.push("source_manifest_hash_mismatch");
    }
    try {
      const expectedStatus = buildSystemStatus({ manifestRaw });
      storedStatusMatches = JSON.stringify(expectedStatus) === JSON.stringify(storedStatus);
      if (!storedStatusMatches) reasons.push("stored_status_recompute_mismatch");
    } catch {
      reasons.push("stored_status_recompute_failed");
    }
  }

  if (manifest && validEvaluationTime(checkedAt)) {
    try {
      currentManifest = buildCurrentStateManifest({ rootDir: root, generatedAt: checkedAt });
      currentStateMatches = JSON.stringify(currentManifest.artifacts) === JSON.stringify(manifest.artifacts)
        && JSON.stringify(currentManifest.summary) === JSON.stringify(manifest.summary);
      if (!currentStateMatches) reasons.push("current_state_manifest_mismatch");

      const currentRaw = `${JSON.stringify(currentManifest, null, 2)}\n`;
      currentStatus = buildSystemStatus({ manifestRaw: currentRaw });
      if (!["fresh", "pending"].includes(currentStatus.freshness_state)) {
        reasons.push(`candidate_state_${currentStatus.freshness_state}:${currentStatus.blocked_reason || "unknown"}`);
      }
      const validPair = (currentStatus.freshness_state === "fresh" && currentStatus.publish_state === "published")
        || (currentStatus.freshness_state === "pending" && currentStatus.publish_state === "pending_owner_review");
      if (!validPair) reasons.push("current_status_pair_invalid");

      const currentArtifacts = artifactMap(currentManifest.artifacts, reasons, "current_manifest");
      candidateArtifacts = CANDIDATE_PATHS.map((path) => {
        const artifact = currentArtifacts.get(path);
        if (!artifact || artifact.status !== "available" || !/^[a-f0-9]{64}$/.test(artifact.sha256 || "")) {
          reasons.push(`candidate_artifact_unavailable:${path}`);
        }
        return {
          path,
          status: artifact?.status || "missing",
          sha256: artifact?.sha256 || null,
        };
      });
    } catch {
      reasons.push("current_state_evaluation_failed");
    }
  }

  const finalReasons = unique(reasons);
  const eligible = finalReasons.length === 0;
  return {
    schema_version: FRESHNESS_GATE_SCHEMA_VERSION,
    checked_at: checkedAt,
    eligible,
    decision: eligible ? "pass" : "block",
    reasons: finalReasons,
    current_state_match: currentStateMatches,
    stored_status_match: storedStatusMatches,
    freshness_state: currentStatus?.freshness_state || null,
    publish_state: currentStatus?.publish_state || null,
    blocked_reason: currentStatus?.blocked_reason || null,
    source_latest_date: currentStatus?.source_latest_date || null,
    stored_manifest_sha256: manifest ? sha256(manifestRaw) : null,
    evaluation_manifest_sha256: currentManifest
      ? sha256(`${JSON.stringify(currentManifest, null, 2)}\n`)
      : null,
    candidate_artifacts: candidateArtifacts,
    operational_health_status: health.status,
    operational_health_ok: health.eligible,
    advisory: true,
    production_write: false,
    publish_authority: "owner_only",
  };
}

function writeJson(path, document) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

function fixtureRoot({ withPublic = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "anh-freshness-gate-"));
  writeJson(join(root, "data/latest.json"), {
    date: "2026-08-13",
    time: "2026-08-13T23:00:00.000Z",
  });
  writeJson(join(root, "data/health.json"), {
    last_date: "2026-08-13",
    last_run: "2026-08-13T23:05:00.000Z",
    status: "ok",
  });
  const previewNames = [
    "timeline", "trends", "trend-assessment", "roadmap", "brief-latest",
    "candidates", "recommendations", "learning-status",
  ];
  for (const name of previewNames) {
    writeJson(join(root, `data/agent/.preview/${name}.json`), {
      schema_version: `${name}-v1`,
      source_latest_date: "2026-08-13",
      generated_at: "2026-08-13T23:10:00.000Z",
      ...( ["trend-assessment", "roadmap", "brief-latest"].includes(name) ? { source: "model" } : {} ),
    });
  }
  if (withPublic) {
    for (const name of previewNames) {
      writeJson(join(root, `data/agent/${name}.json`), {
        schema_version: `${name}-v1`,
        source_latest_date: "2026-08-13",
        generated_at: "2026-08-13T23:15:00.000Z",
      });
    }
  }
  return root;
}

function captureFixture(root, generatedAt = "2026-08-14T00:00:00.000Z") {
  const manifest = buildCurrentStateManifest({ rootDir: root, generatedAt });
  const manifestRaw = `${JSON.stringify(manifest, null, 2)}\n`;
  const status = buildSystemStatus({ manifestRaw });
  return { manifestRaw, statusRaw: `${JSON.stringify(status, null, 2)}\n` };
}

function treeDigest(root) {
  const rows = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else rows.push(`${relative(root, path).split(sep).join("/")}:${statSync(path).size}:${sha256(readFileSync(path))}`);
    }
  }
  walk(root);
  return sha256(rows.join("\n"));
}

export function parseArgs(argv) {
  const options = { root: ROOT, manifest: null, status: null, schema: null, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--self-test") { options.selfTest = true; continue; }
    const key = { "--root": "root", "--manifest": "manifest", "--status": "status", "--schema": "schema" }[flag];
    if (!key || !argv[index + 1]) throw new Error(`unknown_or_incomplete_argument:${flag}`);
    options[key] = resolve(argv[index + 1]);
    index += 1;
  }
  options.manifest ||= join(options.root, "data/agent/.preview/current-state-manifest.json");
  options.status ||= join(options.root, "data/agent/.preview/system-status.json");
  options.schema ||= join(options.root, "schemas/system-status-v1.schema.json");
  return options;
}

function selfTest() {
  const schema = JSON.parse(readFileSync(DEFAULT_SCHEMA, "utf8"));
  let total = 0;
  let failures = 0;
  const check = (name, condition) => {
    total += 1;
    if (condition) console.log(`  ok   ${name}`);
    else { console.log(`  FAIL ${name}`); failures += 1; }
  };
  const roots = [];
  try {
    const pendingRoot = fixtureRoot(); roots.push(pendingRoot);
    const pendingFixture = captureFixture(pendingRoot);
    const before = treeDigest(pendingRoot);
    const pending = evaluateFreshnessRelease({
      rootDir: pendingRoot, ...pendingFixture, schema, evaluationAt: "2026-08-14T00:00:00.000Z",
    });
    check("pending current candidate passes for owner review", pending.eligible
      && pending.freshness_state === "pending" && pending.publish_state === "pending_owner_review");
    check("gate is read-only", before === treeDigest(pendingRoot) && pending.production_write === false);

    const failedHealthRoot = fixtureRoot(); roots.push(failedHealthRoot);
    writeJson(join(failedHealthRoot, "data/health.json"), {
      last_date: "2026-08-13", last_run: "2026-08-13T23:05:00.000Z",
      status: "failed", errors: ["Claude auth status failed"],
    });
    const failedHealthFixture = captureFixture(failedHealthRoot);
    const failedHealth = evaluateFreshnessRelease({
      rootDir: failedHealthRoot, ...failedHealthFixture, schema, evaluationAt: "2026-08-14T00:00:00.000Z",
    });
    check("failed operational health blocks release even when artifact parity matches",
      !failedHealth.eligible && failedHealth.operational_health_status === "failed"
      && failedHealth.reasons.includes("operational_health_blocked:failed"));

    const partialHealthRoot = fixtureRoot(); roots.push(partialHealthRoot);
    writeJson(join(partialHealthRoot, "data/health.json"), {
      last_date: "2026-08-13", last_run: "2026-08-13T23:05:00.000Z", status: "partial",
    });
    const partialHealthFixture = captureFixture(partialHealthRoot);
    const partialHealth = evaluateFreshnessRelease({
      rootDir: partialHealthRoot, ...partialHealthFixture, schema, evaluationAt: "2026-08-14T00:00:00.000Z",
    });
    check("explicit partial operational health remains review-eligible",
      partialHealth.eligible && partialHealth.operational_health_ok === true);

    const stale = evaluateFreshnessRelease({
      rootDir: pendingRoot, ...pendingFixture, schema, evaluationAt: "2026-08-15T02:00:00.000Z",
    });
    check("stale candidate is blocked using invocation clock", !stale.eligible
      && stale.reasons.includes("candidate_state_stale:ingestion_stale"));

    const changedRoot = fixtureRoot(); roots.push(changedRoot);
    const changedFixture = captureFixture(changedRoot);
    writeJson(join(changedRoot, "data/agent/.preview/trends.json"), { changed: true });
    const changed = evaluateFreshnessRelease({
      rootDir: changedRoot, ...changedFixture, schema, evaluationAt: "2026-08-14T00:00:00.000Z",
    });
    check("artifact change after manifest capture is blocked", !changed.eligible
      && changed.reasons.includes("current_state_manifest_mismatch"));

    const hashStatus = JSON.parse(pendingFixture.statusRaw);
    hashStatus.source_manifest.sha256 = "0".repeat(64);
    const badHash = evaluateFreshnessRelease({
      rootDir: pendingRoot, manifestRaw: pendingFixture.manifestRaw,
      statusRaw: `${JSON.stringify(hashStatus)}\n`, schema, evaluationAt: "2026-08-14T00:00:00.000Z",
    });
    check("status must bind exact manifest bytes", !badHash.eligible
      && badHash.reasons.includes("source_manifest_hash_mismatch"));

    const authorityStatus = JSON.parse(pendingFixture.statusRaw);
    authorityStatus.publish_authority = "agent";
    const badAuthority = evaluateFreshnessRelease({
      rootDir: pendingRoot, manifestRaw: pendingFixture.manifestRaw,
      statusRaw: `${JSON.stringify(authorityStatus)}\n`, schema, evaluationAt: "2026-08-14T00:00:00.000Z",
    });
    check("authority tampering fails closed", !badAuthority.eligible
      && badAuthority.reasons.includes("authority_boundary_invalid"));

    const forgedStatus = JSON.parse(pendingFixture.statusRaw);
    forgedStatus.freshness_state = "blocked";
    forgedStatus.publish_state = "blocked";
    forgedStatus.blocked_reason = "ingestion_stale";
    const forged = evaluateFreshnessRelease({
      rootDir: pendingRoot, manifestRaw: pendingFixture.manifestRaw,
      statusRaw: `${JSON.stringify(forgedStatus)}\n`, schema, evaluationAt: "2026-08-14T00:00:00.000Z",
    });
    check("stored status must equal deterministic recomputation", !forged.eligible
      && forged.reasons.includes("stored_status_recompute_mismatch"));

    const missingRoot = fixtureRoot(); roots.push(missingRoot);
    const missingFixture = captureFixture(missingRoot);
    rmSync(join(missingRoot, "data/agent/.preview/roadmap.json"));
    const missing = evaluateFreshnessRelease({
      rootDir: missingRoot, ...missingFixture, schema, evaluationAt: "2026-08-14T00:00:00.000Z",
    });
    check("missing promotable artifact is blocked", !missing.eligible
      && missing.reasons.includes("candidate_artifact_unavailable:data/agent/.preview/roadmap.json"));

    const duplicateManifest = JSON.parse(pendingFixture.manifestRaw);
    duplicateManifest.artifacts.push(duplicateManifest.artifacts[0]);
    const duplicate = evaluateFreshnessRelease({
      rootDir: pendingRoot, manifestRaw: `${JSON.stringify(duplicateManifest)}\n`,
      statusRaw: pendingFixture.statusRaw, schema, evaluationAt: "2026-08-14T00:00:00.000Z",
    });
    check("duplicate manifest path is blocked", !duplicate.eligible
      && duplicate.reasons.includes("manifest_duplicate_path"));

    const freshRoot = fixtureRoot({ withPublic: true }); roots.push(freshRoot);
    const freshFixture = captureFixture(freshRoot);
    const fresh = evaluateFreshnessRelease({
      rootDir: freshRoot, ...freshFixture, schema, evaluationAt: "2026-08-14T00:00:00.000Z",
    });
    check("fresh current candidate passes freshness gate", fresh.eligible
      && fresh.freshness_state === "fresh" && fresh.publish_state === "published");

    const invalidManifest = evaluateFreshnessRelease({
      rootDir: pendingRoot, manifestRaw: "{", statusRaw: pendingFixture.statusRaw,
      schema, evaluationAt: "2026-08-14T00:00:00.000Z",
    });
    check("invalid manifest JSON fails closed", !invalidManifest.eligible
      && invalidManifest.reasons.includes("manifest_invalid_json"));

    const invalidStatus = evaluateFreshnessRelease({
      rootDir: pendingRoot, manifestRaw: pendingFixture.manifestRaw, statusRaw: "{",
      schema, evaluationAt: "2026-08-14T00:00:00.000Z",
    });
    check("invalid status JSON fails closed", !invalidStatus.eligible
      && invalidStatus.reasons.includes("status_invalid_json"));

    let overrideBlocked = false;
    try { parseArgs(["--allow-stale"]); } catch { overrideBlocked = true; }
    check("no stale override argument exists", overrideBlocked);
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
  console.log(`[freshness-release-gate] self-test: ${total} cases, ${failures} failed`);
  return failures === 0 ? 0 : 1;
}

function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (error) {
    console.error(JSON.stringify({ eligible: false, decision: "block", reasons: [error.message] }));
    process.exit(2);
  }
  if (options.selfTest) process.exit(selfTest());
  let result;
  try {
    result = evaluateFreshnessRelease({
      rootDir: options.root,
      manifestRaw: readFileSync(options.manifest),
      statusRaw: readFileSync(options.status),
      schema: JSON.parse(readFileSync(options.schema, "utf8")),
      evaluationAt: new Date().toISOString(),
    });
  } catch (error) {
    result = {
      schema_version: FRESHNESS_GATE_SCHEMA_VERSION,
      checked_at: new Date().toISOString(),
      eligible: false,
      decision: "block",
      reasons: [`gate_input_error:${error.code || error.name}`],
      advisory: true,
      production_write: false,
      publish_authority: "owner_only",
    };
  }
  console.log(JSON.stringify(result));
  process.exit(result.eligible ? 0 : 1);
}

if (process.argv[1] && process.argv[1].endsWith("freshness-release-gate.mjs")) main();
