#!/usr/bin/env node
/* Fail-closed production verification and immutable deployment/rollback receipts. */

import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateReleaseManifest} from './build-release-manifest.mjs';

export const RECEIPT_SCHEMA_VERSION = 1;
export const PRODUCTION_URL = 'https://ai-news-hub-7jk.pages.dev';
const SHA_RE = /^[a-f0-9]{40}$/;
const RELEASE_RE = /^ahr1_[a-f0-9]{64}$/;
const FINAL_STATUSES = new Set(['verified', 'failed']);

export class VerificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VerificationError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new VerificationError(code, message);
}

function sha256(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

function nowIso(clock = () => new Date()) {
  return clock().toISOString();
}

function assertSha(value, label) {
  if (!SHA_RE.test(value || '')) fail('identity_invalid', `${label} must be a full lowercase commit SHA`);
}

function assertHttpsUrl(value, label) {
  let parsed;
  try { parsed = new URL(value); } catch { fail('url_invalid', `${label} must be an absolute URL`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) fail('url_invalid', `${label} must be a credential-free HTTPS URL`);
  return parsed.toString().replace(/\/$/, '');
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail('json_invalid', `${path.basename(file)} is not readable JSON: ${error.message}`); }
}

function writeJsonAtomic(file, value, {exclusive = false} = {}) {
  fs.mkdirSync(path.dirname(path.resolve(file)), {recursive: true});
  if (exclusive && fs.existsSync(file)) fail('receipt_exists', `receipt already exists: ${file}`);
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {flag: 'wx'});
  fs.renameSync(temporary, file);
}

function headerValue(response, name) {
  return String(response.headers?.get?.(name) || '').trim();
}

function requireExactHeader(response, name, expected) {
  const actual = headerValue(response, name).toLowerCase();
  if (actual !== expected.toLowerCase()) fail('header_mismatch', `${name} header mismatch`);
}

function requireTokens(response, name, expected) {
  const actual = headerValue(response, name).toLowerCase();
  for (const token of expected) if (!actual.includes(token.toLowerCase())) fail('header_mismatch', `${name} header is missing ${token}`);
}

function verifyHeaders(response, kind, requireCfRay) {
  requireExactHeader(response, 'x-content-type-options', 'nosniff');
  requireExactHeader(response, 'x-frame-options', 'deny');
  requireExactHeader(response, 'referrer-policy', 'strict-origin-when-cross-origin');
  requireExactHeader(response, 'cross-origin-opener-policy', 'same-origin');
  requireExactHeader(response, 'cross-origin-resource-policy', 'same-site');
  requireTokens(response, 'permissions-policy', ['camera=()', 'microphone=()', 'geolocation=()', 'payment=()', 'usb=()']);
  if (kind === 'html') requireTokens(response, 'cache-control', ['no-cache', 'no-store', 'must-revalidate']);
  else requireTokens(response, 'cache-control', ['no-cache', 'must-revalidate']);
  if (requireCfRay && !headerValue(response, 'cf-ray')) fail('header_mismatch', 'Cf-Ray header is missing');
}

async function fetchBytes(url, {fetchImpl, timeoutMs, kind, requireCfRay}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
      headers: {'accept': kind === 'html' ? 'text/html' : 'application/json'},
    });
    if (!response || !response.ok) fail('http_status', `non-success response for ${new URL(url).pathname}`);
    verifyHeaders(response, kind, requireCfRay);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof VerificationError) throw error;
    fail(error?.name === 'AbortError' ? 'timeout' : 'http_error', `request failed for ${new URL(url).pathname}`);
  } finally {
    clearTimeout(timeout);
  }
}

function validateManifest(value, label) {
  const errors = validateReleaseManifest(value);
  if (errors.length) fail('manifest_invalid', `${label} failed validation: ${errors.join('; ')}`);
  return value;
}

function expectedManifestFromReceipt(receipt) {
  return {
    schema_version: receipt.expected.schema_version,
    compatibility_version: receipt.expected.compatibility_version,
    cache_version: receipt.expected.cache_version,
    release_id: receipt.expected.release_id,
    created_at: receipt.expected.created_at,
    content_set_sha256: receipt.expected.content_set_sha256,
    assets: receipt.expected.assets,
  };
}

function sameManifestIdentity(actual, expected) {
  return actual.release_id === expected.release_id
    && actual.content_set_sha256 === expected.content_set_sha256
    && JSON.stringify(actual.assets) === JSON.stringify(expected.assets);
}

export function assertBoundIdentity({deploySha, ciSha, checkoutSha}) {
  assertSha(deploySha, 'DEPLOY_SHA');
  assertSha(ciSha, 'CI SHA');
  assertSha(checkoutSha, 'checkout SHA');
  if (deploySha !== ciSha || deploySha !== checkoutSha) {
    fail('sha_mismatch', 'DEPLOY_SHA, CI SHA, and checkout SHA must be identical');
  }
}

export async function verifyProduction({
  baseUrl = PRODUCTION_URL,
  expectedManifest = null,
  fetchImpl = globalThis.fetch,
  attempts = 5,
  baseDelayMs = 1000,
  timeoutMs = 10000,
  requireCfRay = true,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
  const stableBase = assertHttpsUrl(baseUrl, 'production URL');
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) fail('retry_invalid', 'attempts must be between 1 and 10');
  if (expectedManifest) validateManifest(expectedManifest, 'expected manifest');
  const observations = [];
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const nonce = `ah04=${Date.now()}-${attempt}`;
      await fetchBytes(`${stableBase}/?${nonce}`, {fetchImpl, timeoutMs, kind: 'html', requireCfRay});
      const manifestRaw = await fetchBytes(`${stableBase}/data/release-manifest.json?${nonce}`, {
        fetchImpl, timeoutMs, kind: 'data', requireCfRay,
      });
      let manifest;
      try { manifest = JSON.parse(manifestRaw.toString('utf8')); }
      catch { fail('manifest_json_invalid', 'production manifest is not valid JSON'); }
      validateManifest(manifest, 'production manifest');
      if (expectedManifest && !sameManifestIdentity(manifest, expectedManifest)) {
        fail('stale_release', 'production manifest does not match the expected release identity');
      }
      const assets = [];
      for (const asset of manifest.assets) {
        const raw = await fetchBytes(`${stableBase}/${asset.path}?${nonce}`, {
          fetchImpl, timeoutMs, kind: 'data', requireCfRay,
        });
        if (raw.byteLength !== asset.bytes) fail('asset_size_mismatch', `${asset.path} byte length mismatch`);
        if (sha256(raw) !== asset.sha256) fail('asset_hash_mismatch', `${asset.path} SHA-256 mismatch`);
        try { JSON.parse(raw.toString('utf8')); }
        catch { fail('asset_json_invalid', `${asset.path} is not valid JSON`); }
        assets.push({path: asset.path, bytes: raw.byteLength, sha256: asset.sha256});
      }
      observations.push({attempt, status: 'verified'});
      return {manifest, observations, assets};
    } catch (error) {
      lastError = error instanceof VerificationError ? error : new VerificationError('unexpected', 'unexpected verifier failure');
      observations.push({attempt, status: 'failed', error_code: lastError.code});
      if (attempt < attempts) await sleep(Math.min(baseDelayMs * (2 ** (attempt - 1)), 15000));
    }
  }
  lastError.observations = observations;
  throw lastError;
}

function receiptExpected(manifest) {
  return {
    schema_version: manifest.schema_version,
    compatibility_version: manifest.compatibility_version,
    cache_version: manifest.cache_version,
    release_id: manifest.release_id,
    created_at: manifest.created_at,
    content_set_sha256: manifest.content_set_sha256,
    assets: manifest.assets,
  };
}

export function validateReceipt(receipt, {requireFinal = false} = {}) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) fail('receipt_invalid', 'receipt must be an object');
  if (receipt.schema_version !== RECEIPT_SCHEMA_VERSION) fail('receipt_invalid', 'unsupported receipt schema');
  if (!['deployment', 'rollback'].includes(receipt.kind)) fail('receipt_invalid', 'unsupported receipt kind');
  if (!Array.isArray(receipt.events) || !receipt.events.length) fail('receipt_invalid', 'receipt has no event history');
  assertBoundIdentity({deploySha: receipt.deploy_sha, ciSha: receipt.ci?.sha, checkoutSha: receipt.checkout_sha});
  validateManifest(expectedManifestFromReceipt(receipt), 'receipt expected manifest');
  const expectedKey = `${receipt.kind}:${receipt.deploy_sha}:${receipt.expected.release_id}`;
  if (receipt.idempotency_key !== expectedKey) fail('receipt_invalid', 'receipt idempotency key does not match identity');
  let prior = 0;
  for (const event of receipt.events) {
    if (!Number.isInteger(event.sequence) || event.sequence !== prior + 1) fail('receipt_invalid', 'receipt event sequence is not append-only');
    if (!['requested', 'uploaded', 'verified', 'failed'].includes(event.status)) fail('receipt_invalid', 'receipt event has unsupported status');
    prior = event.sequence;
  }
  const final = receipt.events.at(-1).status;
  if (receipt.final_status !== final) fail('receipt_invalid', 'receipt final_status does not match event history');
  if (requireFinal && !FINAL_STATUSES.has(final)) fail('receipt_unverified', 'receipt is not terminal');
  return receipt;
}

export function createReceipt({
  kind = 'deployment', receiptId, deploySha, ciSha, checkoutSha, ciRunId,
  workflowRunId, workflowRunAttempt, productionUrl = PRODUCTION_URL,
  expectedManifest, rollback = null, clock,
}) {
  assertBoundIdentity({deploySha, ciSha, checkoutSha});
  validateManifest(expectedManifest, 'expected manifest');
  const requestedAt = nowIso(clock);
  const receipt = {
    schema_version: RECEIPT_SCHEMA_VERSION,
    receipt_id: receiptId,
    kind,
    idempotency_key: `${kind}:${deploySha}:${expectedManifest.release_id}`,
    deploy_sha: deploySha,
    checkout_sha: checkoutSha,
    ci: {run_id: String(ciRunId), sha: ciSha},
    workflow: {run_id: String(workflowRunId), run_attempt: Number(workflowRunAttempt)},
    production_url: assertHttpsUrl(productionUrl, 'production URL'),
    cloudflare_deployment_url: null,
    expected: receiptExpected(expectedManifest),
    rollback,
    events: [{sequence: 1, status: 'requested', stage: 'preflight', at: requestedAt}],
    final_status: 'requested',
    verification: null,
  };
  validateReceipt(receipt);
  return receipt;
}

export function appendReceiptEvent(receipt, status, stage, {details = null, clock} = {}) {
  validateReceipt(receipt);
  if (FINAL_STATUSES.has(receipt.final_status)) fail('receipt_terminal', 'cannot append to a terminal receipt');
  const allowed = receipt.final_status === 'requested'
    ? new Set(['uploaded', 'failed'])
    : new Set(['verified', 'failed']);
  if (!allowed.has(status)) fail('receipt_transition_invalid', `${receipt.final_status} cannot transition to ${status}`);
  receipt.events.push({
    sequence: receipt.events.length + 1,
    status,
    stage,
    at: nowIso(clock),
    ...(details ? {details} : {}),
  });
  receipt.final_status = status;
  return receipt;
}

export function markUploaded(receipt, deploymentUrl, options = {}) {
  receipt.cloudflare_deployment_url = deploymentUrl ? assertHttpsUrl(deploymentUrl, 'Cloudflare deployment URL') : null;
  return appendReceiptEvent(receipt, 'uploaded', 'cloudflare_upload', options);
}

export async function verifyReceipt(receipt, options = {}) {
  validateReceipt(receipt);
  if (receipt.final_status !== 'uploaded') fail('receipt_transition_invalid', 'verification requires an uploaded receipt');
  try {
    const result = await verifyProduction({
      baseUrl: receipt.production_url,
      expectedManifest: expectedManifestFromReceipt(receipt),
      ...options,
    });
    receipt.verification = {
      attempts: result.observations,
      release_id: result.manifest.release_id,
      content_set_sha256: result.manifest.content_set_sha256,
      assets: result.assets,
    };
    appendReceiptEvent(receipt, 'verified', 'post_deploy_verification', {
      details: {release_id: result.manifest.release_id, asset_count: result.assets.length},
      clock: options.clock,
    });
    return receipt;
  } catch (error) {
    const safe = error instanceof VerificationError ? error : new VerificationError('unexpected', 'unexpected verifier failure');
    receipt.verification = {attempts: safe.observations || [], error_code: safe.code};
    appendReceiptEvent(receipt, 'failed', 'post_deploy_verification', {
      details: {error_code: safe.code}, clock: options.clock,
    });
    throw safe;
  }
}

export async function createRollbackPlan({
  targetReceipt, targetManifest, targetSha, expectedReleaseId,
  workflowRunId, workflowRunAttempt, productionUrl = PRODUCTION_URL,
  fetchOptions = {}, clock,
}) {
  validateReceipt(targetReceipt, {requireFinal: true});
  if (targetReceipt.final_status !== 'verified') fail('rollback_target_unverified', 'rollback target receipt is not verified');
  if (targetReceipt.deploy_sha !== targetSha) fail('rollback_target_mismatch', 'rollback target SHA does not match verified receipt');
  if (!RELEASE_RE.test(expectedReleaseId || '') || targetReceipt.expected.release_id !== expectedReleaseId) {
    fail('rollback_target_mismatch', 'rollback expected release ID does not match verified receipt');
  }
  validateManifest(targetManifest, 'rebuilt rollback manifest');
  if (targetManifest.release_id !== expectedReleaseId || !sameManifestIdentity(targetManifest, expectedManifestFromReceipt(targetReceipt))) {
    fail('rollback_rebuild_mismatch', 'rollback target cannot be rebuilt to the verified release identity');
  }
  const current = await verifyProduction({baseUrl: productionUrl, expectedManifest: null, ...fetchOptions});
  const receipt = createReceipt({
    kind: 'rollback',
    receiptId: `rollback-plan-${workflowRunId}-${workflowRunAttempt}`,
    deploySha: targetSha,
    ciSha: targetReceipt.ci.sha,
    checkoutSha: targetSha,
    ciRunId: targetReceipt.ci.run_id,
    workflowRunId,
    workflowRunAttempt,
    productionUrl,
    expectedManifest: targetManifest,
    rollback: {
      dry_run: true,
      source_verified_receipt_id: targetReceipt.receipt_id,
      current_release_id: current.manifest.release_id,
      current_content_set_sha256: current.manifest.content_set_sha256,
      target_release_id: targetManifest.release_id,
      actions: ['checkout_exact_target', 'rebuild_allowlisted_artifact', 'upload_cloudflare_main', 'verify_stable_production_url'],
    },
    clock,
  });
  return receipt;
}

export async function createRollbackExecution({
  planReceipt, targetReceipt, targetManifest, workflowRunId, workflowRunAttempt,
  productionUrl = PRODUCTION_URL, fetchOptions = {}, clock,
}) {
  validateReceipt(planReceipt);
  validateReceipt(targetReceipt, {requireFinal: true});
  if (planReceipt.kind !== 'rollback' || planReceipt.rollback?.dry_run !== true || planReceipt.final_status !== 'requested') {
    fail('rollback_plan_invalid', 'rollback execution requires a dry-run plan receipt');
  }
  if (targetReceipt.final_status !== 'verified' || targetReceipt.receipt_id !== planReceipt.rollback.source_verified_receipt_id) {
    fail('rollback_target_unverified', 'rollback target evidence changed or is unverified');
  }
  validateManifest(targetManifest, 'rebuilt rollback manifest');
  if (targetManifest.release_id !== planReceipt.expected.release_id || targetReceipt.deploy_sha !== planReceipt.deploy_sha) {
    fail('rollback_plan_stale', 'rollback plan target no longer matches the requested target');
  }
  const current = await verifyProduction({baseUrl: productionUrl, expectedManifest: null, ...fetchOptions});
  if (current.manifest.release_id !== planReceipt.rollback.current_release_id) {
    fail('rollback_plan_stale', 'production identity changed after the rollback plan');
  }
  return createReceipt({
    kind: 'rollback',
    receiptId: `rollback-${workflowRunId}-${workflowRunAttempt}`,
    deploySha: planReceipt.deploy_sha,
    ciSha: targetReceipt.ci.sha,
    checkoutSha: planReceipt.deploy_sha,
    ciRunId: targetReceipt.ci.run_id,
    workflowRunId,
    workflowRunAttempt,
    productionUrl,
    expectedManifest: targetManifest,
    rollback: {
      dry_run: false,
      source_plan_receipt_id: planReceipt.receipt_id,
      source_verified_receipt_id: targetReceipt.receipt_id,
      previous_release_id: current.manifest.release_id,
      target_release_id: targetManifest.release_id,
    },
    clock,
  });
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) fail('usage', `unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) fail('usage', `missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return {command, args};
}

function required(args, key) {
  if (!args[key]) fail('usage', `--${key} is required`);
  return args[key];
}

function numeric(args, key, fallback) {
  const value = args[key] === undefined ? fallback : Number(args[key]);
  if (!Number.isFinite(value)) fail('usage', `--${key} must be numeric`);
  return value;
}

function appendGithubOutput(file, values) {
  if (!file) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n');
  fs.appendFileSync(file, `${lines}\n`);
}

async function cli(argv) {
  const {command, args} = parseArgs(argv);
  if (command === 'init') {
    const manifest = validateManifest(readJson(required(args, 'manifest')), 'expected manifest');
    const receipt = createReceipt({
      receiptId: required(args, 'receipt-id'),
      deploySha: required(args, 'deploy-sha'), ciSha: required(args, 'ci-sha'), checkoutSha: required(args, 'checkout-sha'),
      ciRunId: required(args, 'ci-run-id'), workflowRunId: required(args, 'workflow-run-id'),
      workflowRunAttempt: numeric(args, 'workflow-run-attempt', 1), productionUrl: args['production-url'] || PRODUCTION_URL,
      expectedManifest: manifest,
    });
    writeJsonAtomic(required(args, 'receipt'), receipt, {exclusive: true});
    appendGithubOutput(args['github-output'], {deploy_sha: receipt.deploy_sha, release_id: manifest.release_id, content_set_sha256: manifest.content_set_sha256});
    return;
  }
  if (command === 'uploaded') {
    const file = required(args, 'receipt'); const receipt = readJson(file);
    markUploaded(receipt, args['deployment-url'] || null);
    writeJsonAtomic(file, receipt);
    return;
  }
  if (command === 'failed') {
    const file = required(args, 'receipt'); const receipt = readJson(file);
    if (receipt.final_status === 'failed') return;
    appendReceiptEvent(receipt, 'failed', required(args, 'stage'), {details: {error_code: args['error-code'] || 'step_failed'}});
    writeJsonAtomic(file, receipt);
    return;
  }
  if (command === 'verify') {
    const file = required(args, 'receipt'); const receipt = readJson(file);
    try {
      await verifyReceipt(receipt, {
        attempts: numeric(args, 'attempts', 5), baseDelayMs: numeric(args, 'base-delay-ms', 1000),
        timeoutMs: numeric(args, 'timeout-ms', 10000), requireCfRay: args['require-cf-ray'] !== 'false',
      });
      writeJsonAtomic(file, receipt);
      appendGithubOutput(args['github-output'], {release_id: receipt.expected.release_id, content_set_sha256: receipt.expected.content_set_sha256});
    } catch (error) {
      writeJsonAtomic(file, receipt);
      throw error;
    }
    return;
  }
  if (command === 'inspect') {
    const receipt = validateReceipt(readJson(required(args, 'receipt')), {requireFinal: true});
    if (args.status && receipt.final_status !== args.status) fail('receipt_status_mismatch', `receipt status is ${receipt.final_status}`);
    if (args['deploy-sha'] && receipt.deploy_sha !== args['deploy-sha']) fail('receipt_identity_mismatch', 'receipt deploy SHA mismatch');
    if (args['release-id'] && receipt.expected.release_id !== args['release-id']) fail('receipt_identity_mismatch', 'receipt release ID mismatch');
    return;
  }
  if (command === 'rollback-plan') {
    const receipt = await createRollbackPlan({
      targetReceipt: readJson(required(args, 'target-receipt')),
      targetManifest: readJson(required(args, 'manifest')),
      targetSha: required(args, 'target-sha'), expectedReleaseId: required(args, 'expected-release-id'),
      workflowRunId: required(args, 'workflow-run-id'), workflowRunAttempt: numeric(args, 'workflow-run-attempt', 1),
      productionUrl: args['production-url'] || PRODUCTION_URL,
      fetchOptions: {attempts: numeric(args, 'attempts', 5), baseDelayMs: numeric(args, 'base-delay-ms', 1000), timeoutMs: numeric(args, 'timeout-ms', 10000)},
    });
    writeJsonAtomic(required(args, 'receipt'), receipt, {exclusive: true});
    appendGithubOutput(args['github-output'], {release_id: receipt.expected.release_id, current_release_id: receipt.rollback.current_release_id});
    return;
  }
  if (command === 'rollback-init') {
    const receipt = await createRollbackExecution({
      planReceipt: readJson(required(args, 'plan-receipt')),
      targetReceipt: readJson(required(args, 'target-receipt')),
      targetManifest: readJson(required(args, 'manifest')),
      workflowRunId: required(args, 'workflow-run-id'), workflowRunAttempt: numeric(args, 'workflow-run-attempt', 1),
      productionUrl: args['production-url'] || PRODUCTION_URL,
      fetchOptions: {attempts: numeric(args, 'attempts', 5), baseDelayMs: numeric(args, 'base-delay-ms', 1000), timeoutMs: numeric(args, 'timeout-ms', 10000)},
    });
    writeJsonAtomic(required(args, 'receipt'), receipt, {exclusive: true});
    appendGithubOutput(args['github-output'], {deploy_sha: receipt.deploy_sha, release_id: receipt.expected.release_id, content_set_sha256: receipt.expected.content_set_sha256});
    return;
  }
  fail('usage', 'usage: post-deploy.mjs init|uploaded|failed|verify|inspect|rollback-plan|rollback-init ...');
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  cli(process.argv.slice(2)).catch(error => {
    const code = error instanceof VerificationError ? error.code : 'unexpected';
    console.error(`post-deploy ${code}: ${error.message}`);
    process.exitCode = 1;
  });
}
