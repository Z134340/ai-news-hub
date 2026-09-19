import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  VerificationError, appendReceiptEvent, assertBoundIdentity, createReceipt,
  createRollbackExecution, createRollbackPlan, markUploaded, validateReceipt,
  verifyProduction, verifyReceipt,
} from '../post-deploy.mjs';
import {buildReleaseManifest} from '../build-release-manifest.mjs';
import {buildNotification, notificationMarker, shouldNotify} from '../deployment-notification.mjs';

const SHA = 'a'.repeat(40);
const OLD_SHA = 'b'.repeat(40);
const HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-site',
  'cf-ray': 'fixture-TPE',
};

function fixture(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anh-post-deploy-'));
  const payloads = {
    'data/latest.json': {schema_version: 2, date: '2026-09-20', time: '2026-09-20T10:00:00+08:00', data: {topnews: []}},
    'data/health.json': {last_run: '2026-09-20T10:01:00+08:00', status: 'ok'},
    'data/index.json': [{date: '2026-09-20', time: '2026-09-20T10:00:00+08:00'}],
    'data/skills.json': {items: [], _updated_at: '2026-09-20T02:00:00Z'},
    ...overrides,
  };
  for (const [relative, value] of Object.entries(payloads)) {
    const target = path.join(dir, relative);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  }
  const manifest = buildReleaseManifest(dir);
  const assets = Object.fromEntries(manifest.assets.map(asset => [asset.path, fs.readFileSync(path.join(dir, asset.path))]));
  return {dir, manifest, assets, cleanup: () => fs.rmSync(dir, {recursive: true, force: true})};
}

function response(body, kind = 'data', changes = {}) {
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  const values = {
    ...HEADERS,
    'cache-control': kind === 'html' ? 'no-cache, no-store, must-revalidate' : 'no-cache, must-revalidate',
    ...changes.headers,
  };
  return {
    ok: changes.ok ?? true,
    status: changes.status ?? 200,
    headers: {get: name => values[String(name).toLowerCase()] || ''},
    arrayBuffer: async () => raw,
  };
}

function productionFetch(current, options = {}) {
  let manifestReads = 0;
  const calls = [];
  const fetchImpl = async url => {
    const pathname = new URL(url).pathname;
    calls.push(pathname);
    if (options.throwFor === pathname) throw Object.assign(new Error('timeout'), {name: 'AbortError'});
    if (options.missing === pathname) return response('', 'data', {ok: false, status: 404});
    if (pathname === '/') return response('<!doctype html>', 'html', options.headerError === '/' ? {headers: {'x-frame-options': ''}} : {});
    if (pathname === '/data/release-manifest.json') {
      manifestReads += 1;
      const selected = options.manifestSequence?.[manifestReads - 1] || current.manifest;
      return response(JSON.stringify(selected), 'data', options.headerError === pathname ? {headers: {'cache-control': ''}} : {});
    }
    const relative = pathname.replace(/^\//, '');
    let raw = current.assets[relative];
    if (options.corrupt === pathname) raw = Buffer.from('{"mixed":true}\n');
    if (options.rawOverride?.[pathname]) raw = options.rawOverride[pathname];
    return response(raw, 'data', options.headerError === pathname ? {headers: {'cf-ray': ''}} : {});
  };
  return {fetchImpl, calls, manifestReads: () => manifestReads};
}

function receiptFor(manifest, sha = SHA, kind = 'deployment') {
  return createReceipt({
    kind, receiptId: `${kind}-100-1`, deploySha: sha, ciSha: sha, checkoutSha: sha,
    ciRunId: '90', workflowRunId: '100', workflowRunAttempt: 1,
    expectedManifest: manifest,
    clock: () => new Date('2026-09-20T03:00:00Z'),
  });
}

async function expectCode(promise, code) {
  await assert.rejects(promise, error => error instanceof VerificationError && error.code === code);
}

test('matching production bytes, headers, identity, and SHAs create a verified receipt', async () => {
  const fx = fixture();
  try {
    const mock = productionFetch(fx);
    const receipt = receiptFor(fx.manifest);
    markUploaded(receipt, 'https://example.pages.dev');
    await verifyReceipt(receipt, {fetchImpl: mock.fetchImpl, attempts: 1, sleep: async () => {}});
    assert.equal(receipt.final_status, 'verified');
    assert.deepEqual(receipt.events.map(event => event.status), ['requested', 'uploaded', 'verified']);
    assert.equal(receipt.verification.assets.length, 4);
    validateReceipt(receipt, {requireFinal: true});
  } finally { fx.cleanup(); }
});

test('stale production release retries within the bound and then fails without verification', async () => {
  const expected = fixture(); const old = fixture({'data/health.json': {last_run: '2026-09-19T10:01:00+08:00', status: 'ok'}});
  try {
    const mock = productionFetch(old);
    await expectCode(verifyProduction({expectedManifest: expected.manifest, fetchImpl: mock.fetchImpl, attempts: 3, baseDelayMs: 0, sleep: async () => {}}), 'stale_release');
    assert.equal(mock.manifestReads(), 3);
  } finally { expected.cleanup(); old.cleanup(); }
});

test('CDN convergence can succeed on a bounded retry', async () => {
  const expected = fixture(); const old = fixture({'data/health.json': {last_run: '2026-09-19T10:01:00+08:00', status: 'ok'}});
  try {
    const mock = productionFetch(expected, {manifestSequence: [old.manifest, expected.manifest]});
    const result = await verifyProduction({expectedManifest: expected.manifest, fetchImpl: mock.fetchImpl, attempts: 2, baseDelayMs: 0, sleep: async () => {}});
    assert.equal(result.manifest.release_id, expected.manifest.release_id);
    assert.deepEqual(result.observations.map(row => row.status), ['failed', 'verified']);
  } finally { expected.cleanup(); old.cleanup(); }
});

test('manifest schema, release identity, asset bytes, size, HTTP, headers, and timeout fail closed', async t => {
  const fx = fixture();
  try {
    const invalidSchema = {...fx.manifest, schema_version: 99};
    await t.test('schema', async () => expectCode(verifyProduction({fetchImpl: productionFetch(fx, {manifestSequence: [invalidSchema]}).fetchImpl, attempts: 1}), 'manifest_invalid'));
    const invalidIdentity = {...fx.manifest, release_id: `ahr1_${'0'.repeat(64)}`};
    await t.test('release identity', async () => expectCode(verifyProduction({fetchImpl: productionFetch(fx, {manifestSequence: [invalidIdentity]}).fetchImpl, attempts: 1}), 'manifest_invalid'));
    await t.test('mixed asset bytes and size', async () => expectCode(verifyProduction({expectedManifest: fx.manifest, fetchImpl: productionFetch(fx, {corrupt: '/data/health.json'}).fetchImpl, attempts: 1}), 'asset_size_mismatch'));
    const original = fx.assets['data/health.json'];
    const sameSize = Buffer.from(original); sameSize[0] = sameSize[0] === 123 ? 91 : 123;
    await t.test('asset hash', async () => expectCode(verifyProduction({expectedManifest: fx.manifest, fetchImpl: productionFetch(fx, {rawOverride: {'/data/health.json': sameSize}}).fetchImpl, attempts: 1}), 'asset_hash_mismatch'));
    await t.test('missing file', async () => expectCode(verifyProduction({expectedManifest: fx.manifest, fetchImpl: productionFetch(fx, {missing: '/data/index.json'}).fetchImpl, attempts: 1}), 'http_status'));
    await t.test('bad header', async () => expectCode(verifyProduction({expectedManifest: fx.manifest, fetchImpl: productionFetch(fx, {headerError: '/data/release-manifest.json'}).fetchImpl, attempts: 1}), 'header_mismatch'));
    await t.test('timeout', async () => expectCode(verifyProduction({expectedManifest: fx.manifest, fetchImpl: productionFetch(fx, {throwFor: '/'}).fetchImpl, attempts: 1}), 'timeout'));
    await t.test('response body timeout', async () => {
      const stalled = async (_url, init) => ({
        ok: true,
        headers: response('', 'html').headers,
        arrayBuffer: () => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {name: 'AbortError'})))),
      });
      await expectCode(verifyProduction({fetchImpl: stalled, attempts: 1, timeoutMs: 5}), 'timeout');
    });
  } finally { fx.cleanup(); }
});

test('CI, deployment, and checkout SHA mismatch is rejected before upload', () => {
  assert.throws(() => assertBoundIdentity({deploySha: SHA, ciSha: OLD_SHA, checkoutSha: SHA}), /must be identical/);
  const fx = fixture();
  try {
    assert.throws(() => createReceipt({receiptId: 'bad', deploySha: SHA, ciSha: SHA, checkoutSha: OLD_SHA, ciRunId: '1', workflowRunId: '2', workflowRunAttempt: 1, expectedManifest: fx.manifest}), /must be identical/);
  } finally { fx.cleanup(); }
});

test('verified receipt and notification are idempotent for the same release/deployment identity', async () => {
  const fx = fixture();
  try {
    const receipt = receiptFor(fx.manifest);
    markUploaded(receipt, 'https://example.pages.dev');
    await verifyReceipt(receipt, {fetchImpl: productionFetch(fx).fetchImpl, attempts: 1});
    assert.throws(() => appendReceiptEvent(receipt, 'verified', 'again'), /terminal/);
    const rerun = createReceipt({
      receiptId: 'deployment-101-1', deploySha: SHA, ciSha: SHA, checkoutSha: SHA,
      ciRunId: '90', workflowRunId: '101', workflowRunAttempt: 1, expectedManifest: fx.manifest,
    });
    assert.equal(rerun.idempotency_key, receipt.idempotency_key);
    const notification = buildNotification(receipt, {data: {topnews: [{title: 'x'}]}});
    assert.match(notification.body, new RegExp(receipt.deploy_sha));
    assert.equal(shouldNotify(receipt, []), true);
    assert.equal(shouldNotify(receipt, [{body: notificationMarker(receipt)}]), false);
  } finally { fx.cleanup(); }
});

test('post-deploy failure appends failed evidence and cannot produce a success notification', async () => {
  const expected = fixture(); const old = fixture({'data/health.json': {last_run: '2026-09-19T10:01:00+08:00', status: 'ok'}});
  try {
    const receipt = receiptFor(expected.manifest);
    markUploaded(receipt, 'https://example.pages.dev');
    await expectCode(verifyReceipt(receipt, {fetchImpl: productionFetch(old).fetchImpl, attempts: 1}), 'stale_release');
    assert.deepEqual(receipt.events.map(event => event.status), ['requested', 'uploaded', 'failed']);
    assert.equal(receipt.final_status, 'failed');
    assert.throws(() => buildNotification(receipt), /verified receipt/);
  } finally { expected.cleanup(); old.cleanup(); }
});

test('rollback plan is dry-run only, exact, and rejects unknown or unrebuildable targets', async () => {
  const target = fixture(); const current = fixture({'data/health.json': {last_run: '2026-09-20T11:01:00+08:00', status: 'ok'}});
  try {
    const targetReceipt = receiptFor(target.manifest, SHA);
    markUploaded(targetReceipt, 'https://target.pages.dev');
    await verifyReceipt(targetReceipt, {fetchImpl: productionFetch(target).fetchImpl, attempts: 1});
    const calls = productionFetch(current);
    const plan = await createRollbackPlan({
      targetReceipt, targetManifest: target.manifest, targetSha: SHA, expectedReleaseId: target.manifest.release_id,
      workflowRunId: '200', workflowRunAttempt: 1, fetchOptions: {fetchImpl: calls.fetchImpl, attempts: 1},
    });
    assert.equal(plan.rollback.dry_run, true);
    assert.equal(plan.final_status, 'requested');
    assert.equal(plan.rollback.target_release_id, target.manifest.release_id);
    assert.equal(plan.rollback.current_release_id, current.manifest.release_id);
    assert.deepEqual(plan.rollback.actions, ['checkout_exact_target', 'rebuild_allowlisted_artifact', 'upload_cloudflare_main', 'verify_stable_production_url']);

    const unverified = receiptFor(target.manifest, SHA);
    await expectCode(createRollbackPlan({targetReceipt: unverified, targetManifest: target.manifest, targetSha: SHA, expectedReleaseId: target.manifest.release_id, workflowRunId: '201', workflowRunAttempt: 1, fetchOptions: {fetchImpl: calls.fetchImpl, attempts: 1}}), 'receipt_unverified');
    const rebuiltWrong = fixture({'data/health.json': {last_run: '2026-09-18T10:01:00+08:00', status: 'ok'}});
    try {
      await expectCode(createRollbackPlan({targetReceipt, targetManifest: rebuiltWrong.manifest, targetSha: SHA, expectedReleaseId: target.manifest.release_id, workflowRunId: '202', workflowRunAttempt: 1, fetchOptions: {fetchImpl: calls.fetchImpl, attempts: 1}}), 'rollback_rebuild_mismatch');
    } finally { rebuiltWrong.cleanup(); }
  } finally { target.cleanup(); current.cleanup(); }
});

test('rollback execution requires the prior plan, rejects stale production, and verifies with the same verifier', async () => {
  const target = fixture(); const current = fixture({'data/health.json': {last_run: '2026-09-20T12:01:00+08:00', status: 'ok'}});
  try {
    const targetReceipt = receiptFor(target.manifest, SHA);
    markUploaded(targetReceipt, 'https://target.pages.dev');
    await verifyReceipt(targetReceipt, {fetchImpl: productionFetch(target).fetchImpl, attempts: 1});
    const plan = await createRollbackPlan({targetReceipt, targetManifest: target.manifest, targetSha: SHA, expectedReleaseId: target.manifest.release_id, workflowRunId: '300', workflowRunAttempt: 1, fetchOptions: {fetchImpl: productionFetch(current).fetchImpl, attempts: 1}});
    const execution = await createRollbackExecution({planReceipt: plan, targetReceipt, targetManifest: target.manifest, workflowRunId: '301', workflowRunAttempt: 1, fetchOptions: {fetchImpl: productionFetch(current).fetchImpl, attempts: 1}});
    assert.equal(execution.rollback.source_plan_receipt_id, plan.receipt_id);
    markUploaded(execution, 'https://rollback.pages.dev');
    await verifyReceipt(execution, {fetchImpl: productionFetch(target).fetchImpl, attempts: 1});
    assert.equal(execution.final_status, 'verified');

    const changed = fixture({'data/health.json': {last_run: '2026-09-20T13:01:00+08:00', status: 'partial'}});
    try {
      await expectCode(createRollbackExecution({planReceipt: plan, targetReceipt, targetManifest: target.manifest, workflowRunId: '302', workflowRunAttempt: 1, fetchOptions: {fetchImpl: productionFetch(changed).fetchImpl, attempts: 1}}), 'rollback_plan_stale');
    } finally { changed.cleanup(); }
  } finally { target.cleanup(); current.cleanup(); }
});
