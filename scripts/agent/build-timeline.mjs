#!/usr/bin/env node
// 時間軸資料的生產者。把 lib/trend-metrics.mjs 算出來的每日頻次，攤平成
// 前端圖表可以直接畫的等長陣列。
//
// 白話講這支在做什麼：trend-metrics 回傳的 daily 只列「那個叢集有觀測到的日子」，
// 六個叢集各自長短不一，畫圖時對不齊。這支把它們對到同一根 x 軸上——那根 x 軸是
// 完整的日曆日，不是「有資料的日子」。
//
// 為什麼要用完整日曆日：語料從 2026-04-04 到 2026-07-26 共 114 個日曆日，
// 但只有 68 個檔（管線 2026-07-09 中斷過，另有平日缺口）。如果 x 軸只放有資料的
// 68 天，圖上的 6/05 和 6/19 會變成相鄰的兩點，中間 14 天的空白被壓成一步——
// 看起來像「兩週內從 A 掉到 B」，實際上那是「這兩週沒有資料」。金融業看 K 線圖
// 不會把停牌的日子刪掉再把前後兩根黏起來，同樣的道理。
//
// 三種值在這支裡意義完全不同，不可互換：
//   數字 0  = 那天有抓到新聞，但這個叢集一則都沒命中（真的是零）
//   null    = 那天根本沒有語料檔（不知道，不是零）
//   缺欄位  = 這個叢集在整個視窗都沒出現過（不會發生，六個叢集恆存在）
// 前端畫線時遇到 null 必須斷線，不可內插——內插等於憑空生出沒發生過的觀測。
//
// 它是「程式」不是「agent」：同一批語料跑兩次必須得到位元一致的 series，
// 否則時間軸會出現不是來自新聞的波動。判斷（這波升溫是真的還是轉載洗版）
// 由 TrendAnalyst 做，這支只負責把證據排整齊。
//
// 發布安全：run-daily.sh 每天 18:00 會跑 `git add data/` 然後 push 到公開的
// GitHub Pages。所以預設輸出到 data/agent/.preview/（已在 .gitignore），
// 確認過內容再用 --promote 落到正式的 data/agent/。
//
// 用法：
//   node scripts/agent/build-timeline.mjs                 # 90 天視窗，產到 .preview
//   node scripts/agent/build-timeline.mjs --window 30     # 改變視窗
//   node scripts/agent/build-timeline.mjs --promote       # 落正式路徑（會被隔天推上線）
//   node scripts/agent/build-timeline.mjs --self-test     # 只跑內建不變式檢查

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { loadWindow, itemsOf } from "./lib/corpus.mjs";
import {
  computeTrendMetrics,
  dayNumber,
  dateFromDayNumber,
  TREND_METRICS_SCHEMA,
} from "./lib/trend-metrics.mjs";
import { TOPIC_LEXICONS } from "./lib/lexicons.mjs";
import { appendEvent, ledgerStats } from "./lib/ledger.mjs";

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const valueOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

// 預設 90 天。理由：trend-metrics 的最長移動平均窗就是 90 日，餵少於 90 天
// 進來，ma90 的 coverage 永遠不足、sufficient 永遠是 false，那個欄位就白給了。
const WINDOW_DAYS = Number(valueOf("--window", "90"));
const PROMOTE = flags.has("--promote");
const OUT_DIR = path.join(ROOT, valueOf("--out-dir", PROMOTE ? "data/agent" : "data/agent/.preview"));

export const TIMELINE_SCHEMA = "agent-timeline-v0.1";

// 近期／前期各取幾天來算變化。7 天對 7 天是刻意的：語料有平日缺口（週末常缺），
// 取 7 的倍數才會讓兩段各自涵蓋完整的週循環，否則「上升」可能只是這段比上段
// 多含一個工作日。
export const DELTA_WINDOW = 7;

const round4 = (n) => (Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null);
const nowIso = () => new Date().toISOString();

// 把 start~end 之間每一個日曆日都列出來（含頭含尾）。
// 這是 x 軸的定義：資料有沒有是另一回事，日子一定要在。
export function calendarAxis(startDate, endDate) {
  const a = dayNumber(startDate);
  const b = dayNumber(endDate);
  if (a === null || b === null || b < a) return [];
  const out = [];
  for (let n = a; n <= b; n += 1) out.push(dateFromDayNumber(n));
  return out;
}

// 近 N 個「有觀測」的日子對上再前 N 個，比總量。
// 只數有觀測的日子，缺日直接跳過不計——把缺日當 0 會讓分子分母都被灌水，
// 一段有缺口的期間會無條件顯示成「下降」。
export function windowDelta(values, windowSize = DELTA_WINDOW) {
  const observed = values.filter((v) => v !== null);
  if (observed.length < windowSize * 2) {
    return {
      window_days: windowSize,
      recent_sum: null,
      previous_sum: null,
      change: null,
      change_rate: null,
      sufficient: false,
      observed_days: observed.length,
      required_days: windowSize * 2,
    };
  }
  const recent = observed.slice(-windowSize);
  const previous = observed.slice(-windowSize * 2, -windowSize);
  const recentSum = recent.reduce((s, v) => s + v, 0);
  const previousSum = previous.reduce((s, v) => s + v, 0);
  return {
    window_days: windowSize,
    recent_sum: recentSum,
    previous_sum: previousSum,
    change: recentSum - previousSum,
    // 前期為 0 時不給比率。0 → 5 的「成長率無限大」不是資訊，
    // change 已經把「多了 5」講清楚了。
    change_rate: previousSum > 0 ? round4((recentSum - previousSum) / previousSum) : null,
    sufficient: true,
    observed_days: observed.length,
    required_days: windowSize * 2,
  };
}

// 主體。純函式：進去 days 陣列，出來一個可序列化物件，不碰檔案、不讀時鐘。
export function buildTimeline(days) {
  const metrics = computeTrendMetrics(days);
  const win = metrics.window;
  const axis = calendarAxis(win.start, win.end);
  const observedSet = new Set(days.map((d) => d.date));

  // 每天的總新聞量。這條線和叢集線的意義不同：叢集是非互斥的（一則新聞可以同時
  // 命中三個叢集），所以六條叢集線加起來會大於總量，兩者不能疊在同一個 y 軸上比。
  const itemsByDate = new Map();
  for (const day of days) itemsByDate.set(day.date, itemsOf(day.daily).length);

  const totals_series = axis.map((date) => (observedSet.has(date) ? (itemsByDate.get(date) || 0) : null));

  // 一律輸出六個叢集，順序固定照 TOPIC_LEXICONS。
  // 為什麼不直接用 metrics.clusters：computeTrendMetrics 對整個視窗零命中的叢集
  // 會直接 continue 掉（trend-metrics.mjs 的 `if (!bucket.occurrences) continue`）。
  // 90 天窗六個都在看不出問題，但短窗遇到冷門叢集就會少一條線——而且是無聲地少，
  // 前後兩天的 timeline.json 叢集集合不一樣，圖表的圖例會自己變動、色票會位移。
  // 時間軸的欄位集合必須跨日穩定，所以在這一層補回來。
  const byId = new Map(metrics.clusters.map((c) => [c.cluster_id, c]));
  const clusters = TOPIC_LEXICONS.map((topic) => {
    const c = byId.get(topic.cluster_id);
    const occByDate = new Map();
    const uniqByDate = new Map();
    for (const d of (c ? c.daily : [])) {
      occByDate.set(d.date, d.occurrences);
      uniqByDate.set(d.date, d.unique_items);
    }
    // 這裡就是 0 與 null 的分界線：日子在觀測集合裡就給 0（真的沒命中），
    // 不在就給 null（沒有語料，不知道）。
    const occurrences = axis.map((date) => (observedSet.has(date) ? (occByDate.get(date) || 0) : null));
    const unique_items = axis.map((date) => (observedSet.has(date) ? (uniqByDate.get(date) || 0) : null));

    return {
      cluster_id: topic.cluster_id,
      title: topic.title,
      // present_in_window=false 代表這個叢集在整個視窗一則都沒命中。
      // series 的 0 是真的 0（那些天有語料只是沒命中），可以照畫；但衍生指標
      // （移動平均、斜率、來源集中度、轉載證據）一律給 null 不給零值物件——
      // HHI 沒有樣本時不是 0 而是「未定義」，給 0 會讓前端畫出「來源極度分散」
      // 的假訊號。前端遇到 null 要顯示「無資料」而非數字。
      present_in_window: !!c,
      totals: c ? c.totals : {
        occurrences: 0, unique_items: 0, unique_titles: 0, active_days: 0, active_day_rate: 0,
      },
      series: { occurrences, unique_items },
      delta: windowDelta(occurrences),
      moving_average: c ? c.moving_average : null,
      slope: c ? c.slope : null,
      source_concentration: c ? c.source_concentration : null,
      syndication_evidence: c ? c.syndication_evidence : null,
    };
  });

  return {
    schema_version: TIMELINE_SCHEMA,
    metrics_schema: TREND_METRICS_SCHEMA,
    mode: "ranking-only",
    advisory: true,
    production_write: false,
    window: win,
    axis: {
      // 前端只要照 dates 的順序畫，observed 給它判斷哪裡要斷線。
      dates: axis,
      observed: axis.map((date) => observedSet.has(date)),
      observed_days: win.observed_days,
      calendar_days: axis.length,
      missing_dates: win.missing_dates,
      continuity: win.continuity,
      // 缺日不是資料瑕疵而已，是「這段時間的趨勢不可信」的警訊。
      // 前端要把這句話顯示出來，不要只畫一條漂亮的線。
      gap_warning:
        win.missing_dates.length > 0
          ? `此視窗有 ${win.missing_dates.length} 天無語料（連續性 ${win.continuity}）；缺口日的值為 null，折線須斷開不可內插。`
          : "",
    },
    totals: {
      // 注意：叢集歸屬非互斥，六條叢集線相加會大於這條總量線，不可當成堆疊圖。
      exclusive: false,
      note: "一則新聞可同時命中多個叢集，clusters 的 occurrences 總和大於 totals.series。",
      series: totals_series,
      observed_sum: totals_series.reduce((s, v) => s + (v === null ? 0 : v), 0),
      delta: windowDelta(totals_series),
    },
    clusters,
  };
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return fs.statSync(file).size;
}

// self-test 必須在沒有語料時也能跑完（CI、乾淨 checkout），讀不到就回 null
// 由呼叫端跳過，不讓整個檢查掛掉。沿用 build-insights.mjs 同名函式的作法。
function safeLoadWindow(windowDays = WINDOW_DAYS) {
  try {
    const days = loadWindow({ repoDir: ROOT, windowDays });
    return days.length ? days : null;
  } catch (error) {
    return null;
  }
}

// 造一段刻意有缺口的假語料：4/01、4/02 有，4/03、4/04 沒有，4/05 有。
// 用詞庫裡的真詞（agent / prompt injection），不要用會被 matchTerms 詞邊界
// 濾掉的變形（例如 released 匹配不到 release）。
function fixtureDays() {
  const mk = (date, items) => ({
    date,
    file: `fixture-${date}.json`,
    daily: { date, data: { ai: items } },
  });
  return [
    mk("2026-04-01", [
      { title: "agent orchestration lands", url: "u1", source: "Alpha", date: "2026-04-01" },
      { title: "prompt injection report", url: "u2", source: "Beta", date: "2026-04-01" },
    ]),
    mk("2026-04-02", [
      { title: "agent orchestration lands", url: "u3", source: "Gamma", date: "2026-04-02" },
    ]),
    // 4/03、4/04 刻意不給 → 這兩天必須是 null
    mk("2026-04-05", [
      { title: "agent tool use guide", url: "u4", source: "Alpha", date: "2026-04-05" },
    ]),
  ];
}

export function selfTestCases() {
  const cases = [];
  const check = (label, ok) => cases.push([label, !!ok]);

  // ── 1. 日曆軸
  const axis = calendarAxis("2026-04-01", "2026-04-05");
  check("日曆軸含頭含尾（5 天）", axis.length === 5 && axis[0] === "2026-04-01" && axis[4] === "2026-04-05");
  check("日曆軸嚴格遞增", axis.every((d, i) => i === 0 || d > axis[i - 1]));
  check("起訖顛倒回空陣列", calendarAxis("2026-04-05", "2026-04-01").length === 0);
  check("壞日期回空陣列", calendarAxis("not-a-date", "2026-04-05").length === 0);

  // ── 2. 缺日語意（本模組最重要的一條）
  const tl = buildTimeline(fixtureDays());
  check("軸長 = 日曆日數 5（不是有資料的 3）", tl.axis.dates.length === 5);
  check("observed 旗標對得上", JSON.stringify(tl.axis.observed) === JSON.stringify([true, true, false, false, true]));
  check("missing_dates 標出 4/03 與 4/04",
    JSON.stringify(tl.axis.missing_dates) === JSON.stringify(["2026-04-03", "2026-04-04"]));
  check("缺日有警語", tl.axis.gap_warning.includes("2 天無語料"));

  const agentCluster = tl.clusters.find((c) => c.cluster_id === "agent_engineering");
  const secCluster = tl.clusters.find((c) => c.cluster_id === "ai_security_and_privacy");
  check("agent_engineering 存在", !!agentCluster);
  check("ai_security_and_privacy 存在", !!secCluster);
  const occ = agentCluster ? agentCluster.series.occurrences : [];
  check("缺日是 null 不是 0", occ[2] === null && occ[3] === null);
  check("有觀測的日子是數字", typeof occ[0] === "number" && typeof occ[4] === "number");
  // 4/02 那天只有一則 agent 新聞、零則 security 新聞 → security 該天必須是 0 不是 null，
  // 因為那天確實有語料，只是這個叢集沒命中。這兩者混淆會讓「沒發生」被畫成「沒資料」。
  const secOcc = secCluster ? secCluster.series.occurrences : [];
  check("有語料但未命中該叢集 → 0 而非 null", secOcc[1] === 0);
  check("每個叢集的 series 都與軸等長",
    tl.clusters.every((c) => c.series.occurrences.length === 5 && c.series.unique_items.length === 5));

  // ── 2b. 叢集集合跨日穩定（本模組相對 trend-metrics 補的那一層）
  check("六個叢集全在（零命中的也要補回來）", tl.clusters.length === 6);
  check("叢集順序固定照 TOPIC_LEXICONS",
    JSON.stringify(tl.clusters.map((c) => c.cluster_id))
      === JSON.stringify(TOPIC_LEXICONS.map((t) => t.cluster_id)));
  const absent = tl.clusters.filter((c) => !c.present_in_window);
  check(`fixture 有零命中的叢集可測（實測 ${absent.length} 支）`, absent.length > 0);
  check("零命中叢集的 series 在有語料的日子是 0 不是 null",
    absent.every((c) => c.series.occurrences[0] === 0 && c.series.occurrences[2] === null));
  check("零命中叢集的衍生指標給 null 不給零值物件",
    absent.every((c) => c.moving_average === null && c.slope === null
      && c.source_concentration === null && c.syndication_evidence === null));
  check("零命中叢集的 totals 全 0", absent.every((c) => c.totals.occurrences === 0));
  check("有命中的叢集 present_in_window 為 true",
    tl.clusters.filter((c) => c.totals.occurrences > 0).every((c) => c.present_in_window === true));

  // ── 3. 總量線
  check("總量線與軸等長", tl.totals.series.length === 5);
  check("總量線缺日為 null", tl.totals.series[2] === null && tl.totals.series[3] === null);
  check("總量線 4/01 為 2 則", tl.totals.series[0] === 2);
  check("明示非互斥（不可畫堆疊圖）", tl.totals.exclusive === false);

  // ── 4. delta 的資料不足分支
  check("觀測日不足 14 天時 delta 標 insufficient",
    agentCluster && agentCluster.delta.sufficient === false && agentCluster.delta.change === null);
  const d1 = windowDelta([1, 2, 3, 4], 2);
  // (3+4)-(1+2)=4，比率是 4/3=1.3333（變化量除以前期），不是 7/3。
  check("delta 足量時算對（change 4、rate 1.3333）",
    d1.sufficient === true && d1.change === 4 && d1.change_rate === 1.3333);
  const d2 = windowDelta([0, 0, 3, 4], 2);
  check("前期為 0 時不給比率", d2.change === 7 && d2.change_rate === null);
  const d3 = windowDelta([1, 2, null, null, 3, 4], 2);
  check("delta 跳過缺日不當 0", d3.change === 4 && d3.observed_days === 4);

  // ── 5. 決定論
  const a = JSON.stringify(buildTimeline(fixtureDays()));
  const b = JSON.stringify(buildTimeline(fixtureDays()));
  check("同輸入兩次執行位元一致", a === b);
  const shuffled = [...fixtureDays()].reverse();
  check("輸入順序不影響輸出", JSON.stringify(buildTimeline(shuffled)) === a);

  // 掃 key 名而不是只比兩次結果——同一秒內跑兩次剛好相等，會讓時間戳矇混過關。
  const keys = new Set();
  (function walk(v) {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") {
      for (const k of Object.keys(v)) { keys.add(k); walk(v[k]); }
    }
  })(JSON.parse(a));
  const timeish = [...keys].filter((k) => /generated_at|_at$|timestamp|now/i.test(k));
  check(`buildTimeline 輸出無時間戳欄位（實測可疑鍵 ${timeish.length} 個）`, timeish.length === 0);

  // ── 6. schema
  check("schema_version 正確", tl.schema_version === "agent-timeline-v0.1");
  check("帶上 metrics schema 版本", tl.metrics_schema === TREND_METRICS_SCHEMA);
  check("標明唯讀不寫生產", tl.advisory === true && tl.production_write === false);

  // ── 7. 真實語料（沒有就跳過，不讓檢查掛掉）
  const real = safeLoadWindow();
  if (!real) {
    check("（跳過）找不到語料，略過真實語料檢查", true);
  } else {
    const rtl = buildTimeline(real);
    check(`真實語料軸長 ${rtl.axis.dates.length} = 日曆日數`, rtl.axis.dates.length === rtl.axis.calendar_days);
    check("真實語料 series 全部與軸等長",
      rtl.clusters.every((c) => c.series.occurrences.length === rtl.axis.dates.length));
    const nullCount = rtl.clusters[0].series.occurrences.filter((v) => v === null).length;
    check(`真實語料缺日數 ${nullCount} = missing_dates ${rtl.axis.missing_dates.length}`,
      nullCount === rtl.axis.missing_dates.length);
    // 每個有觀測的日子，六個叢集的 occurrences 總和必須 >= 該日總量（非互斥）。
    // 若小於，代表分派邏輯漏了新聞；若恆等於，代表變成互斥指派了——兩種都是回歸。
    let gteAll = true;
    let strictlyGreaterSomewhere = false;
    rtl.axis.dates.forEach((date, i) => {
      if (!rtl.axis.observed[i]) return;
      const sum = rtl.clusters.reduce((s, c) => s + c.series.occurrences[i], 0);
      const total = rtl.totals.series[i];
      if (sum < total) gteAll = false;
      if (sum > total) strictlyGreaterSomewhere = true;
    });
    check("叢集線總和 >= 總量線（非互斥性成立）", gteAll);
    check("至少一天嚴格大於（確認沒退化成互斥指派）", strictlyGreaterSomewhere);
    check("真實語料兩次執行位元一致",
      JSON.stringify(buildTimeline(real)) === JSON.stringify(rtl));
  }

  return cases;
}

function selfTest() {
  const cases = selfTestCases();
  const failed = cases.filter(([, ok]) => !ok);
  for (const [label, ok] of cases) console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
  console.log(`self-test: ${cases.length - failed.length}/${cases.length}`);
  if (failed.length) process.exit(1);
}

function main() {
  if (flags.has("--self-test")) return selfTest();

  const days = loadWindow({ repoDir: ROOT, windowDays: WINDOW_DAYS });
  if (!days.length) {
    console.error("找不到任何每日檔（data/ 與 ~/.ai-news-hub/corpus/ 都是空的）");
    process.exit(1);
  }

  const body = buildTimeline(days);
  const latest = days[days.length - 1];
  const timeline = {
    // meta 在前，方便 head 檔案就看得出這是什麼。generated_at 是 wall clock，
    // 刻意只放在 meta 層——self-test 檢查的是 buildTimeline() 的輸出，不含這幾行，
    // 所以決定論不會被它破壞。
    generated_at: nowIso(),
    source_latest_date: latest.date,
    source_latest_generated_at: String(latest.daily.generated_at || latest.daily.time || ""),
    window_days: days.length,
    ...body,
  };

  const size = writeJson(path.join(OUT_DIR, "timeline.json"), timeline);

  appendEvent({
    event_type: "outputs_generated",
    actor: "build-timeline.mjs",
    subject_type: "timeline",
    subject_id: latest.date,
    payload: {
      window_days: days.length,
      calendar_days: body.axis.calendar_days,
      observed_days: body.axis.observed_days,
      continuity: body.axis.continuity,
      clusters: body.clusters.map((c) => ({
        cluster_id: c.cluster_id,
        occurrences: c.totals.occurrences,
        slope: c.slope ? c.slope.value_per_day : null,
        present: c.present_in_window,
        delta: c.delta.change,
      })),
      promoted: PROMOTE,
    },
  });

  console.log(`輸出目錄：${path.relative(ROOT, OUT_DIR)}${PROMOTE ? "（正式路徑，隔天 18:00 會被推上線）" : "（預覽路徑，不會發布）"}`);
  console.log(`視窗：${body.window.start} ~ ${body.window.end}（日曆 ${body.axis.calendar_days} 天／有語料 ${body.axis.observed_days} 天／連續性 ${body.axis.continuity}）`);
  if (body.axis.missing_dates.length) console.log(`缺日 ${body.axis.missing_dates.length} 天：折線在這些點必須斷開`);
  for (const c of body.clusters) {
    const d = c.delta;
    const deltaText = d.sufficient
      ? `${d.change >= 0 ? "+" : ""}${d.change}${d.change_rate === null ? "" : `（${(d.change_rate * 100).toFixed(1)}%）`}`
      : "資料不足";
    const slopeText = c.present_in_window && c.slope ? String(c.slope.value_per_day) : "n/a（視窗內零命中）";
    console.log(`  ${c.cluster_id.padEnd(28)} 出現 ${String(c.totals.occurrences).padStart(5)} 次 / 近7日對比前7日 ${deltaText.padStart(18)} / 斜率 ${slopeText}`);
  }
  console.log(`檔案大小：timeline ${size}B`);
  const stats = ledgerStats();
  console.log(`共享帳本：${stats.events_count} 筆事件 ${JSON.stringify(stats.event_types)}`);
}

if (process.argv[1] && process.argv[1].endsWith("build-timeline.mjs")) main();
