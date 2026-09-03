#!/usr/bin/env node
// 把前端 好/中/不好 回饋從 Firestore `feedback/` 讀回本機帳本（human_rating 事件）。
//
// 白話：瀏覽器按鈕 → firebase.js 寫 Firestore → 這支夜班腳本用 writer 帳號整批讀回，
// 逐筆 append 進 ~/.ai-news-hub/learning/events.jsonl。標題與 URL 只進 off-repo 帳本，
// replay-learning.mjs 彙總時只輸出計數與網域（raw_feedback_off_repo 邊界）。
//
// 邊界：
//   - 只讀 Firestore，永不寫回、永不刪除。
//   - archiver.env 不存在 → 印 skipped 並 exit 0（夜班照常跑，不算失敗）。
//   - 游標：~/.ai-news-hub/learning/feedback-cursor.json，用 ts >= last_ts 續讀，
//     seen 表記錄邊界文件避免重複；重新評分產生新 ts 會再讀一次（latest-wins 由 replay 處理）。
//   - 已知限制：取消評分（前端刪文件）不會回傳到帳本。
//
// 用法：node scripts/agent/pull-feedback.mjs [--dry-run] [--self-test]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { appendEvent, LEARNING_DIR } from "./lib/ledger.mjs";

export const CURSOR_FILE = path.join(LEARNING_DIR, "feedback-cursor.json");
const PAGE_SIZE = 500;
const MAX_PAGES = 20;
const RATINGS = new Set(["good", "mid", "bad"]);
const EPOCH = "1970-01-01T00:00:00.000Z";
const REQUIRED_KEYS = ["FB_API_KEY", "FB_PROJECT_ID", "WRITER_EMAIL", "WRITER_PASSWORD"];

// ── 純函式（可離線自測）──────────────────────────────────────────
export function parseEnvText(text, base = {}) {
  const cfg = { ...base };
  for (const line of String(text || "").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    cfg[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return cfg;
}

export function decodeValue(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return !!v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
  return null;
}

export function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = decodeValue(v);
  return out;
}

export function hostOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function uidHash(uid) {
  return createHash("sha256").update(String(uid || "")).digest("hex").slice(0, 8);
}

export function toEvent(doc) {
  const rating = String(doc.rating || "");
  const itemId = String(doc.item_id || "");
  if (!RATINGS.has(rating) || !itemId) return null;
  return {
    ts: doc.ts || new Date().toISOString(),
    event_type: "human_rating",
    actor: "human",
    subject_type: "news_item",
    subject_id: itemId,
    payload: {
      rating,
      cat: String(doc.cat || ""),
      item_date: String(doc.item_date || ""),
      title: String(doc.title || ""),
      url: String(doc.url || ""),
      source: hostOf(doc.url),
      uid_hash: uidHash(doc.uid),
    },
  };
}

export function emptyCursor() {
  return { last_ts: EPOCH, seen: {} };
}

// 已見過且 ts 相同 → 跳過；ts 不同（重新評分）→ 視為新事件。
export function selectNew(docs, cursor) {
  const seen = cursor.seen || {};
  return docs.filter((d) => d.name && d.ts && seen[d.name] !== d.ts);
}

export function advanceCursor(cursor, docs) {
  const next = { last_ts: cursor.last_ts || EPOCH, seen: { ...(cursor.seen || {}) } };
  for (const d of docs) {
    if (!d.name || !d.ts) continue;
    next.seen[d.name] = d.ts;
    if (d.ts > next.last_ts) next.last_ts = d.ts;
  }
  for (const [name, ts] of Object.entries(next.seen)) {
    if (ts < next.last_ts) delete next.seen[name];
  }
  return next;
}

// ── I/O ───────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = process.env.ARCHIVER_ENV || path.join(os.homedir(), ".config", "ai-news-hub", "archiver.env");
  if (!fs.existsSync(envPath)) return null;
  const cfg = parseEnvText(fs.readFileSync(envPath, "utf8"), process.env);
  const missing = REQUIRED_KEYS.filter((k) => !cfg[k]);
  if (missing.length) throw new Error(`archiver.env 缺少：${missing.join(", ")}`);
  return cfg;
}

function loadCursor() {
  try {
    const raw = JSON.parse(fs.readFileSync(CURSOR_FILE, "utf8"));
    return { last_ts: raw.last_ts || EPOCH, seen: raw.seen && typeof raw.seen === "object" ? raw.seen : {} };
  } catch {
    return emptyCursor();
  }
}

function saveCursor(cursor) {
  fs.mkdirSync(LEARNING_DIR, { recursive: true });
  fs.writeFileSync(CURSOR_FILE, `${JSON.stringify(cursor, null, 2)}\n`, "utf8");
}

async function signIn(cfg) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${cfg.FB_API_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: cfg.WRITER_EMAIL, password: cfg.WRITER_PASSWORD, returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`signIn HTTP ${res.status}`);
  const json = await res.json();
  if (!json.idToken) throw new Error("signIn 無 idToken");
  return json.idToken;
}

async function fetchPage(cfg, token, sinceTs) {
  const url = `https://firestore.googleapis.com/v1/projects/${cfg.FB_PROJECT_ID}/databases/(default)/documents:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: "feedback" }],
      where: { fieldFilter: { field: { fieldPath: "ts" }, op: "GREATER_THAN_OR_EQUAL", value: { stringValue: sinceTs } } },
      orderBy: [
        { field: { fieldPath: "ts" }, direction: "ASCENDING" },
        { field: { fieldPath: "__name__" }, direction: "ASCENDING" },
      ],
      limit: PAGE_SIZE,
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`runQuery HTTP ${res.status}`);
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.document)
    .map((r) => ({ name: r.document.name, ...decodeFields(r.document.fields) }));
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--self-test")) return selfTest();
  const dryRun = args.has("--dry-run");

  const cfg = loadEnv();
  if (!cfg) {
    console.log("pull-feedback skipped: archiver.env 不存在");
    return 0;
  }
  const token = await signIn(cfg);
  let cursor = loadCursor();
  let appended = 0;
  let scanned = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const docs = await fetchPage(cfg, token, cursor.last_ts);
    scanned += docs.length;
    const fresh = selectNew(docs, cursor);
    for (const doc of fresh) {
      const event = toEvent(doc);
      if (!event) continue;
      if (!dryRun) appendEvent(event);
      appended += 1;
    }
    cursor = advanceCursor(cursor, docs);
    if (docs.length < PAGE_SIZE) break;
  }
  if (!dryRun) saveCursor(cursor);
  console.log(`pull-feedback ${dryRun ? "(dry-run) " : ""}scanned=${scanned} appended=${appended} last_ts=${cursor.last_ts}`);
  return 0;
}

function selfTest() {
  const cases = [];
  const check = (label, ok) => cases.push([label, !!ok]);

  const env = parseEnvText('FB_API_KEY="abc"\nWRITER_EMAIL=x@y.z\n# c\nbad line\n', { HOME: "/h" });
  check("env 解析：去引號", env.FB_API_KEY === "abc");
  check("env 解析：保留 base", env.HOME === "/h" && env.WRITER_EMAIL === "x@y.z");

  const decoded = decodeFields({
    s: { stringValue: "a" }, i: { integerValue: "3" }, d: { doubleValue: 1.5 }, b: { booleanValue: true },
    n: { nullValue: null }, m: { mapValue: { fields: { k: { stringValue: "v" } } } },
    arr: { arrayValue: { values: [{ integerValue: "1" }] } },
  });
  check("Firestore 值解碼", decoded.s === "a" && decoded.i === 3 && decoded.d === 1.5 && decoded.b === true && decoded.n === null && decoded.m.k === "v" && decoded.arr[0] === 1);

  check("hostOf 去 www", hostOf("https://www.example.com/a?b=1") === "example.com");
  check("hostOf 壞 URL 回空字串", hostOf("not a url") === "");
  check("uidHash 長度 8", uidHash("u1").length === 8 && uidHash("u1") !== uidHash("u2"));

  const d1 = { name: "feedback/u_a", ts: "2026-09-01T00:00:00.000Z", item_id: "a", rating: "good", uid: "u", url: "https://x.io/p" };
  const d2 = { name: "feedback/u_b", ts: "2026-09-01T00:00:00.000Z", item_id: "b", rating: "bad", uid: "u" };
  let cur = emptyCursor();
  let fresh = selectNew([d1, d2], cur);
  check("首次全部視為新", fresh.length === 2);
  cur = advanceCursor(cur, [d1, d2]);
  check("游標推進到最大 ts 且保留同 ts 邊界", cur.last_ts === d1.ts && Object.keys(cur.seen).length === 2);
  fresh = selectNew([d1, d2], cur);
  check("同批重讀不重複", fresh.length === 0);
  const d1r = { ...d1, ts: "2026-09-02T00:00:00.000Z", rating: "bad" };
  fresh = selectNew([d1r, d2], cur);
  check("重新評分（新 ts）再次擷取", fresh.length === 1 && fresh[0].rating === "bad");
  cur = advanceCursor(cur, [d1r, d2]);
  check("舊 ts 的 seen 被清掉", cur.last_ts === d1r.ts && Object.keys(cur.seen).length === 1);

  const ev = toEvent(d1);
  check("toEvent 產出 human_rating", ev && ev.event_type === "human_rating" && ev.subject_id === "a" && ev.payload.source === "x.io" && ev.payload.uid_hash.length === 8);
  check("toEvent 拒絕壞 rating", toEvent({ ...d1, rating: "meh" }) === null);
  check("toEvent 拒絕空 item_id", toEvent({ ...d1, item_id: "" }) === null);

  const failed = cases.filter(([, ok]) => !ok);
  for (const [label, ok] of cases) console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
  console.log(`pull-feedback self-test: ${cases.length - failed.length}/${cases.length}`);
  return failed.length ? 1 : 0;
}

main().then((code) => process.exit(code || 0)).catch((error) => {
  console.error(`pull-feedback failed: ${String(error && error.message || error).slice(0, 200)}`);
  process.exit(2);
});
