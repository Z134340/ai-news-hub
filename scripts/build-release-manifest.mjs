#!/usr/bin/env node
/* Build the deterministic public release manifest after all managed assets exist. */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const RELEASE_SCHEMA_VERSION = 1;
export const RELEASE_COMPATIBILITY_VERSION = 'ai-news-hub-web-data-v1';
export const RELEASE_CACHE_VERSION = 1;
export const MANAGED_ASSETS = Object.freeze([
  'data/latest.json',
  'data/health.json',
  'data/index.json',
  'data/skills.json',
]);

const SHA256_RE = /^[a-f0-9]{64}$/;
const RELEASE_ID_RE = /^ahr1_[a-f0-9]{64}$/;

function sha256(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function canonicalBytes(value) {
  return Buffer.from(JSON.stringify(canonical(value)), 'utf8');
}

function validDateTime(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && Number.isFinite(Date.parse(value));
}

function assetSchemaVersion(relative, parsed) {
  if (relative === 'data/latest.json') {
    const version = parsed && parsed.schema_version;
    return Number.isInteger(version) && version > 0 ? version : 1;
  }
  return 1;
}

function releaseCreatedAt(parsedAssets) {
  const latest = parsedAssets.get('data/latest.json');
  const health = parsedAssets.get('data/health.json');
  const skills = parsedAssets.get('data/skills.json');
  const index = parsedAssets.get('data/index.json');
  const candidates = [
    latest?.time,
    health?.last_run,
    health?.last_success,
    skills?._updated_at,
    ...(Array.isArray(index) ? index.map(row => row?.time) : []),
  ].filter(validDateTime);
  if (!candidates.length) throw new Error('managed assets contain no valid deterministic release timestamp');
  return candidates.sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1);
}

export function validateReleaseManifest(value) {
  const errors = [];
  const exactKeys = (object, allowed, label) => {
    if (!object || typeof object !== 'object' || Array.isArray(object)) {
      errors.push(`${label} must be an object`);
      return;
    }
    for (const key of Object.keys(object)) if (!allowed.includes(key)) errors.push(`${label}.${key} is unknown`);
  };
  exactKeys(value, ['schema_version', 'compatibility_version', 'cache_version', 'release_id', 'created_at', 'content_set_sha256', 'assets'], 'manifest');
  if (!value || typeof value !== 'object' || Array.isArray(value)) return errors;
  if (value.schema_version !== RELEASE_SCHEMA_VERSION) errors.push('unsupported schema_version');
  if (value.compatibility_version !== RELEASE_COMPATIBILITY_VERSION) errors.push('unsupported compatibility_version');
  if (value.cache_version !== RELEASE_CACHE_VERSION) errors.push('unsupported cache_version');
  if (!RELEASE_ID_RE.test(value.release_id || '')) errors.push('invalid release_id');
  if (!validDateTime(value.created_at)) errors.push('invalid created_at');
  if (!SHA256_RE.test(value.content_set_sha256 || '')) errors.push('invalid content_set_sha256');
  if (!Array.isArray(value.assets) || value.assets.length !== MANAGED_ASSETS.length) {
    errors.push('assets must contain every managed asset exactly once');
    return errors;
  }
  const seen = new Set();
  for (const [index, asset] of value.assets.entries()) {
    const label = `assets[${index}]`;
    exactKeys(asset, ['path', 'sha256', 'bytes', 'media_type', 'schema_version', 'required'], label);
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) continue;
    if (!MANAGED_ASSETS.includes(asset.path)) errors.push(`${label}.path is unmanaged`);
    if (seen.has(asset.path)) errors.push(`${label}.path is duplicated`);
    seen.add(asset.path);
    if (!SHA256_RE.test(asset.sha256 || '')) errors.push(`${label}.sha256 is invalid`);
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 0) errors.push(`${label}.bytes is invalid`);
    if (asset.media_type !== 'application/json') errors.push(`${label}.media_type is unsupported`);
    if (!Number.isSafeInteger(asset.schema_version) || asset.schema_version < 1) errors.push(`${label}.schema_version is invalid`);
    if (asset.required !== true) errors.push(`${label}.required must be true`);
  }
  for (const expected of MANAGED_ASSETS) if (!seen.has(expected)) errors.push(`missing managed asset ${expected}`);
  const contentDescriptor = value.assets.map(({ path: assetPath, sha256: digest, bytes, schema_version }) => ({
    path: assetPath, sha256: digest, bytes, schema_version,
  }));
  const expectedContentHash = sha256(canonicalBytes(contentDescriptor));
  if (value.content_set_sha256 !== expectedContentHash) errors.push('content_set_sha256 does not match assets');
  const identity = {
    schema_version: value.schema_version,
    compatibility_version: value.compatibility_version,
    cache_version: value.cache_version,
    created_at: value.created_at,
    content_set_sha256: value.content_set_sha256,
    assets: value.assets,
  };
  if (value.release_id !== `ahr1_${sha256(canonicalBytes(identity))}`) errors.push('release_id does not match manifest content');
  return errors;
}

export function buildReleaseManifest(rootDir) {
  const root = path.resolve(rootDir);
  const parsedAssets = new Map();
  const assets = MANAGED_ASSETS.map(relative => {
    const absolute = path.resolve(root, relative);
    if (path.relative(root, absolute).startsWith('..') || absolute === root) throw new Error(`asset escapes release root: ${relative}`);
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`managed release asset is not a regular file: ${relative}`);
    const raw = fs.readFileSync(absolute);
    let parsed;
    try { parsed = JSON.parse(raw.toString('utf8')); }
    catch { throw new Error(`managed release asset is not valid JSON: ${relative}`); }
    parsedAssets.set(relative, parsed);
    return {
      path: relative,
      sha256: sha256(raw),
      bytes: raw.byteLength,
      media_type: 'application/json',
      schema_version: assetSchemaVersion(relative, parsed),
      required: true,
    };
  });
  const contentDescriptor = assets.map(({ path: assetPath, sha256: digest, bytes, schema_version }) => ({
    path: assetPath, sha256: digest, bytes, schema_version,
  }));
  const identity = {
    schema_version: RELEASE_SCHEMA_VERSION,
    compatibility_version: RELEASE_COMPATIBILITY_VERSION,
    cache_version: RELEASE_CACHE_VERSION,
    created_at: releaseCreatedAt(parsedAssets),
    content_set_sha256: sha256(canonicalBytes(contentDescriptor)),
    assets,
  };
  const manifest = {...identity, release_id: `ahr1_${sha256(canonicalBytes(identity))}`};
  const ordered = {
    schema_version: manifest.schema_version,
    compatibility_version: manifest.compatibility_version,
    cache_version: manifest.cache_version,
    release_id: manifest.release_id,
    created_at: manifest.created_at,
    content_set_sha256: manifest.content_set_sha256,
    assets: manifest.assets,
  };
  const errors = validateReleaseManifest(ordered);
  if (errors.length) throw new Error(`generated release manifest is invalid: ${errors.join('; ')}`);
  return ordered;
}

export function writeReleaseManifest(rootDir, outputPath = path.join(rootDir, 'data/release-manifest.json')) {
  const root = path.resolve(rootDir);
  const output = path.resolve(outputPath);
  const expected = path.resolve(root, 'data/release-manifest.json');
  if (output !== expected) throw new Error('release manifest output must be data/release-manifest.json inside the release root');
  const manifest = buildReleaseManifest(root);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = `${output}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {flag:'wx'});
  fs.renameSync(temporary, output);
  const reread = JSON.parse(fs.readFileSync(output, 'utf8'));
  const errors = validateReleaseManifest(reread);
  if (errors.length) throw new Error(`written release manifest failed verification: ${errors.join('; ')}`);
  return reread;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const rootArg = process.argv[2];
  if (!rootArg) {
    console.error('usage: build-release-manifest.mjs RELEASE_ROOT');
    process.exitCode = 2;
  } else {
    const manifest = writeReleaseManifest(rootArg);
    console.log(`release manifest ready: ${manifest.release_id}`);
  }
}
