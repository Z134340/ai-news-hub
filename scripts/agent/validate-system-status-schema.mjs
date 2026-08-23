#!/usr/bin/env node
/**
 * Zero-dependency contract validator for system-status-v1.
 *
 * This intentionally implements only the Draft 2020-12 keywords used by the
 * checked-in schema. validateSchemaKeywords fails closed if a future edit adds
 * a keyword that this executable does not understand.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "../..");
const DEFAULT_SCHEMA = join(ROOT, "schemas/system-status-v1.schema.json");
const DEFAULT_FIXTURES = join(ROOT, "schemas/fixtures/system-status-v1");

const SUPPORTED_KEYWORDS = new Set([
  "$schema", "$id", "$defs", "$ref", "title", "description", "type",
  "const", "enum", "required", "properties", "additionalProperties",
  "minimum", "minLength", "pattern", "format", "oneOf",
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function typeMatches(expected, value) {
  switch (expected) {
    case "null": return value === null;
    case "object": return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array": return Array.isArray(value);
    case "integer": return Number.isInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "string": return typeof value === "string";
    case "boolean": return typeof value === "boolean";
    default: return false;
  }
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validDateTime(value) {
  if (typeof value !== "string") return false;
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

function resolveRef(rootSchema, reference) {
  if (!reference.startsWith("#/")) throw new Error(`unsupported_ref:${reference}`);
  return reference.slice(2).split("/").reduce((node, rawPart) => {
    const part = rawPart.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!node || typeof node !== "object" || !(part in node)) throw new Error(`missing_ref:${reference}`);
    return node[part];
  }, rootSchema);
}

export function validateInstance(schema, value, rootSchema = schema, path = "$") {
  const errors = [];
  if (schema.$ref) return validateInstance(resolveRef(rootSchema, schema.$ref), value, rootSchema, path);

  if (schema.type) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expected.some((type) => typeMatches(type, value))) {
      errors.push(`${path}:type:${expected.join("|")}`);
      return errors;
    }
  }
  if (Object.hasOwn(schema, "const") && !sameValue(value, schema.const)) {
    errors.push(`${path}:const:${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((candidate) => sameValue(value, candidate))) {
    errors.push(`${path}:enum`);
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${path}:minimum:${schema.minimum}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) {
      errors.push(`${path}:minLength:${schema.minLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}:pattern`);
    }
    if (schema.format === "date" && !validDate(value)) errors.push(`${path}:format:date`);
    if (schema.format === "date-time" && !validDateTime(value)) errors.push(`${path}:format:date-time`);
  }

  const isObject = value !== null && typeof value === "object" && !Array.isArray(value);
  if (isObject) {
    for (const required of schema.required || []) {
      if (!Object.hasOwn(value, required)) errors.push(`${path}:required:${required}`);
    }
    for (const [name, childSchema] of Object.entries(schema.properties || {})) {
      if (Object.hasOwn(value, name)) {
        errors.push(...validateInstance(childSchema, value[name], rootSchema, `${path}.${name}`));
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties || {}));
      for (const name of Object.keys(value)) {
        if (!allowed.has(name)) errors.push(`${path}:additionalProperties:${name}`);
      }
    }
  }

  if (schema.oneOf) {
    const results = schema.oneOf.map((candidate) => validateInstance(candidate, value, rootSchema, path));
    const matches = results.filter((candidateErrors) => candidateErrors.length === 0).length;
    if (matches !== 1) errors.push(`${path}:oneOf:matched_${matches}`);
  }
  return errors;
}

export function validateSchemaKeywords(schema) {
  const errors = [];
  const visit = (node, path) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    for (const keyword of Object.keys(node)) {
      if (!SUPPORTED_KEYWORDS.has(keyword)) errors.push(`${path}:unsupported_keyword:${keyword}`);
    }
    for (const [name, child] of Object.entries(node.properties || {})) visit(child, `${path}/properties/${name}`);
    for (const [name, child] of Object.entries(node.$defs || {})) visit(child, `${path}/$defs/${name}`);
    for (const [index, child] of (node.oneOf || []).entries()) visit(child, `${path}/oneOf/${index}`);
  };
  visit(schema, "#");
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    errors.push("#:$schema:draft_2020_12_required");
  }
  if (schema.$id !== "https://ai-news-hub.local/schemas/system-status-v1.schema.json") {
    errors.push("#:$id:unexpected");
  }
  try {
    for (const reference of collectRefs(schema)) resolveRef(schema, reference);
  } catch (error) {
    errors.push(`#:${error.message}`);
  }
  return errors;
}

function collectRefs(node, refs = []) {
  if (!node || typeof node !== "object") return refs;
  if (typeof node.$ref === "string") refs.push(node.$ref);
  for (const value of Object.values(node)) collectRefs(value, refs);
  return refs;
}

function fixtureFiles(root, expected) {
  const dir = join(root, expected);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(dir, name));
}

export function runFixtureSuite({ schemaPath = DEFAULT_SCHEMA, fixturesRoot = DEFAULT_FIXTURES } = {}) {
  const schema = readJson(schemaPath);
  const schemaErrors = validateSchemaKeywords(schema);
  const guardProbe = JSON.parse(JSON.stringify(schema));
  guardProbe.unsupported_probe_keyword = true;
  const keywordGuardPassed = validateSchemaKeywords(guardProbe)
    .some((error) => error === "#:unsupported_keyword:unsupported_probe_keyword");
  const validFiles = fixtureFiles(fixturesRoot, "valid");
  const invalidFiles = fixtureFiles(fixturesRoot, "invalid");
  const results = [];

  for (const path of validFiles) {
    const errors = validateInstance(schema, readJson(path));
    results.push({ fixture: path, expected: "valid", passed: errors.length === 0, errors });
  }
  for (const path of invalidFiles) {
    const errors = validateInstance(schema, readJson(path));
    results.push({ fixture: path, expected: "invalid", passed: errors.length > 0, errors });
  }
  return {
    schema,
    schemaErrors,
    validCount: validFiles.length,
    invalidCount: invalidFiles.length,
    keywordGuardPassed,
    results,
    passed: schemaErrors.length === 0
      && keywordGuardPassed
      && validFiles.length > 0
      && invalidFiles.length > 0
      && results.every((result) => result.passed),
  };
}

function valueOf(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

function main() {
  const suite = runFixtureSuite({
    schemaPath: resolve(valueOf("--schema") || DEFAULT_SCHEMA),
    fixturesRoot: resolve(valueOf("--fixtures") || DEFAULT_FIXTURES),
  });
  for (const error of suite.schemaErrors) console.log(`  FAIL schema ${error}`);
  console.log(`  ${suite.keywordGuardPassed ? "ok  " : "FAIL"} schema keyword fail-closed probe`);
  for (const result of suite.results) {
    const name = result.fixture.slice(ROOT.length + 1);
    console.log(`  ${result.passed ? "ok  " : "FAIL"} ${result.expected.padEnd(7)} ${name}${result.passed ? "" : ` ${result.errors.join(",")}`}`);
  }
  console.log(`[system-status-schema] valid=${suite.validCount} invalid=${suite.invalidCount} passed=${suite.passed}`);
  process.exit(suite.passed ? 0 : 1);
}

if (process.argv[1] && process.argv[1].endsWith("validate-system-status-schema.mjs")) main();
