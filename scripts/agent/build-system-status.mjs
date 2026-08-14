#!/usr/bin/env node
/**
 * Deterministically derive system-status-v1 from current-state-manifest-v1.
 *
 * Policy is intentionally code-owned and has no CLI overrides. The manifest's
 * generated_at is both the evaluation clock and the output generated_at, so the
 * exact same manifest bytes always produce the exact same status document.
 */

import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validateInstance, validateSchemaKeywords } from "./validate-system-status-schema.mjs";

export const SYSTEM_STATUS_SCHEMA_VERSION = "system-status-v1";
export const STATUS_POLICY = Object.freeze({
  ingestion_stale_hours: 26,
  preview_public_lag_hours: 24,
});

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "../..");
const DEFAULT_MANIFEST = join(ROOT, "data/agent/.preview/current-state-manifest.json");
const DEFAULT_SCHEMA = join(ROOT, "schemas/system-status-v1.schema.json");
const DEFAULT_OUTPUT = join(ROOT, "data/agent/.preview/system-status.json");
const HOUR_MS = 60 * 60 * 1000;

const REFERENCE_PATHS = Object.freeze({
  ingestion: "data/latest.json",
  preview: "data/agent/.preview/timeline.json",
  public: "data/agent/timeline.json",
});

function sha256(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validDateTime(value) {
  if (typeof value !== "string" || value.trim() === "") return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, date, hour, minute, second = "00", , offsetHour = "00", offsetMinute = "00"] = match;
  return validDate(date)
    && Number(hour) <= 23
    && Number(minute) <= 59
    && Number(second) <= 59
    && Number(offsetHour) <= 23
    && Number(offsetMinute) <= 59
    && !Number.isNaN(Date.parse(value));
}

function artifactMap(manifest) {
  const map = new Map();
  let duplicate = false;
  for (const artifact of manifest.artifacts) {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)
      || typeof artifact.path !== "string" || typeof artifact.group !== "string") {
      throw new Error("invalid_manifest_artifact");
    }
    if (map.has(artifact.path)) duplicate = true;
    map.set(artifact.path, artifact);
  }
  return { map, duplicate };
}

function fieldValue(artifact, name, kind) {
  if (!artifact || artifact.status !== "available" || !Array.isArray(artifact.date_fields)) return null;
  const field = artifact.date_fields.find((candidate) => candidate
    && candidate.name === name && candidate.kind === kind && candidate.valid === true);
  if (!field) return null;
  if (kind === "date") return validDate(field.value) ? field.value : null;
  return validDateTime(field.value) ? field.value : null;
}

function groupHealth(artifacts, group) {
  const members = artifacts.filter((artifact) => artifact.group === group);
  if (members.length === 0 || members.every((artifact) => artifact.status === "missing")) return "missing";
  if (members.some((artifact) => !["available", "missing"].includes(artifact.status))) return "invalid";
  if (members.some((artifact) => artifact.status === "missing")) return "degraded";
  return "available";
}

function roundedHours(milliseconds) {
  return Math.round((milliseconds / HOUR_MS) * 10000) / 10000;
}

function stateDocument(base, freshnessState, blockedReason = null) {
  if (freshnessState === "fresh") {
    return { ...base, freshness_state: "fresh", publish_state: "published", blocked_reason: null };
  }
  if (freshnessState === "pending") {
    return { ...base, freshness_state: "pending", publish_state: "pending_owner_review", blocked_reason: null };
  }
  return { ...base, freshness_state: freshnessState, publish_state: "blocked", blocked_reason: blockedReason };
}

export function buildSystemStatus({ manifestRaw }) {
  if (typeof manifestRaw !== "string" && !Buffer.isBuffer(manifestRaw)) {
    throw new Error("manifest_raw_required");
  }
  const raw = Buffer.isBuffer(manifestRaw) ? manifestRaw : Buffer.from(manifestRaw, "utf8");
  let manifest;
  try { manifest = JSON.parse(raw.toString("utf8")); }
  catch (error) { throw new Error(`invalid_manifest_json:${error.name}`); }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("invalid_manifest_type");
  if (manifest.schema_version !== "current-state-manifest-v1") throw new Error("unsupported_manifest_schema");
  if (!validDateTime(manifest.generated_at)) throw new Error("invalid_manifest_generated_at");
  if (!Array.isArray(manifest.artifacts)) throw new Error("invalid_manifest_artifacts");

  const { map, duplicate } = artifactMap(manifest);
  const ingestion = map.get(REFERENCE_PATHS.ingestion);
  const preview = map.get(REFERENCE_PATHS.preview);
  const published = map.get(REFERENCE_PATHS.public);
  const sourceLatestDate = fieldValue(ingestion, "date", "date");
  const ingestionGeneratedAt = fieldValue(ingestion, "time", "datetime");
  const previewLatestDate = fieldValue(preview, "source_latest_date", "date");
  const previewGeneratedAt = fieldValue(preview, "generated_at", "datetime");
  const publicLatestDate = fieldValue(published, "source_latest_date", "date");
  const publicGeneratedAt = fieldValue(published, "generated_at", "datetime");
  const lagHours = previewGeneratedAt && publicGeneratedAt
    ? roundedHours(Math.max(0, Date.parse(previewGeneratedAt) - Date.parse(publicGeneratedAt)))
    : null;
  const artifactHealth = {
    ingestion: groupHealth(manifest.artifacts, "ingestion"),
    preview: groupHealth(manifest.artifacts, "preview"),
    public: groupHealth(manifest.artifacts, "public"),
    // ANH-001 deliberately excludes run status to avoid a circular manifest.
    agent_run: "unknown",
  };
  const base = {
    schema_version: SYSTEM_STATUS_SCHEMA_VERSION,
    generated_at: manifest.generated_at,
    source_manifest: {
      schema_version: manifest.schema_version,
      generated_at: manifest.generated_at,
      sha256: sha256(raw),
    },
    source_latest_date: sourceLatestDate,
    preview_generated_at: previewGeneratedAt,
    public_generated_at: publicGeneratedAt,
    lag_hours: lagHours,
    artifact_health: artifactHealth,
    advisory: true,
    production_write: false,
    publish_authority: "owner_only",
  };

  if (duplicate) return stateDocument(base, "blocked", "manifest_duplicate_path");
  for (const group of ["ingestion", "preview", "public"]) {
    if (artifactHealth[group] === "invalid") return stateDocument(base, "blocked", `${group}_artifact_invalid`);
  }
  if (["missing", "degraded"].includes(artifactHealth.ingestion)) {
    return stateDocument(base, "blocked", "ingestion_artifact_missing");
  }
  if (["missing", "degraded"].includes(artifactHealth.preview)) {
    return stateDocument(base, "blocked", "preview_artifact_missing");
  }
  if (!sourceLatestDate) return stateDocument(base, "blocked", "source_latest_date_missing");
  if (!ingestionGeneratedAt) return stateDocument(base, "blocked", "ingestion_timestamp_missing");
  if (!previewLatestDate) return stateDocument(base, "blocked", "preview_source_date_missing");
  if (!previewGeneratedAt) return stateDocument(base, "blocked", "preview_timestamp_missing");

  const asOf = Date.parse(manifest.generated_at);
  const ingestionTime = Date.parse(ingestionGeneratedAt);
  const previewTime = Date.parse(previewGeneratedAt);
  if (ingestionTime > asOf) return stateDocument(base, "blocked", "ingestion_timestamp_in_future");
  if (previewTime > asOf) return stateDocument(base, "blocked", "preview_timestamp_in_future");
  if (publicGeneratedAt && Date.parse(publicGeneratedAt) > asOf) {
    return stateDocument(base, "blocked", "public_timestamp_in_future");
  }
  if (previewLatestDate > sourceLatestDate) return stateDocument(base, "blocked", "preview_date_ahead_of_source");
  if (publicLatestDate && publicLatestDate > sourceLatestDate) {
    return stateDocument(base, "blocked", "public_date_ahead_of_source");
  }

  const ingestionAgeHours = roundedHours(asOf - ingestionTime);
  if (ingestionAgeHours > STATUS_POLICY.ingestion_stale_hours) {
    return stateDocument(base, "stale", "ingestion_stale");
  }
  if (previewLatestDate < sourceLatestDate) return stateDocument(base, "stale", "preview_stale");

  if (["missing", "degraded"].includes(artifactHealth.public)
    || !publicLatestDate || !publicGeneratedAt
    || publicLatestDate < sourceLatestDate
    || lagHours > STATUS_POLICY.preview_public_lag_hours) {
    return stateDocument(base, "pending");
  }
  return stateDocument(base, "fresh");
}

export function assertPreviewOutput(rootDir, outPath) {
  const previewRoot = resolve(rootDir, "data/agent/.preview");
  const target = resolve(outPath);
  if (target !== previewRoot && !target.startsWith(`${previewRoot}${sep}`)) {
    throw new Error(`output_outside_preview:${target}`);
  }
}

function writeJsonAtomic(outPath, document) {
  mkdirSync(dirname(outPath), { recursive: true });
  const tempPath = `${outPath}.tmp-${process.pid}`;
  writeFileSync(tempPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  renameSync(tempPath, outPath);
}

function dateField(name, value, kind) {
  return { name, value, kind, valid: true };
}

function fixtureManifest(overrides = {}) {
  const generatedAt = overrides.generated_at || "2026-08-14T00:00:00.000Z";
  const artifacts = [
    {
      group: "ingestion", path: REFERENCE_PATHS.ingestion, expected: true,
      present: true, status: "available", date_fields: [
        dateField("date", "2026-08-13", "date"),
        dateField("time", "2026-08-13T23:00:00.000Z", "datetime"),
      ],
    },
    {
      group: "preview", path: REFERENCE_PATHS.preview, expected: true,
      present: true, status: "available", date_fields: [
        dateField("source_latest_date", "2026-08-13", "date"),
        dateField("generated_at", "2026-08-13T23:10:00.000Z", "datetime"),
      ],
    },
    {
      group: "public", path: REFERENCE_PATHS.public, expected: true,
      present: true, status: "available", date_fields: [
        dateField("source_latest_date", "2026-08-13", "date"),
        dateField("generated_at", "2026-08-13T23:15:00.000Z", "datetime"),
      ],
    },
  ];
  const manifest = {
    schema_version: "current-state-manifest-v1",
    generated_at: generatedAt,
    artifacts,
  };
  return manifest;
}

function rawFixture(mutator = () => {}) {
  const manifest = fixtureManifest();
  mutator(manifest);
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function setField(manifest, path, name, value) {
  const artifact = manifest.artifacts.find((candidate) => candidate.path === path);
  const field = artifact.date_fields.find((candidate) => candidate.name === name);
  field.value = value;
}

function selfTest() {
  const schema = JSON.parse(readFileSync(DEFAULT_SCHEMA, "utf8"));
  let failures = 0;
  let total = 0;
  const check = (name, condition) => {
    total += 1;
    if (condition) console.log(`  ok   ${name}`);
    else { console.log(`  FAIL ${name}`); failures += 1; }
  };
  const build = (mutator) => buildSystemStatus({ manifestRaw: rawFixture(mutator) });
  const schemaValid = (status) => validateInstance(schema, status).length === 0;

  const fresh = build();
  check("fresh matrix case is published", fresh.freshness_state === "fresh" && fresh.publish_state === "published");
  check("fresh output satisfies system-status-v1", schemaValid(fresh));

  const pendingBehind = build((manifest) => {
    setField(manifest, REFERENCE_PATHS.public, "source_latest_date", "2026-08-12");
    setField(manifest, REFERENCE_PATHS.public, "generated_at", "2026-08-12T20:00:00.000Z");
  });
  check("public behind source is pending owner review",
    pendingBehind.freshness_state === "pending" && pendingBehind.lag_hours === 27.1667);

  const pendingMissing = build((manifest) => {
    manifest.artifacts = manifest.artifacts.filter((artifact) => artifact.group !== "public");
  });
  check("missing public set is pending, not falsely blocked or published",
    pendingMissing.freshness_state === "pending" && pendingMissing.public_generated_at === null);

  const staleIngestion = build((manifest) => {
    setField(manifest, REFERENCE_PATHS.ingestion, "time", "2026-08-12T21:59:59.000Z");
  });
  check("ingestion older than 26 hours is stale",
    staleIngestion.freshness_state === "stale" && staleIngestion.blocked_reason === "ingestion_stale");

  const threshold = build((manifest) => {
    setField(manifest, REFERENCE_PATHS.ingestion, "time", "2026-08-12T22:00:00.000Z");
  });
  check("exactly 26 hours remains fresh", threshold.freshness_state === "fresh");

  const stalePreview = build((manifest) => {
    setField(manifest, REFERENCE_PATHS.preview, "source_latest_date", "2026-08-12");
  });
  check("preview behind ingestion is stale",
    stalePreview.freshness_state === "stale" && stalePreview.blocked_reason === "preview_stale");

  const invalidPreview = build((manifest) => {
    manifest.artifacts.find((artifact) => artifact.path === REFERENCE_PATHS.preview).status = "invalid_json";
  });
  check("invalid artifact blocks", invalidPreview.freshness_state === "blocked"
    && invalidPreview.blocked_reason === "preview_artifact_invalid");

  const missingIngestion = build((manifest) => {
    const artifact = manifest.artifacts.find((candidate) => candidate.path === REFERENCE_PATHS.ingestion);
    artifact.status = "missing"; artifact.present = false; artifact.date_fields = [];
  });
  check("missing ingestion blocks", missingIngestion.freshness_state === "blocked"
    && missingIngestion.blocked_reason === "ingestion_artifact_missing");

  const ahead = build((manifest) => {
    setField(manifest, REFERENCE_PATHS.preview, "source_latest_date", "2026-08-14");
  });
  check("preview ahead of ingestion blocks", ahead.blocked_reason === "preview_date_ahead_of_source");

  const firstRaw = rawFixture();
  const first = buildSystemStatus({ manifestRaw: firstRaw });
  const second = buildSystemStatus({ manifestRaw: firstRaw });
  check("identical manifest bytes produce byte-identical status",
    JSON.stringify(first) === JSON.stringify(second));

  const forged = build((manifest) => {
    manifest.freshness_state = "fresh";
    manifest.publish_state = "published";
    setField(manifest, REFERENCE_PATHS.ingestion, "time", "2026-08-12T00:00:00.000Z");
  });
  check("manifest status claims cannot override code-owned policy",
    forged.freshness_state === "stale" && forged.publish_state === "blocked");

  const changedRaw = rawFixture((manifest) => { manifest.observation_note = "hash changes"; });
  check("source manifest hash binds exact input bytes",
    first.source_manifest.sha256 !== buildSystemStatus({ manifestRaw: changedRaw }).source_manifest.sha256);
  check("all state-matrix outputs satisfy schema",
    [pendingBehind, pendingMissing, staleIngestion, threshold, stalePreview, invalidPreview, missingIngestion, ahead, forged]
      .every(schemaValid));
  check("schema keyword guard is active", validateSchemaKeywords(schema).length === 0);

  const tempRoot = mkdtempSync(join(tmpdir(), "anh-system-status-"));
  let confined = false;
  try {
    try { assertPreviewOutput(tempRoot, resolve(tempRoot, "data/agent/system-status.json")); }
    catch (error) { confined = String(error.message).startsWith("output_outside_preview:"); }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
  check("output outside .preview is blocked", confined);

  console.log(`[build-system-status] self-test: ${total} cases, ${failures} failed`);
  return failures === 0 ? 0 : 1;
}

function valueOf(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

function main() {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const manifestPath = resolve(valueOf("--manifest") || DEFAULT_MANIFEST);
  const schemaPath = resolve(valueOf("--schema") || DEFAULT_SCHEMA);
  const outPath = resolve(valueOf("--out") || DEFAULT_OUTPUT);
  const rootDir = resolve(valueOf("--root") || ROOT);
  assertPreviewOutput(rootDir, outPath);

  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const schemaErrors = validateSchemaKeywords(schema);
  if (schemaErrors.length) throw new Error(`invalid_status_schema:${schemaErrors.join(",")}`);
  const status = buildSystemStatus({ manifestRaw: readFileSync(manifestPath) });
  const errors = validateInstance(schema, status);
  if (errors.length) throw new Error(`invalid_system_status:${errors.join(",")}`);
  writeJsonAtomic(outPath, status);
  console.log(JSON.stringify({
    ok: true,
    schema_version: status.schema_version,
    output: relative(rootDir, outPath).split(sep).join("/"),
    freshness_state: status.freshness_state,
    publish_state: status.publish_state,
    blocked_reason: status.blocked_reason,
    source_manifest_sha256: status.source_manifest.sha256,
  }));
}

if (process.argv[1] && process.argv[1].endsWith("build-system-status.mjs")) main();
