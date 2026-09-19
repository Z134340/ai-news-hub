#!/usr/bin/env node
/* Build the allowlisted static artifact deployed by Cloudflare Pages. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeReleaseManifest } from './build-release-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
const REQUIRED_DATA = ['latest.json', 'health.json', 'index.json', 'skills.json'];
const AGENT_DATA = [
  'brief-latest.json', 'roadmap.json', 'system-status.json', 'timeline.json',
  'trend-assessment.json', 'trends.json',
];

function copyFile(relative, { optional = false } = {}) {
  const source = path.join(ROOT, relative);
  if (!fs.existsSync(source)) {
    if (optional) return false;
    throw new Error(`required deployment file is missing: ${relative}`);
  }
  const target = path.join(OUT, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return true;
}

function copyTree(relative) {
  const source = path.join(ROOT, relative);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) copyTree(child);
    else if (entry.isFile()) copyFile(child);
    else throw new Error(`deployment source cannot contain links or special files: ${child}`);
  }
}

function assertJson(relative) {
  JSON.parse(fs.readFileSync(path.join(OUT, relative), 'utf8'));
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
copyFile('index.html');
copyTree('assets');
for (const name of REQUIRED_DATA) copyFile(`data/${name}`);
for (const name of AGENT_DATA) copyFile(`data/agent/${name}`, { optional: true });
for (const name of fs.readdirSync(path.join(ROOT, 'data')).sort()) {
  if (/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) copyFile(`data/${name}`);
}
copyFile('cloudflare/_headers');
fs.renameSync(path.join(OUT, 'cloudflare', '_headers'), path.join(OUT, '_headers'));
fs.rmdirSync(path.join(OUT, 'cloudflare'));

for (const name of REQUIRED_DATA) assertJson(`data/${name}`);
for (const name of fs.readdirSync(path.join(OUT, 'data'))) {
  if (/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) assertJson(`data/${name}`);
}

// The manifest is written last, after every managed file exists and parses.
writeReleaseManifest(OUT);

const forbidden = /(^|\/)(?:\.git|\.env|OPS-RUNBOOK\.md|firestore\.rules|scripts|docs|schemas|candidate|quarantine|store)(?:\/|$)/;
function visit(dir, prefix = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (forbidden.test(relative)) throw new Error(`forbidden deployment path: ${relative}`);
    if (entry.isDirectory()) visit(path.join(dir, entry.name), relative);
  }
}
visit(OUT);
console.log(`Cloudflare artifact ready: ${path.relative(ROOT, OUT)}`);
