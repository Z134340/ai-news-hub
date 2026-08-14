#!/usr/bin/env node
/**
 * Build a read-only inventory of the current ingestion, preview, and public
 * JSON artifacts. The manifest is internal evidence: it is written only to
 * data/agent/.preview/ and never promotes or mutates source artifacts.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

export const MANIFEST_SCHEMA_VERSION = "current-state-manifest-v1";

const EXPECTED = Object.freeze({
  ingestion: ["data/latest.json", "data/health.json"],
  preview: [
    "data/agent/.preview/timeline.json",
    "data/agent/.preview/trends.json",
    "data/agent/.preview/trend-assessment.json",
    "data/agent/.preview/roadmap.json",
    "data/agent/.preview/brief-latest.json",
    "data/agent/.preview/candidates.json",
    "data/agent/.preview/recommendations.json",
    "data/agent/.preview/learning-status.json",
  ],
  public: [
    "data/agent/timeline.json",
    "data/agent/trends.json",
    "data/agent/trend-assessment.json",
    "data/agent/roadmap.json",
    "data/agent/brief-latest.json",
    "data/agent/candidates.json",
    "data/agent/recommendations.json",
    "data/agent/learning-status.json",
  ],
});

const DISCOVERY_DIR = Object.freeze({
  preview: "data/agent/.preview",
  public: "data/agent",
});

// Derived orchestration/status artifacts would create circular hashes:
// run-agents writes agent-run-status from the same step log, while ANH-003
// builds system-status directly from this manifest.
const EXCLUDED = new Set([
  "data/agent/.preview/agent-run-status.json",
  "data/agent/.preview/current-state-manifest.json",
  "data/agent/.preview/system-status.json",
]);

const DATE_ONLY_KEYS = new Set(["date", "last_date", "source_latest_date"]);
const DATE_TIME_KEYS = new Set([
  "time",
  "generated_at",
  "source_latest_generated_at",
  "last_run",
  "last_success",
  "last_missed",
  "started_at",
  "finished_at",
]);

function toPosix(value) {
  return value.split(sep).join("/");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function validDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validDateTime(value) {
  if (value === null) return true;
  if (typeof value !== "string" || value.trim() === "") return false;
  const timeOnly = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (timeOnly) {
    const [, hour, minute, second = "00"] = timeOnly;
    return Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59;
  }
  const timestamp = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!timestamp) return false;
  const [, date, hour, minute, second = "00", , offsetHour = "00", offsetMinute = "00"] = timestamp;
  return validDateOnly(date)
    && Number(hour) <= 23
    && Number(minute) <= 59
    && Number(second) <= 59
    && Number(offsetHour) <= 23
    && Number(offsetMinute) <= 59
    && !Number.isNaN(Date.parse(value));
}

function collectDateFields(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) return [];
  const fields = [];
  for (const [name, value] of Object.entries(document)) {
    if (DATE_ONLY_KEYS.has(name)) {
      fields.push({ name, value, kind: "date", valid: validDateOnly(value) });
    } else if (DATE_TIME_KEYS.has(name)) {
      fields.push({ name, value, kind: "datetime", valid: validDateTime(value) });
    }
  }
  if (document._updated_at && typeof document._updated_at === "object" && !Array.isArray(document._updated_at)) {
    for (const [name, value] of Object.entries(document._updated_at).sort(([a], [b]) => a.localeCompare(b))) {
      fields.push({
        name: `_updated_at.${name}`,
        value,
        kind: "datetime",
        valid: validDateTime(value),
      });
    }
  }
  return fields.sort((a, b) => a.name.localeCompare(b.name));
}

function readSchemaVersion(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) return null;
  for (const key of ["schema_version", "schema", "version"]) {
    if (typeof document[key] === "string" && document[key].trim()) return document[key];
  }
  return null;
}

function expectedPathSet(group) {
  return new Set(EXPECTED[group] || []);
}

function discoverJsonPaths(rootDir, group) {
  const relDir = DISCOVERY_DIR[group];
  if (!relDir) return [];
  const absDir = resolve(rootDir, relDir);
  if (!existsSync(absDir)) return [];
  return readdirSync(absDir, { withFileTypes: true })
    .filter((entry) => entry.name.endsWith(".json"))
    .map((entry) => `${relDir}/${entry.name}`)
    .filter((path) => !EXCLUDED.has(path));
}

function inventoryPaths(rootDir, group) {
  return [...new Set([...(EXPECTED[group] || []), ...discoverJsonPaths(rootDir, group)])]
    .filter((path) => !EXCLUDED.has(path))
    .sort();
}

export function inspectArtifact(rootDir, group, relPath) {
  const expected = expectedPathSet(group).has(relPath);
  const absPath = resolve(rootDir, relPath);
  const base = {
    group,
    path: relPath,
    expected,
    present: false,
    status: "missing",
    sha256: null,
    bytes: null,
    filesystem_modified_at: null,
    schema_version: null,
    date_fields: [],
    errors: [],
  };

  if (!existsSync(absPath)) return base;
  const lst = lstatSync(absPath);
  if (!lst.isFile()) {
    return { ...base, present: true, status: "invalid_type", errors: ["not_a_regular_file"] };
  }

  const raw = readFileSync(absPath);
  const observed = {
    ...base,
    present: true,
    sha256: sha256(raw),
    bytes: raw.byteLength,
    filesystem_modified_at: statSync(absPath).mtime.toISOString(),
  };

  let document;
  try {
    document = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    return {
      ...observed,
      status: "invalid_json",
      errors: [`invalid_json:${error.name}`],
    };
  }

  const dateFields = collectDateFields(document);
  const invalid = dateFields.filter((field) => !field.valid).map((field) => field.name);
  return {
    ...observed,
    status: invalid.length ? "invalid_date" : "available",
    schema_version: readSchemaVersion(document),
    date_fields: dateFields,
    errors: invalid.map((name) => `invalid_date:${name}`),
  };
}

function summarize(artifacts) {
  const byStatus = {};
  const byGroup = {};
  for (const artifact of artifacts) {
    byStatus[artifact.status] = (byStatus[artifact.status] || 0) + 1;
    const group = (byGroup[artifact.group] ||= { total: 0, expected: 0, present: 0, missing: 0, invalid: 0 });
    group.total += 1;
    if (artifact.expected) group.expected += 1;
    if (artifact.present) group.present += 1;
    if (artifact.status === "missing") group.missing += 1;
    if (!["available", "missing"].includes(artifact.status)) group.invalid += 1;
  }
  return {
    total: artifacts.length,
    by_status: Object.fromEntries(Object.entries(byStatus).sort(([a], [b]) => a.localeCompare(b))),
    by_group: Object.fromEntries(Object.entries(byGroup).sort(([a], [b]) => a.localeCompare(b))),
  };
}

export function buildCurrentStateManifest({ rootDir = process.cwd(), generatedAt = new Date().toISOString() } = {}) {
  const root = resolve(rootDir);
  const artifacts = [];
  for (const group of ["ingestion", "preview", "public"]) {
    for (const relPath of inventoryPaths(root, group)) {
      artifacts.push(inspectArtifact(root, group, relPath));
    }
  }
  return {
    schema_version: MANIFEST_SCHEMA_VERSION,
    generated_at: generatedAt,
    mode: "preview",
    advisory: true,
    production_write: false,
    publish: "manual_only",
    scope: {
      groups: ["ingestion", "preview", "public"],
      discovery: "direct-json-files-plus-expected-contract",
      excluded_paths: [...EXCLUDED].sort(),
      stale_policy: "not_evaluated; ANH-003 consumes recorded dates",
    },
    artifacts,
    summary: summarize(artifacts),
  };
}

function assertPreviewOutput(rootDir, outPath) {
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

function writeFixture(root, relPath, value) {
  const path = resolve(root, relPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value)}\n`, "utf8");
}

function selfTest() {
  const root = mkdtempSync(join(tmpdir(), "anh-current-state-"));
  let failures = 0;
  let total = 0;
  const check = (name, condition) => {
    total += 1;
    if (condition) console.log(`  ok   ${name}`);
    else { console.log(`  FAIL ${name}`); failures += 1; }
  };
  try {
    writeFixture(root, "data/latest.json", {
      date: "2026-08-13",
      time: "2026-08-13T18:14:00+08:00",
      generated_at: "18:14",
      schema_version: "ingestion-v1",
    });
    writeFixture(root, "data/health.json", {
      last_date: "2026-08-13",
      last_run: "2026-08-13T18:25:00+08:00",
      status: "ok",
    });
    writeFixture(root, "data/agent/.preview/timeline.json", {
      schema_version: "timeline-v1",
      source_latest_date: "2026-08-13",
      generated_at: "2026-08-13T10:15:00Z",
    });
    // Old factual date is retained for ANH-003; this builder must not invent a stale policy.
    writeFixture(root, "data/agent/timeline.json", {
      schema_version: "timeline-v1",
      source_latest_date: "2026-07-30",
      generated_at: "2026-07-31T02:00:00Z",
    });
    writeFixture(root, "data/agent/.preview/trends.json", "{not-json");
    writeFixture(root, "data/agent/trends.json", {
      schema_version: "trends-v1",
      source_latest_date: "2026-02-30",
      generated_at: "2026-02-30T12:00:00Z",
    });
    writeFixture(root, "data/agent/proposals.json", { schema: "proposal-v1" });
    writeFixture(root, "data/agent/.preview/system-status.json", {
      schema_version: "system-status-v1",
      freshness_state: "fresh",
    });

    const generatedAt = "2026-08-14T00:00:00.000Z";
    const first = buildCurrentStateManifest({ rootDir: root, generatedAt });
    const second = buildCurrentStateManifest({ rootDir: root, generatedAt });
    const find = (path) => first.artifacts.find((item) => item.path === path);

    check("schema version is explicit", first.schema_version === MANIFEST_SCHEMA_VERSION);
    check("same filesystem and clock produce identical manifest", JSON.stringify(first) === JSON.stringify(second));
    check("valid artifact has SHA-256", /^[a-f0-9]{64}$/.test(find("data/latest.json").sha256));
    check("schema_version is extracted", find("data/latest.json").schema_version === "ingestion-v1");
    check("legacy HH:MM generated_at is accepted", find("data/latest.json").status === "available");
    check("missing expected artifact is represented", find("data/agent/brief-latest.json").status === "missing");
    check("invalid JSON is represented", find("data/agent/.preview/trends.json").status === "invalid_json");
    check("invalid calendar date is represented", find("data/agent/trends.json").status === "invalid_date");
    check("invalid calendar timestamp is represented",
      find("data/agent/trends.json").errors.includes("invalid_date:generated_at"));
    check("old public date is preserved without policy classification",
      find("data/agent/timeline.json").date_fields.some((field) => field.name === "source_latest_date" && field.value === "2026-07-30")
      && first.scope.stale_policy.startsWith("not_evaluated"));
    check("discovered non-contract JSON is included", find("data/agent/proposals.json").expected === false);
    check("manifest never includes itself", !find("data/agent/.preview/current-state-manifest.json"));
    check("control-plane status is explicitly excluded",
      first.scope.excluded_paths.includes("data/agent/.preview/agent-run-status.json"));
    check("derived system status is excluded to prevent a circular hash",
      first.scope.excluded_paths.includes("data/agent/.preview/system-status.json")
      && !find("data/agent/.preview/system-status.json"));
    check("summary reports missing and invalid states",
      first.summary.by_status.missing > 0 && first.summary.by_status.invalid_json === 1 && first.summary.by_status.invalid_date === 1);

    let blocked = false;
    try { assertPreviewOutput(root, resolve(root, "data/agent/current-state-manifest.json")); }
    catch (error) { blocked = String(error.message).startsWith("output_outside_preview:"); }
    check("output outside .preview is blocked", blocked);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  console.log(`[current-state-manifest] self-test: ${total} cases, ${failures} failed`);
  return failures === 0 ? 0 : 1;
}

function valueOf(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

function main() {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const rootDir = resolve(valueOf("--root") || process.cwd());
  const outPath = resolve(valueOf("--out") || join(rootDir, "data/agent/.preview/current-state-manifest.json"));
  assertPreviewOutput(rootDir, outPath);
  const manifest = buildCurrentStateManifest({ rootDir });
  writeJsonAtomic(outPath, manifest);
  console.log(JSON.stringify({
    ok: true,
    schema_version: manifest.schema_version,
    output: toPosix(relative(rootDir, outPath)),
    summary: manifest.summary,
  }));
}

if (process.argv[1] && process.argv[1].endsWith("build-current-state-manifest.mjs")) {
  main();
}
