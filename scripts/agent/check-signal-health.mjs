#!/usr/bin/env node
// learning-loop v1 C2：訊號健康閘（step 00e，非阻塞）。
// 問題背景：icon 回饋管線程式正確但從未收到資料（帳本 0 筆 human_rating、metrics-history
// human_rating_count 全 0），而 system-status 照樣綠燈——這支就是把「沉默失敗」變成可見狀態。
//
// 做什麼：
//   1. 讀 data/agent/metrics-history.jsonl 近 silent_nights 個日曆日的每分類 human_rating_count
//   2. 讀 ~/.ai-news-hub/learning/feedback-cursor.json（last_ts 是否仍在 epoch）與帳本 human_rating 計數
//   3. 視窗內兩邊都是 0 → state "yellow"，reason 列舉固定代碼；否則 "green"
//   4. 寫 data/agent/signal-health.json（只有計數與日期）＋ 帳本 signal_health 事件
//
// 紅線：輸出進 git、repo 公開，所以只放計數／日期／分類 id；不放標題、URL、uid、評分原文。
// 門檻 silent_nights 只讀 agents/_control/canaries.json（缺則 7），本檔不寫任何數字設定。
// 本檔永不寫 memory/、agents/_control/；--dry-run 零寫入。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { EVENT_TYPES, LEARNING_DIR, LEDGER_FILE } from "./lib/ledger.mjs";

export const SCHEMA = "signal-health-v1";
export const EVENT_TYPE = "signal_health";
export const DEFAULT_SILENT_NIGHTS = 7;
export const OUTPUT_REL = "data/agent/signal-health.json";
// 輸出 JSON 唯一允許的 key（頂層與巢狀）。多一個就是洩漏風險，self-test 會擋。
export const ALLOWED_KEYS = new Set([
  "schema", "generated_at", "date", "state", "reason",
  "window", "silent_nights", "nights_observed", "dates", "since",
  "metrics_ratings", "total", "by_cat",
  "ledger_human_rating", "in_window",
  "cursor", "present", "last_ts", "seen_count", "advanced",
]);
export const REASONS = Object.freeze({
  METRICS_MISSING: "metrics_history_missing",
  METRICS_ZERO: "metrics_ratings_zero_in_window",
  LEDGER_ZERO: "ledger_human_rating_zero_in_window",
  CURSOR_MISSING: "cursor_missing",
  CURSOR_EPOCH: "cursor_never_advanced",
});

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const valueOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

export function taipeiToday(now = new Date()) {
  return now.toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
}

function shiftDate(yyyymmdd, days) {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function readSilentNights(canariesPath) {
  try {
    const c = JSON.parse(fs.readFileSync(canariesPath, "utf8"));
    const n = Number(c && c.signal_health && c.signal_health.silent_nights);
    return Number.isInteger(n) && n >= 1 ? n : DEFAULT_SILENT_NIGHTS;
  } catch {
    return DEFAULT_SILENT_NIGHTS;
  }
}

// 壞行跳過、缺檔回 null（呼叫端當成 reason，不 crash）。
export function readMetricsWindow(jsonlPath, since, until) {
  if (!fs.existsSync(jsonlPath)) return null;
  const byCat = {};
  const dates = new Set();
  let total = 0;
  for (const line of fs.readFileSync(jsonlPath, "utf8").split("\n")) {
    const text = line.trim();
    if (!text) continue;
    let row;
    try { row = JSON.parse(text); } catch { continue; }
    const date = typeof row.date === "string" ? row.date : "";
    if (!date || date < since || date > until) continue;
    const cat = typeof row.cat === "string" ? row.cat : "";
    if (!cat) continue;
    const n = Number(row.human_rating_count) || 0;
    dates.add(date);
    byCat[cat] = (byCat[cat] || 0) + n;
    total += n;
  }
  return { total, by_cat: byCat, dates: [...dates].sort() };
}

export function readCursor(cursorPath) {
  if (!fs.existsSync(cursorPath)) return { present: false, last_ts: null, seen_count: 0, advanced: false };
  try {
    const c = JSON.parse(fs.readFileSync(cursorPath, "utf8"));
    const lastTs = typeof c.last_ts === "string" ? c.last_ts : null;
    const seen = c.seen && typeof c.seen === "object" ? Object.keys(c.seen).length : 0;
    const advanced = Boolean(lastTs) && Date.parse(lastTs) > Date.parse("1971-01-01T00:00:00Z");
    return { present: true, last_ts: lastTs, seen_count: seen, advanced };
  } catch {
    return { present: true, last_ts: null, seen_count: 0, advanced: false };
  }
}

// 只數 human_rating；視窗以事件 ts 的日期（UTC 切）對 since 比。壞行略過。
export function countLedgerRatings(ledgerPath, since) {
  if (!fs.existsSync(ledgerPath)) return { total: 0, in_window: 0 };
  let total = 0;
  let inWindow = 0;
  for (const line of fs.readFileSync(ledgerPath, "utf8").split("\n")) {
    const text = line.trim();
    if (!text) continue;
    let ev;
    try { ev = JSON.parse(text); } catch { continue; }
    if (!ev || ev.event_type !== "human_rating") continue;
    total += 1;
    const day = typeof ev.ts === "string" ? ev.ts.slice(0, 10) : "";
    if (day && day >= since) inWindow += 1;
  }
  return { total, in_window: inWindow };
}

export function assess({ today, silentNights, metrics, cursor, ledger }) {
  const since = shiftDate(today, -(silentNights - 1));
  const reason = [];
  const metricsTotal = metrics ? metrics.total : 0;
  if (!metrics) reason.push(REASONS.METRICS_MISSING);
  else if (metricsTotal === 0) reason.push(REASONS.METRICS_ZERO);
  if (ledger.in_window === 0) reason.push(REASONS.LEDGER_ZERO);
  if (!cursor.present) reason.push(REASONS.CURSOR_MISSING);
  else if (!cursor.advanced) reason.push(REASONS.CURSOR_EPOCH);
  const state = metricsTotal === 0 && ledger.in_window === 0 ? "yellow" : "green";
  return {
    schema: SCHEMA,
    generated_at: new Date().toISOString(),
    date: today,
    state,
    reason,
    window: {
      silent_nights: silentNights,
      since,
      nights_observed: metrics ? metrics.dates.length : 0,
      dates: metrics ? metrics.dates : [],
    },
    metrics_ratings: { total: metricsTotal, by_cat: metrics ? metrics.by_cat : {} },
    ledger_human_rating: { total: ledger.total, in_window: ledger.in_window },
    cursor: { present: cursor.present, last_ts: cursor.last_ts, seen_count: cursor.seen_count, advanced: cursor.advanced },
  };
}

export function buildEvent(report) {
  return {
    ts: report.generated_at,
    event_type: EVENT_TYPE,
    actor: "system",
    subject_type: "signal",
    subject_id: "human_rating",
    payload: {
      date: report.date,
      state: report.state,
      reason: report.reason,
      silent_nights: report.window.silent_nights,
      nights_observed: report.window.nights_observed,
      metrics_rating_total: report.metrics_ratings.total,
      ledger_in_window: report.ledger_human_rating.in_window,
    },
  };
}

// 遞迴檢查 key 白名單；by_cat 底下的 key 是分類 id，另外只准 [a-z_]+。
export function collectDisallowedKeys(obj, keyPath = "") {
  const bad = [];
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return bad;
  for (const [k, v] of Object.entries(obj)) {
    const here = keyPath ? `${keyPath}.${k}` : k;
    if (keyPath.endsWith("by_cat")) {
      if (!/^[a-z_]+$/.test(k) || typeof v !== "number") bad.push(here);
      continue;
    }
    if (!ALLOWED_KEYS.has(k)) bad.push(here);
    if (v && typeof v === "object" && !Array.isArray(v)) bad.push(...collectDisallowedKeys(v, here));
  }
  return bad;
}

export function run(opts) {
  const root = opts.root;
  const learningDir = opts.learningDir;
  const today = opts.today || taipeiToday();
  const silentNights = readSilentNights(path.join(root, "agents/_control/canaries.json"));
  const since = shiftDate(today, -(silentNights - 1));
  const metrics = readMetricsWindow(path.join(root, "data/agent/metrics-history.jsonl"), since, today);
  const cursor = readCursor(path.join(learningDir, "feedback-cursor.json"));
  const ledgerPath = opts.ledgerFile || path.join(learningDir, "events.jsonl");
  const ledger = countLedgerRatings(ledgerPath, since);
  const report = assess({ today, silentNights, metrics, cursor, ledger });
  const event = buildEvent(report);
  if (!EVENT_TYPES.has(event.event_type)) throw new Error(`ledger.mjs EVENT_TYPES 缺 ${event.event_type}`);
  const bad = collectDisallowedKeys(report);
  if (bad.length) throw new Error(`輸出含非白名單 key：${bad.join(",")}`);
  if (!opts.dryRun) {
    const outPath = path.join(root, OUTPUT_REL);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const tmp = `${outPath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, outPath);
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.appendFileSync(ledgerPath, `${JSON.stringify(event)}\n`, "utf8");
  }
  return { report, event };
}

// ── self-test：全部在暫存目錄跑，不碰真正的 repo 與 ~/.ai-news-hub ──
function selfTest() {
  let pass = 0;
  let fail = 0;
  const check = (name, ok) => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${name}`); };
  const mk = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "signal-health-"));
    const learn = path.join(root, "learning");
    fs.mkdirSync(path.join(root, "data/agent"), { recursive: true });
    fs.mkdirSync(path.join(root, "agents/_control"), { recursive: true });
    fs.mkdirSync(learn, { recursive: true });
    return { root, learn };
  };
  const TODAY = "2026-09-10";
  const metricsRows = (counts) => counts.map(({ date, cat, n }) => JSON.stringify({
    schema: "category-metrics-v0.1", date, cat, items: 10, human_rating_count: n, human_rating_score: null,
  })).join("\n") + "\n";
  const writeMetrics = (root, rows) => fs.writeFileSync(path.join(root, "data/agent/metrics-history.jsonl"), rows);
  const writeCursor = (learn, obj) => fs.writeFileSync(path.join(learn, "feedback-cursor.json"), JSON.stringify(obj));
  const writeCanaries = (root, obj) => fs.writeFileSync(path.join(root, "agents/_control/canaries.json"), JSON.stringify(obj));
  const rating = (ts) => JSON.stringify({ ts, event_type: "human_rating", actor: "human", subject_type: "news_item", subject_id: "x", payload: { rating: "good", cat: "papers", title: "SECRET-TITLE", url: "https://example.com/SECRET" } });
  const base = (root, learn, extra = {}) => ({ root, learningDir: learn, today: TODAY, dryRun: false, ...extra });

  // T-1 全 0 → yellow，reason 三條齊
  {
    const { root, learn } = mk();
    writeMetrics(root, metricsRows([{ date: "2026-09-09", cat: "papers", n: 0 }, { date: "2026-09-10", cat: "topnews", n: 0 }]));
    writeCursor(learn, { last_ts: "1970-01-01T00:00:00.000Z", seen: {} });
    writeCanaries(root, { signal_health: { silent_nights: 7 } });
    const { report } = run(base(root, learn));
    check("T-1 全 0 → state yellow", report.state === "yellow");
    check("T-1b reason 含 metrics 零、帳本零、游標未前進",
      [REASONS.METRICS_ZERO, REASONS.LEDGER_ZERO, REASONS.CURSOR_EPOCH].every((r) => report.reason.includes(r)));
    check("T-1c nights_observed=2、dates 排序", report.window.nights_observed === 2 && report.window.dates[0] === "2026-09-09");
    check("T-1d 輸出檔存在且帳本多一筆 signal_health",
      fs.existsSync(path.join(root, OUTPUT_REL)) && fs.readFileSync(path.join(learn, "events.jsonl"), "utf8").includes(`"event_type":"${EVENT_TYPE}"`));
  }
  // T-2 metrics 有評分 → green
  {
    const { root, learn } = mk();
    writeMetrics(root, metricsRows([{ date: "2026-09-08", cat: "papers", n: 3 }, { date: "2026-09-10", cat: "papers", n: 0 }]));
    const { report } = run(base(root, learn));
    check("T-2 metrics 有評分 → green，by_cat 累加", report.state === "green" && report.metrics_ratings.by_cat.papers === 3);
  }
  // T-3 metrics 零但帳本視窗內有 human_rating → green
  {
    const { root, learn } = mk();
    writeMetrics(root, metricsRows([{ date: "2026-09-10", cat: "papers", n: 0 }]));
    fs.writeFileSync(path.join(learn, "events.jsonl"), rating("2026-09-09T10:00:00.000Z") + "\n");
    const { report } = run(base(root, learn));
    check("T-3 帳本視窗內有評分 → green", report.state === "green" && report.ledger_human_rating.in_window === 1);
  }
  // T-4 缺 metrics-history.jsonl 不 crash
  {
    const { root, learn } = mk();
    const { report } = run(base(root, learn));
    check("T-4 缺 metrics-history → yellow 且 reason metrics_history_missing",
      report.state === "yellow" && report.reason.includes(REASONS.METRICS_MISSING) && report.window.nights_observed === 0);
  }
  // T-5 缺游標不 crash
  {
    const { root, learn } = mk();
    writeMetrics(root, metricsRows([{ date: "2026-09-10", cat: "papers", n: 0 }]));
    const { report } = run(base(root, learn));
    check("T-5 缺游標 → cursor.present=false 且 reason cursor_missing",
      report.cursor.present === false && report.reason.includes(REASONS.CURSOR_MISSING));
  }
  // T-6 事件 schema
  {
    const { root, learn } = mk();
    writeMetrics(root, metricsRows([{ date: "2026-09-10", cat: "papers", n: 0 }]));
    const { event } = run(base(root, learn, { dryRun: true }));
    const payloadKeys = Object.keys(event.payload).sort().join(",");
    check("T-6 事件 type 在 EVENT_TYPES、actor system、subject signal/human_rating",
      EVENT_TYPES.has(event.event_type) && event.actor === "system" && event.subject_type === "signal" && event.subject_id === "human_rating");
    check("T-6b payload 只有固定七個 key",
      payloadKeys === "date,ledger_in_window,metrics_rating_total,nights_observed,reason,silent_nights,state");
  }
  // T-7 輸出 key 白名單、零標題／URL 外洩（帳本裡有 SECRET 字串也不能流進輸出）
  {
    const { root, learn } = mk();
    writeMetrics(root, metricsRows([{ date: "2026-09-10", cat: "papers", n: 1 }]));
    fs.writeFileSync(path.join(learn, "events.jsonl"), rating("2026-09-10T01:00:00.000Z") + "\n");
    const { report, event } = run(base(root, learn));
    const text = fs.readFileSync(path.join(root, OUTPUT_REL), "utf8") + JSON.stringify(event);
    check("T-7 輸出 key 全在白名單", collectDisallowedKeys(report).length === 0);
    check("T-7b 輸出與事件不含 SECRET／http", !/SECRET|http/.test(text));
    check("T-7c 白名單檢查會擋非法 key", collectDisallowedKeys({ schema: 1, title: "x", window: { url: "y" } }).length === 2);
  }
  // T-8 dry-run 零寫入
  {
    const { root, learn } = mk();
    writeMetrics(root, metricsRows([{ date: "2026-09-10", cat: "papers", n: 0 }]));
    fs.writeFileSync(path.join(learn, "events.jsonl"), "");
    run(base(root, learn, { dryRun: true }));
    check("T-8 dry-run 不寫輸出檔、不寫帳本",
      !fs.existsSync(path.join(root, OUTPUT_REL)) && fs.readFileSync(path.join(learn, "events.jsonl"), "utf8") === "");
  }
  // T-9 門檻讀 canaries.json；缺檔用預設 7
  {
    const { root, learn } = mk();
    writeCanaries(root, { signal_health: { silent_nights: 3 } });
    writeMetrics(root, metricsRows([{ date: "2026-09-06", cat: "papers", n: 5 }, { date: "2026-09-10", cat: "papers", n: 0 }]));
    const r3 = run(base(root, learn, { dryRun: true })).report;
    fs.unlinkSync(path.join(root, "agents/_control/canaries.json"));
    const r7 = run(base(root, learn, { dryRun: true })).report;
    check("T-9 silent_nights=3 時 09-06 落在視窗外 → yellow", r3.window.silent_nights === 3 && r3.state === "yellow" && r3.window.since === "2026-09-08");
    check("T-9b 缺 canaries → 預設 7，09-06 進視窗 → green", r7.window.silent_nights === 7 && r7.state === "green");
  }
  // T-10 帳本視窗外的評分只算 total 不算 in_window
  {
    const { root, learn } = mk();
    writeMetrics(root, metricsRows([{ date: "2026-09-10", cat: "papers", n: 0 }]));
    fs.writeFileSync(path.join(learn, "events.jsonl"), rating("2026-06-01T00:00:00.000Z") + "\n");
    const { report } = run(base(root, learn, { dryRun: true }));
    check("T-10 舊評分 total=1、in_window=0 → yellow", report.ledger_human_rating.total === 1 && report.ledger_human_rating.in_window === 0 && report.state === "yellow");
  }
  // T-11 壞行容忍
  {
    const { root, learn } = mk();
    writeMetrics(root, "{not json}\n" + metricsRows([{ date: "2026-09-10", cat: "papers", n: 2 }]) + "\n{\"date\":\"2026-09-10\"}\n");
    fs.writeFileSync(path.join(learn, "events.jsonl"), "garbage\n" + rating("2026-09-10T00:00:00.000Z") + "\n");
    fs.writeFileSync(path.join(learn, "feedback-cursor.json"), "{broken");
    const { report } = run(base(root, learn, { dryRun: true }));
    check("T-11 壞行／壞游標容忍，仍算出 green", report.state === "green" && report.metrics_ratings.total === 2 && report.ledger_human_rating.in_window === 1 && report.cursor.present === true);
  }
  console.log(`\nself-test：${pass} 通過，${fail} 失敗`);
  process.exit(fail ? 1 : 0);
}

function main() {
  if (flags.has("--self-test")) return selfTest();
  const dryRun = flags.has("--dry-run");
  const { report, event } = run({
    root: valueOf("--root", process.cwd()),
    learningDir: valueOf("--learning-dir", LEARNING_DIR),
    ledgerFile: valueOf("--learning-dir", null) ? null : LEDGER_FILE,
    today: valueOf("--today", null),
    dryRun,
  });
  const summary = { mode: dryRun ? "dry-run" : "write", state: report.state, reason: report.reason,
    nights_observed: report.window.nights_observed, metrics_rating_total: report.metrics_ratings.total,
    ledger_in_window: report.ledger_human_rating.in_window, wrote: dryRun ? [] : [OUTPUT_REL, "ledger:" + event.event_type] };
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
