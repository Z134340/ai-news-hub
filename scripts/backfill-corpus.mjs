#!/usr/bin/env node
/**
 * backfill-corpus.mjs — 建立／補齊本機「分析鏡像」語料庫。
 *
 * 為什麼需要這支：
 *   前端熱層 data/*.json 只保留 7 天（run-daily.sh 的 prune），但
 *   scripts/cluster_engine.py 的趨勢分析需要「分析視窗 14 天 + 對比基準線 14 天」。
 *   基準線那 14 天在本機早就被 prune 掉，導致 baseline.available = False、
 *   所有 cluster 的 score / score_breakdown 全部是 None（novelty 分項失效）。
 *
 * 解法：把 Firestore 冷封存（archives/{date}，公開可讀）拉回**版控庫以外**的
 *   ~/.ai-news-hub/corpus/，專供分析使用。repo 外 → .git 零膨脹。
 *
 * 安全性：
 *   - archives 的 firestore.rules 是 `allow read: if true`，本腳本只做 GET，
 *     不需要 writer 帳密，也不讀取 ~/.config/ai-news-hub/archiver.env。
 *   - firebaseConfig 的 apiKey 依 AGENTS.md 第 4 條屬非機密，從 assets/js/config.js 解析。
 *   - 只寫入 ~/.ai-news-hub/corpus/，不觸碰 repo 內任何既有檔案。
 *
 * 用法：
 *   node scripts/backfill-corpus.mjs                 # 預設回補 60 個日曆天
 *   node scripts/backfill-corpus.mjs --days 90
 *   node scripts/backfill-corpus.mjs --dry-run
 *   node scripts/backfill-corpus.mjs --prune         # 順手刪掉超出視窗的鏡像
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CONFIG_JS = path.join(REPO_ROOT, 'assets', 'js', 'config.js');
const HOT_DIR = path.join(REPO_ROOT, 'data');
const CORPUS_DIR = path.join(os.homedir(), '.ai-news-hub', 'corpus');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const DAYS = parseInt(opt('--days', '60'), 10);
const DRY_RUN = flag('--dry-run');
const PRUNE = flag('--prune');

if (!Number.isInteger(DAYS) || DAYS < 1) {
  console.error(`✗ --days 必須是正整數，收到：${opt('--days', '')}`);
  process.exit(2);
}

// ── 解析 firebaseConfig（非機密） ──────────────────────────────────────────
function readFirebaseConfig() {
  const src = fs.readFileSync(CONFIG_JS, 'utf8');
  const pick = (key) => {
    const m = src.match(new RegExp(`${key}\\s*:\\s*["']([^"']+)["']`));
    return m ? m[1] : null;
  };
  const apiKey = pick('apiKey');
  const projectId = pick('projectId');
  if (!apiKey || !projectId || apiKey.startsWith('YOUR_') || projectId.startsWith('YOUR_')) {
    throw new Error('assets/js/config.js 的 FIREBASE_CONFIG 尚未填值（apiKey / projectId）');
  }
  return { apiKey, projectId };
}

const { apiKey, projectId } = readFirebaseConfig();
const BASE = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/archives`;

// ── 視窗計算（用 UTC 避免時區跨日誤差；日期字串本身是本地曆日） ──────────
function isoDaysAgo(n) {
  const t = Date.now() - n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
const CUTOFF = isoDaysAgo(DAYS);

// ── 列出冷封存有哪些日期（只取 date 欄位，不拉 payload） ──────────────────
async function listArchiveDates() {
  const dates = [];
  let pageToken = '';
  do {
    const url =
      `${BASE}?key=${apiKey}&pageSize=300&mask.fieldPaths=date` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const r = await fetch(url);
    if (!r.ok) throw new Error(`listDocuments HTTP ${r.status}: ${await r.text()}`);
    const j = await r.json();
    for (const d of j.documents || []) {
      const id = d.name.split('/').pop();
      dates.push(d.fields?.date?.stringValue || id);
    }
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return dates.sort();
}

// ── 取單日全文 ────────────────────────────────────────────────────────────
async function fetchArchive(date) {
  const r = await fetch(`${BASE}/${date}?key=${apiKey}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  const payload = j.fields?.payload?.stringValue;
  if (!payload) throw new Error('doc 無 payload 欄位');
  JSON.parse(payload); // 驗證是合法 JSON，壞掉的不寫進語料庫
  return payload;
}

// ── 主流程 ────────────────────────────────────────────────────────────────
const stats = { hot: 0, cold: 0, skipped: 0, failed: 0, pruned: 0, bytes: 0 };

console.log(`鏡像目錄 : ${CORPUS_DIR}`);
console.log(`視窗     : 最近 ${DAYS} 個日曆天（>= ${CUTOFF}）`);
console.log(`模式     : ${DRY_RUN ? 'DRY-RUN（不寫檔）' : '實際寫入'}${PRUNE ? ' + PRUNE' : ''}`);
console.log('');

if (!DRY_RUN) fs.mkdirSync(CORPUS_DIR, { recursive: true });

// 1) 熱層：本機 data/YYYY-MM-DD.json 直接複製
for (const f of fs.readdirSync(HOT_DIR).sort()) {
  const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
  if (!m) continue;
  const date = m[1];
  if (date < CUTOFF) continue;
  const dst = path.join(CORPUS_DIR, f);
  const src = path.join(HOT_DIR, f);
  const size = fs.statSync(src).size;
  if (!DRY_RUN) fs.copyFileSync(src, dst);
  stats.hot++;
  stats.bytes += size;
}
console.log(`熱層複製 : ${stats.hot} 天`);

// 2) 冷層：Firestore 逐日回補（已存在就跳過，可重複執行）
const coldDates = await listArchiveDates();
const wanted = coldDates.filter((d) => d >= CUTOFF);
console.log(`冷層可用 : ${coldDates.length} 天（全部），視窗內 ${wanted.length} 天`);
console.log(`冷層範圍 : ${coldDates[0] || '-'} → ${coldDates[coldDates.length - 1] || '-'}`);
console.log('');

for (const date of wanted) {
  const dst = path.join(CORPUS_DIR, `${date}.json`);
  if (fs.existsSync(dst)) {
    stats.skipped++;
    continue;
  }
  try {
    const payload = await fetchArchive(date);
    if (!DRY_RUN) fs.writeFileSync(dst, payload);
    stats.cold++;
    stats.bytes += Buffer.byteLength(payload);
    process.stdout.write(`  ✓ ${date} (${(Buffer.byteLength(payload) / 1024).toFixed(0)} KB)\n`);
  } catch (e) {
    stats.failed++;
    process.stdout.write(`  ✗ ${date} — ${e.message}\n`);
  }
}

// 3) 可選：刪掉超出視窗的舊鏡像
if (PRUNE && fs.existsSync(CORPUS_DIR)) {
  for (const f of fs.readdirSync(CORPUS_DIR)) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m || m[1] >= CUTOFF) continue;
    if (!DRY_RUN) fs.unlinkSync(path.join(CORPUS_DIR, f));
    stats.pruned++;
  }
}

// ── 收尾盤點 ──────────────────────────────────────────────────────────────
const present = fs.existsSync(CORPUS_DIR)
  ? fs
      .readdirSync(CORPUS_DIR)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
  : [];

console.log('');
console.log('── 盤點 ──────────────────────────────');
console.log(`熱層複製 : ${stats.hot}`);
console.log(`冷層回補 : ${stats.cold}`);
console.log(`已存在跳過: ${stats.skipped}`);
console.log(`失敗     : ${stats.failed}`);
if (PRUNE) console.log(`已 prune : ${stats.pruned}`);
console.log(`傳輸量   : ${(stats.bytes / 1048576).toFixed(2)} MB`);
console.log(`鏡像現況 : ${present.length} 天，${present[0] || '-'} → ${present[present.length - 1] || '-'}`);

// 覆蓋率：資料天數 / 視窗日曆天數
if (present.length) {
  const spanDays =
    Math.round((Date.parse(present[present.length - 1]) - Date.parse(present[0])) / 86400000) + 1;
  console.log(`覆蓋率   : ${present.length}/${spanDays} = ${((present.length / spanDays) * 100).toFixed(1)}%`);
}

process.exit(stats.failed > 0 ? 1 : 0);
