#!/usr/bin/env node
// learning-loop v1 L-4：RSS 探索管線（docs/specs/learning-loop-v1.md C4）。
//
// 讀 scripts/sources-registry.json 的 categories.*[].feed，併發 ≤ 5、單 feed 10 秒、
// 總 90 秒，自寫最小 RSS/Atom 解析（不裝套件），對近 90 天語料的標題算 token
// Jaccard 新穎度，輸出 data/agent/.preview/emerging-candidates.json。
//
// 語料來源：規範寫 data/history/，本 repo 實際的 90 天語料是 lib/corpus.mjs 的
// loadWindow()（data/*.json + ~/.ai-news-hub/corpus/），與 build-timeline.mjs 同一口徑；
// data/history/ 若存在也一併掃，不存在就略過。
//
// 用法：
//   node scripts/agent/discover-trends.mjs                # 實跑，寫 .preview
//   node scripts/agent/discover-trends.mjs --dry-run      # 不落地、不打網路
//   node scripts/agent/discover-trends.mjs --self-test    # 假 fetch，不打網路
//   選項：--registry PATH  --window N（預設 90） --threshold F（預設 0.6） --max N（預設 60）
//         --out PATH  --concurrency N（上限 5） --feed-timeout MS  --total-timeout MS
//
// 紅線：只寫 .preview（gitignore）；不引入套件；不動 memory/ 與 agents/_control/。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWindow, itemsOf, listDailyFiles, readDaily } from "./lib/corpus.mjs";

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const valueOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

export const SCHEMA = "emerging-candidates-v0.1";
export const DEFAULTS = Object.freeze({
  windowDays: 90,
  threshold: 0.6,
  maxCandidates: 60,
  concurrency: 5,
  feedTimeoutMs: 10_000,
  totalTimeoutMs: 90_000,
});

const nowIso = () => new Date().toISOString();

// ---------- 文字處理 ----------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeEntities(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function cleanText(s) {
  let t = String(s || "");
  t = t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  t = decodeEntities(t);
  t = t.replace(/<[^>]+>/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

// 英數詞 ≥ 3 字元 + CJK 二字組。CJK 用二字組是因為中文標題沒有空白可切，
// 單字太碎（「模型」「發布」到處都是）、整句又太專一，二字組是折衷。
const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "are", "you", "your", "how", "why", "what", "new", "into", "its", "has", "have", "not", "but", "can", "will", "about", "more", "than", "after", "over", "out"]);
export function tokenize(title) {
  const s = String(title || "").toLowerCase();
  const out = new Set();
  for (const m of s.matchAll(/[a-z0-9][a-z0-9.+\-]*[a-z0-9]|[a-z0-9]{3,}/g)) {
    const w = m[0];
    if (w.length >= 3 && !STOP.has(w)) out.add(w);
  }
  const cjk = s.replace(/[^㐀-鿿]/g, " ").split(/\s+/).filter(Boolean);
  for (const run of cjk) {
    if (run.length === 1) continue;
    for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2));
  }
  return out;
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// 語料索引：token → 語料標題 id，算新穎度時只跟至少共享一個 token 的標題比，
// 避免 2,000 筆 feed × 10,000 筆語料的全配對。
export function buildCorpusIndex(titles) {
  const docs = [];
  const inverted = new Map();
  const seen = new Set();
  for (const raw of titles) {
    const toks = tokenize(raw);
    if (!toks.size) continue;
    const key = [...toks].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const id = docs.length;
    docs.push(toks);
    for (const t of toks) {
      if (!inverted.has(t)) inverted.set(t, []);
      inverted.get(t).push(id);
    }
  }
  return { docs, inverted, size: docs.length };
}

// 新穎度 = 1 − 與語料最相似標題的 Jaccard。語料空 → 一律 1（沒東西可比就是全新）。
export function novelty(title, index) {
  const toks = tokenize(title);
  if (!toks.size) return 0;
  if (!index || !index.size) return 1;
  let best = 0;
  const cand = new Set();
  for (const t of toks) for (const id of index.inverted.get(t) || []) cand.add(id);
  for (const id of cand) {
    const j = jaccard(toks, index.docs[id]);
    if (j > best) best = j;
    if (best >= 1) break;
  }
  return Math.round((1 - best) * 10000) / 10000;
}

// ---------- 最小 RSS / Atom 解析 ----------

function tagText(block, names) {
  for (const n of names) {
    const re = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i");
    const m = block.match(re);
    if (m) return cleanText(m[1]);
  }
  return "";
}

function atomLink(block) {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)];
  let fallback = "";
  for (const [, attrs] of links) {
    const href = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!href) continue;
    const rel = attrs.match(/rel\s*=\s*["']([^"']+)["']/i);
    if (!rel || rel[1] === "alternate") return decodeEntities(href[1]).trim();
    if (!fallback) fallback = decodeEntities(href[1]).trim();
  }
  return fallback;
}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// 回傳 { format: "rss"|"atom"|null, items:[{title, link, published_at}] }。
// 不是 feed（沒有 rss/rdf/feed 根元素）→ format null、items 空，呼叫端視為失敗。
export function parseFeed(xml) {
  const src = String(xml || "");
  const head = src.slice(0, 4000);
  let format = null;
  if (/<feed[\s>]/i.test(head)) format = "atom";
  else if (/<(rss|rdf:RDF|channel)[\s>]/i.test(head)) format = "rss";
  if (!format) return { format: null, items: [] };

  const blockRe = format === "atom"
    ? /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi
    : /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  const items = [];
  for (const m of src.matchAll(blockRe)) {
    const block = m[1];
    const title = tagText(block, ["title"]);
    if (!title) continue;
    const link = format === "atom"
      ? atomLink(block)
      : tagText(block, ["link", "guid"]) || atomLink(block);
    const published_at = parseDate(
      format === "atom"
        ? tagText(block, ["published", "updated"])
        : tagText(block, ["pubDate", "dc:date", "published"]),
    );
    items.push({ title, link: link || "", published_at });
  }
  return { format, items };
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// ---------- registry / corpus ----------

export function loadRegistry(file) {
  if (!fs.existsSync(file)) return [];
  let reg;
  try {
    reg = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const cats = reg && typeof reg.categories === "object" && reg.categories ? reg.categories : {};
  const out = [];
  for (const [category, list] of Object.entries(cats)) {
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      if (!e || typeof e.feed !== "string" || !/^https?:\/\//.test(e.feed)) continue;
      out.push({ category, name: String(e.name || ""), tier: String(e.tier || ""), feed: e.feed, type: String(e.type || "") });
    }
  }
  return out;
}

export function loadCorpusTitles({ repoDir, windowDays }) {
  const titles = [];
  let days = 0;
  const pushDaily = (daily) => {
    days++;
    for (const it of itemsOf(daily)) {
      if (it.title) titles.push(it.title);
      if (it.title_zh) titles.push(it.title_zh);
    }
  };
  for (const d of loadWindow({ repoDir, windowDays })) pushDaily(d.daily);
  const hist = path.join(repoDir, "data", "history");
  if (fs.existsSync(hist)) {
    const files = listDailyFiles(hist);
    for (const entry of files.slice(-windowDays)) {
      const daily = readDaily(entry.file);
      if (daily) pushDaily(daily);
    }
  }
  return { titles, days };
}

// ---------- 抓取：併發池 + 單 feed 逾時 + 總期限 ----------

export async function fetchOne(entry, { fetchImpl, feedTimeoutMs }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("timeout")), feedTimeoutMs);
  const started = Date.now();
  try {
    const res = await fetchImpl(entry.feed, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": "ai-news-hub-discover/0.1 (+learning-loop L-4)", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" },
    });
    if (!res || !res.ok) return { status: "http_error", http: res ? res.status : 0, items: [], ms: Date.now() - started };
    const text = await res.text();
    const parsed = parseFeed(text);
    if (!parsed.format) return { status: "unparseable", items: [], ms: Date.now() - started };
    return { status: "ok", format: parsed.format, items: parsed.items, ms: Date.now() - started };
  } catch (err) {
    const aborted = ctrl.signal.aborted || (err && err.name === "AbortError");
    return { status: aborted ? "timeout" : "network_error", error: String(err && err.message || err).slice(0, 120), items: [], ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAll(entries, opts) {
  const concurrency = Math.max(1, Math.min(DEFAULTS.concurrency, Number(opts.concurrency) || DEFAULTS.concurrency));
  const deadline = Date.now() + (Number(opts.totalTimeoutMs) || DEFAULTS.totalTimeoutMs);
  const results = new Array(entries.length);
  let next = 0;
  let inFlight = 0;
  let peak = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= entries.length) return;
      if (Date.now() >= deadline) {
        results[i] = { status: "skipped_deadline", items: [], ms: 0 };
        continue;
      }
      inFlight++;
      peak = Math.max(peak, inFlight);
      const remain = deadline - Date.now();
      results[i] = await fetchOne(entries[i], {
        fetchImpl: opts.fetchImpl,
        feedTimeoutMs: Math.max(1, Math.min(Number(opts.feedTimeoutMs) || DEFAULTS.feedTimeoutMs, remain)),
      });
      inFlight--;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker));
  return { results, peakConcurrency: peak };
}

// ---------- 主流程 ----------

export function rankCandidates(entries, results, index, { threshold, maxCandidates, windowDays }) {
  const cutoff = Date.now() - windowDays * 86400_000;
  const seen = new Set();
  const rows = [];
  for (let i = 0; i < entries.length; i++) {
    const r = results[i];
    if (!r || r.status !== "ok") continue;
    for (const it of r.items) {
      if (it.published_at && new Date(it.published_at).getTime() < cutoff) continue;
      const toks = tokenize(it.title);
      if (toks.size < 2) continue;
      const key = [...toks].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const n = novelty(it.title, index);
      if (n < threshold) continue;
      rows.push({
        title: it.title,
        link: it.link,
        source_domain: domainOf(it.link) || domainOf(entries[i].feed),
        source_name: entries[i].name,
        category: entries[i].category,
        tier: entries[i].tier,
        published_at: it.published_at,
        novelty: n,
      });
    }
  }
  rows.sort((a, b) => b.novelty - a.novelty || String(b.published_at || "").localeCompare(String(a.published_at || "")));
  return rows.slice(0, maxCandidates);
}

export async function run(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const registryPath = o.registryPath || path.join(ROOT, "scripts/sources-registry.json");
  const outPath = o.outPath || path.join(ROOT, "data/agent/.preview/emerging-candidates.json");
  const entries = loadRegistry(registryPath);
  const corpus = o.corpus || loadCorpusTitles({ repoDir: o.repoDir || ROOT, windowDays: o.windowDays });
  const index = buildCorpusIndex(corpus.titles);

  if (o.dryRun) {
    return {
      dry_run: true,
      registry: registryPath,
      feeds_total: entries.length,
      corpus_days: corpus.days,
      corpus_titles: index.size,
      would_write: outPath,
      wrote: [],
    };
  }

  const fetchImpl = o.fetchImpl || globalThis.fetch;
  const { results, peakConcurrency } = await fetchAll(entries, { ...o, fetchImpl });
  const counts = { total: entries.length, ok: 0, failed: 0, timeout: 0, skipped_deadline: 0, items: 0 };
  const failures = [];
  results.forEach((r, i) => {
    if (r.status === "ok") { counts.ok++; counts.items += r.items.length; }
    else {
      counts.failed++;
      if (r.status === "timeout") counts.timeout++;
      if (r.status === "skipped_deadline") counts.skipped_deadline++;
      failures.push({ name: entries[i].name, category: entries[i].category, domain: domainOf(entries[i].feed), status: r.status, http: r.http, error: r.error });
    }
  });
  const candidates = rankCandidates(entries, results, index, o);
  const doc = {
    schema_version: SCHEMA,
    generated_at: nowIso(),
    advisory: true,
    window_days: o.windowDays,
    corpus_days: corpus.days,
    corpus_titles: index.size,
    novelty_threshold: o.threshold,
    feeds: counts,
    peak_concurrency: peakConcurrency,
    candidate_count: candidates.length,
    candidates,
    failures,
  };
  if (o.write !== false) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n");
  }
  return { doc, wrote: o.write !== false ? [outPath] : [] };
}

// ---------- self-test（假 fetch，不打網路） ----------

const RSS_SAMPLE = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
<item><title><![CDATA[Quantum Tokenizer &amp; Beyond]]></title><link>https://example.org/a</link><pubDate>Mon, 07 Sep 2026 10:00:00 GMT</pubDate></item>
<item><title>Second post</title><guid>https://example.org/b</guid></item>
</channel></rss>`;
const ATOM_SAMPLE = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>A</title>
<entry><title type="html">Atom &lt;b&gt;entry&lt;/b&gt; one</title><link rel="self" href="https://x.example/self"/><link rel="alternate" href="https://x.example/one"/><published>2026-09-08T01:02:03Z</published></entry>
<entry><title>Atom two</title><link href="https://x.example/two"/><updated>2026-09-09T00:00:00Z</updated></entry>
</feed>`;

function fakeFetch(map) {
  return async (url, { signal } = {}) => {
    const spec = map[url];
    if (spec === "hang") {
      await new Promise((_, rej) => signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    }
    if (spec === "http500") return { ok: false, status: 500, text: async () => "" };
    return { ok: true, status: 200, text: async () => String(spec) };
  };
}

async function selfTest() {
  let pass = 0, fail = 0;
  const check = (name, ok) => {
    ok ? pass++ : fail++;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`);
  };

  const rss = parseFeed(RSS_SAMPLE);
  check("T-1 RSS：2 item、CDATA/entity 解碼、link/pubDate 取得",
    rss.format === "rss" && rss.items.length === 2 && rss.items[0].title === "Quantum Tokenizer & Beyond"
    && rss.items[0].link === "https://example.org/a" && rss.items[0].published_at === "2026-09-07T10:00:00.000Z"
    && rss.items[1].link === "https://example.org/b");

  const atom = parseFeed(ATOM_SAMPLE);
  check("T-2 Atom：2 entry、取 rel=alternate 而非 self、published/updated 都吃",
    atom.format === "atom" && atom.items.length === 2 && atom.items[0].title === "Atom entry one"
    && atom.items[0].link === "https://x.example/one" && atom.items[1].link === "https://x.example/two"
    && atom.items[1].published_at === "2026-09-09T00:00:00.000Z");

  const bad = parseFeed("<<<html><body>not a feed</body></html>");
  check("T-3 壞 XML：format null、items 空", bad.format === null && bad.items.length === 0);

  const t0 = Date.now();
  const hung = await fetchOne({ feed: "https://hang.example/feed" }, { fetchImpl: fakeFetch({ "https://hang.example/feed": "hang" }), feedTimeoutMs: 50 });
  check("T-4 逾時：單 feed 50ms 內 abort → status=timeout", hung.status === "timeout" && Date.now() - t0 < 2000);

  const index = buildCorpusIndex(["OpenAI releases GPT-5 model", "台灣金管會發布 AI 指引"]);
  const same = novelty("OpenAI releases GPT-5 model", index);
  const far = novelty("Zebra migration patterns in Serengeti", index);
  const mid = novelty("OpenAI releases new model card", index);
  check("T-5 新穎度：相同標題 0、無交集 1、部分重疊介於中間",
    same === 0 && far === 1 && mid > 0 && mid < 1);
  check("T-5b 新穎度：中文二字組有效（金管會 AI 指引 ≠ 1）",
    novelty("金管會 AI 指引更新", index) < 1 && novelty("完全無關的標題", index) === 1);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
  const emptyReg = path.join(tmp, "empty.json");
  fs.writeFileSync(emptyReg, JSON.stringify({ schema: "x", categories: {} }));
  const empty = await run({ registryPath: emptyReg, corpus: { titles: [], days: 0 }, outPath: path.join(tmp, "out.json"), fetchImpl: fakeFetch({}) });
  check("T-6 空 registry：feeds.total 0、candidates 空、仍寫出合法檔",
    empty.doc.feeds.total === 0 && empty.doc.candidates.length === 0 && fs.existsSync(path.join(tmp, "out.json")));

  const reg = path.join(tmp, "reg.json");
  fs.writeFileSync(reg, JSON.stringify({ categories: {
    topnews: [{ name: "R", tier: "A", feed: "https://r.example/rss", type: "rss" }, { name: "H", tier: "B", feed: "https://hang.example/feed", type: "rss" }],
    papers: [{ name: "A", tier: "A", feed: "https://a.example/atom", type: "atom" }, { name: "Bad", tier: "C", feed: "https://bad.example/x", type: "rss" }, { name: "Err", tier: "C", feed: "https://err.example/x", type: "rss" }],
  } }));
  const fetchMap = { "https://r.example/rss": RSS_SAMPLE, "https://hang.example/feed": "hang", "https://a.example/atom": ATOM_SAMPLE, "https://bad.example/x": "<<<nope", "https://err.example/x": "http500" };
  const dry = await run({ registryPath: reg, corpus: { titles: ["Second post"], days: 1 }, outPath: path.join(tmp, "dry.json"), dryRun: true, fetchImpl: () => { throw new Error("network in dry-run"); } });
  check("T-7 dry-run：不 fetch、不落地、feeds_total=5", dry.dry_run === true && dry.feeds_total === 5 && dry.wrote.length === 0 && !fs.existsSync(path.join(tmp, "dry.json")));

  const real = await run({ registryPath: reg, corpus: { titles: ["Second post"], days: 1 }, outPath: path.join(tmp, "real.json"), fetchImpl: fakeFetch(fetchMap), feedTimeoutMs: 50, threshold: 0.5, windowDays: 3650 });
  const d = real.doc;
  check("T-8 混合 feeds：ok 2、failed 3（timeout 1、unparseable、http）、peak ≤ 5",
    d.feeds.ok === 2 && d.feeds.failed === 3 && d.feeds.timeout === 1 && d.peak_concurrency <= 5
    && d.failures.some((f) => f.status === "unparseable") && d.failures.some((f) => f.status === "http_error"));
  check("T-9 候選：語料已有的「Second post」被濾掉，其餘每筆有 source_domain 與 novelty",
    d.candidates.length === 3 && !d.candidates.some((c) => c.title === "Second post")
    && d.candidates.every((c) => c.source_domain && typeof c.novelty === "number" && c.novelty >= 0.5));
  check("T-10 輸出 schema 與欄位", d.schema_version === SCHEMA && d.advisory === true && Array.isArray(d.candidates) && typeof d.corpus_titles === "number");

  const dl = await fetchAll(Array.from({ length: 8 }, (_, i) => ({ feed: `https://hang.example/${i}` })),
    { fetchImpl: fakeFetch(Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`https://hang.example/${i}`, "hang"]))), feedTimeoutMs: 200, totalTimeoutMs: 120, concurrency: 5 });
  check("T-11 總期限：120ms 到期後剩餘 feed 標 skipped_deadline、併發峰值 ≤ 5",
    dl.results.some((r) => r.status === "skipped_deadline") && dl.peakConcurrency <= 5 && dl.peakConcurrency >= 1);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`self-test：${pass} 通過，${fail} 失敗`);
  process.exit(fail ? 1 : 0);
}

async function main() {
  if (flags.has("--self-test")) return selfTest();
  const opts = {
    registryPath: valueOf("--registry", undefined),
    outPath: valueOf("--out", undefined),
    windowDays: Number(valueOf("--window", DEFAULTS.windowDays)),
    threshold: Number(valueOf("--threshold", DEFAULTS.threshold)),
    maxCandidates: Number(valueOf("--max", DEFAULTS.maxCandidates)),
    concurrency: Number(valueOf("--concurrency", DEFAULTS.concurrency)),
    feedTimeoutMs: Number(valueOf("--feed-timeout", DEFAULTS.feedTimeoutMs)),
    totalTimeoutMs: Number(valueOf("--total-timeout", DEFAULTS.totalTimeoutMs)),
    dryRun: flags.has("--dry-run"),
  };
  const out = await run(opts);
  if (out.dry_run) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  const d = out.doc;
  console.log(JSON.stringify({
    generated_at: d.generated_at,
    feeds: d.feeds,
    corpus_titles: d.corpus_titles,
    candidate_count: d.candidate_count,
    top: d.candidates.slice(0, 5).map((c) => ({ novelty: c.novelty, domain: c.source_domain, title: c.title.slice(0, 80) })),
    wrote: out.wrote,
  }, null, 2));
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(`discover-trends 失敗：${err && err.stack || err}`);
    process.exit(1);
  });
}
