#!/usr/bin/env node
/* AI News Hub — archive-to-firestore.mjs
 * 把「逾期的每日 archive」(data/YYYY-MM-DD.json) 冷封存到 Firestore。
 *
 * 安全模型：scoped writer（最小權限）。以一個專用 Email/Password 帳號登入取得 idToken，
 *   Firestore 規則僅允許該帳號的 uid 寫 archives；讀為公開。無 service account、無專案級金鑰。
 * 傳輸：raw REST（Node 18+ 內建 fetch），零 npm 依賴。
 * 文件格式：archives/{date} = { date, generated_at, item_count, pass_rate, source, payload }
 *   payload 為當日完整 JSON 的字串（單一 stringValue，避開巢狀型別；≤1MiB，實測最大 ~312KB）。
 *
 * 憑證來源（擇一）：環境變數，或 env 檔（預設 ~/.config/ai-news-hub/archiver.env，可用 ARCHIVER_ENV 覆寫）：
 *   FB_API_KEY=...
 *   FB_PROJECT_ID=ai-news-hub-xxxx
 *   WRITER_EMAIL=archiver@example.com
 *   WRITER_PASSWORD=...
 *
 * 用法：
 *   node scripts/archive-to-firestore.mjs --all            # 上傳全部 dated archive（一次性遷移）
 *   node scripts/archive-to-firestore.mjs --older-than 7   # 只上傳逾 7 天者（run-daily 每日用）
 *   加 --prune 於上傳成功後刪除本機該檔（讓它從 git 移除）
 *   加 --dry-run 只列出將處理的檔案，不連線
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA_DIR = path.join(ROOT, 'data');

// ---- 參數 ----
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valOf = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const MODE_ALL = has('--all');
const OLDER_THAN = parseInt(valOf('--older-than', MODE_ALL ? '-1' : '7'), 10);
const PRUNE = has('--prune');
const DRY = has('--dry-run');

// ---- 載入憑證 ----
function loadEnv() {
  const envPath = process.env.ARCHIVER_ENV || path.join(os.homedir(), '.config', 'ai-news-hub', 'archiver.env');
  const cfg = { ...process.env };
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m) cfg[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  const need = ['FB_API_KEY', 'FB_PROJECT_ID', 'WRITER_EMAIL', 'WRITER_PASSWORD'];
  const missing = need.filter((k) => !cfg[k]);
  if (missing.length && !DRY) {
    console.error(`✗ 缺少憑證：${missing.join(', ')}（檢查 ${envPath} 或環境變數）`);
    process.exit(2);
  }
  return cfg;
}

// ---- 找出要處理的 archive ----
function pickFiles() {
  const re = /^(\d{4}-\d{2}-\d{2})\.json$/;
  const cutoff = new Date(Date.now() - OLDER_THAN * 86400000).toISOString().slice(0, 10);
  return fs.readdirSync(DATA_DIR)
    .map((f) => { const m = f.match(re); return m ? { file: f, date: m[1] } : null; })
    .filter(Boolean)
    .filter((x) => OLDER_THAN < 0 ? true : x.date < cutoff)   // --all：全部；否則只取早於 cutoff
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---- Firebase Auth REST：登入取 idToken ----
async function signIn(cfg) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${cfg.FB_API_KEY}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cfg.WRITER_EMAIL, password: cfg.WRITER_PASSWORD, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`登入失敗：${j.error?.message || r.status}`);
  return j.idToken;
}

// ---- Firestore REST：寫一筆 archives/{date} ----
async function putArchive(cfg, idToken, date, raw) {
  let obj; try { obj = JSON.parse(raw); } catch { obj = {}; }
  const stats = obj.stats && typeof obj.stats === 'object' ? obj.stats : {};
  const itemCount = Object.values(stats).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
  const passRate = String(obj.validation?.pass_rate ?? '');
  const fields = {
    date:         { stringValue: date },
    generated_at: { stringValue: String(obj.time || obj.generated_at || '') },
    item_count:   { integerValue: String(itemCount) },
    pass_rate:    { stringValue: passRate },
    source:       { stringValue: String(obj.source || 'local') },
    payload:      { stringValue: raw },
  };
  const url = `https://firestore.googleapis.com/v1/projects/${cfg.FB_PROJECT_ID}/databases/(default)/documents/archives/${date}`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(`寫入 ${date} 失敗：${j.error?.message || r.status}`); }
}

// ---- 主流程 ----
(async () => {
  const targets = pickFiles();
  if (!targets.length) { console.log('沒有符合條件的 archive，結束。'); process.exit(0); }
  console.log(`將處理 ${targets.length} 個 archive：${targets[0].date} … ${targets[targets.length - 1].date}` + (PRUNE ? '（成功後 prune 本機）' : ''));
  if (DRY) { targets.forEach((t) => console.log('  [dry] ' + t.file)); process.exit(0); }

  const cfg = loadEnv();
  const idToken = await signIn(cfg);
  let ok = 0, fail = 0;
  for (const t of targets) {
    const fp = path.join(DATA_DIR, t.file);
    try {
      await putArchive(cfg, idToken, t.date, fs.readFileSync(fp, 'utf8'));
      ok++;
      if (PRUNE) fs.rmSync(fp);          // 僅在該檔上傳成功後刪除，確保不遺失
      console.log(`  ✓ ${t.date}` + (PRUNE ? ' (pruned)' : ''));
    } catch (e) {
      fail++; console.error(`  ✗ ${t.date}: ${e.message}`);
    }
  }
  console.log(`完成：成功 ${ok}、失敗 ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
