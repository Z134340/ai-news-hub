import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('offline selftest includes pinned GitHub Actions semantic validation', () => {
  const workflow = read('.github/workflows/selftest.yml');
  assert.match(workflow, /name: GitHub Actions semantic validation/);
  assert.match(workflow, /ACTIONLINT_VERSION: '1\.7\.12'/);
  assert.match(workflow, /ACTIONLINT_SHA256: [a-f0-9]{64}/);
  assert.match(workflow, /actionlint" \.github\/workflows\/\*\.yml/);
});

test('production workflow pins manual target and notifies only after stable verification', () => {
  const workflow = read('.github/workflows/cloudflare-pages.yml');
  assert.match(workflow, /target_sha:[\s\S]*required: true/);
  assert.match(workflow, /ci_run_id:[\s\S]*required: true/);
  assert.match(workflow, /expected_release_id:[\s\S]*required: true/);
  const upload = workflow.indexOf('Deploy validated revision to Cloudflare Pages');
  const verify = workflow.indexOf('Verify stable production URL');
  const notify = workflow.indexOf('uses: ./.github/workflows/notify.yml');
  assert.ok(upload > 0 && verify > upload && notify > verify);
  assert.match(workflow, /needs\.deploy\.result == 'success'/);
  assert.match(workflow, /if: failure\(\) && steps\.requested\.outcome == 'success'/);
  assert.doesNotMatch(workflow, /paths:\s*\n\s*- data\/latest\.json/);
  assert.match(workflow, /RUNTIME_RECEIPT_PATH: \$\{\{ runner\.temp \}\}\/deployment-receipt\.json/);
  assert.doesNotMatch(workflow, /^      RECEIPT_PATH: \$\{\{ runner\.temp \}\}/m);
});

test('notification workflow requires a verified receipt and contains an idempotency gate', () => {
  const workflow = read('.github/workflows/notify.yml');
  assert.match(workflow, /--status verified/);
  assert.match(workflow, /shouldNotify/);
  assert.match(workflow, /state: 'all'/);
  assert.match(workflow, /production-notify-/);
  assert.doesNotMatch(workflow, /^\s*push:/m);
});

test('rollback workflow separates plan and execute and reuses the verifier after upload', () => {
  const workflow = read('.github/workflows/cloudflare-rollback.yml');
  assert.match(workflow, /options: \[plan, execute\]/);
  assert.match(workflow, /rollback-plan/);
  assert.match(workflow, /rollback-init/);
  assert.match(workflow, /Download prior dry-run plan/);
  const upload = workflow.indexOf('Upload rollback target to Cloudflare Pages');
  const verify = workflow.indexOf('Verify rolled-back production with the shared verifier');
  assert.ok(upload > 0 && verify > upload);
  assert.match(workflow, /inputs\.mode == 'execute'/);
  assert.match(workflow, /RUNTIME_RECEIPT_PATH: \$\{\{ runner\.temp \}\}\/rollback-receipt\.json/);
  assert.match(workflow, /RUNTIME_TARGET_RECEIPT_PATH: \$\{\{ runner\.temp \}\}\/target-evidence\/deployment-receipt\.json/);
  assert.match(workflow, /RUNTIME_PLAN_RECEIPT_PATH: \$\{\{ runner\.temp \}\}\/plan-evidence\/rollback-receipt\.json/);
  assert.doesNotMatch(workflow, /^      (?:RECEIPT_PATH|TARGET_RECEIPT_PATH|PLAN_RECEIPT_PATH): \$\{\{ runner\.temp \}\}/m);
});
