// 趨勢的「證據」計算層——跨日縱深指標。
//
// 分工（承 lexicons.mjs 開頭那條原則：需要一致的做成程式，需要判斷的做成 agent）：
//   這支只負責算「數字」——某主題每天被提幾次、7/30/90 日移動平均是多少、
//   斜率是正是負、來源集不集中、同一則標題被幾家轉了。
//   它**不判斷**這些數字代表什麼。「這是真的升溫還是同一則新聞被 syndication
//   洗版」「這個趨勢走到哪個階段」是 TrendAnalyst(A1) 的工作。
//
// 為什麼要拆這麼開：洗版偵測如果交給模型從原文直接判，同一批新聞今天判「真升溫」、
// 明天判「洗版」，而那種不一致從圖上完全看不出來——時間軸只會顯示一條會呼吸的曲線。
// 所以證據要決定論、逐行可稽核，判斷才交給模型。
//
// 三條決定論鐵律（違反任何一條，同輸入兩次執行就不會位元一致）：
//   1. 不呼叫 Date.now()／不產生時間戳。所有時間都從輸入的 date 欄位來。
//   2. 所有集合輸出前都排序，且排序鍵不得有平手（平手時再用字串比一次）。
//   3. 浮點一律 round4 之後才進輸出。
//
// 一條資料誠實鐵律：
//   4. **缺的那天是「不知道」，不是「0」。** 語料目前是 2026-04-04 起、68 個檔，
//      而且中間有平日缺口（管線 2026-07-09 中斷過）。90 日移動平均在早期日期必然
//      不足窗。這時候補 0 會把分母灌大、把曲線壓下來，於是後面幾天看起來像在
//      「上升」——那是憑空長出來的趨勢訊號。所以本模組一律以**實際觀測到的天數**
//      為分母，並在輸出裡標明 coverage 與 sufficient，讓下游自己決定要不要採信。

import { itemsOf, haystackOf } from "./corpus.mjs";
import { TOPIC_LEXICONS, matchTerms } from "./lexicons.mjs";

export const TREND_METRICS_SCHEMA = "trend-metrics-v0.1";

// 移動平均的三個尺度。7=「這週」、30=「這個月」、90=「這一季」。
// 90 是刻意留的：它在目前語料上一定不足窗，而不足窗這件事必須看得見而不是被藏起來。
export const MA_WINDOWS = [7, 30, 90];

// 斜率用 30 天。7 天太短（一則大新聞就能把斜率翻正負），90 天太長（季度尺度的
// 斜率對「現在要不要追這題」沒有決策價值）。
export const SLOPE_WINDOW = 30;

// coverage 低於這個比例就標 sufficient:false。0.6 的意思是「這個窗有四成以上的
// 日子沒有資料」，此時平均值與斜率的信賴度已經低到不該拿來做判斷。
export const MIN_COVERAGE = 0.6;

const round4 = (n) => (Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null);

// ── 日期工具。全部走 UTC，不碰本機時區——同一份語料在不同機器上跑必須同結果。
const DAY_MS = 86400000;

export function dayNumber(dateStr) {
  const ms = Date.parse(`${dateStr}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.round(ms / DAY_MS);
}

export function dateFromDayNumber(n) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

// 標題正規化，只給「同一則新聞被幾家轉」用。
// 做法刻意保守：轉小寫、把所有非文數字（含全形標點）壓成單一空白、去頭尾。
// 不做同義詞、不做詞幹還原——那會開始把不同新聞併成同一則，而 syndication
// 判斷一旦誤併，A1 看到的證據就是錯的。寧可少抓也不要錯併。
export function normalizeTitle(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

// 同一則新聞的識別鍵，與 build-insights.mjs 第 147 行同規則。
// 兩邊必須一致，否則 trends.json 的 unique_item_count 跟時間軸的
// unique_items 會對不起來，而那種對不起來很難查。
function itemKey(item) {
  return item.url || `${item.title}@${item.date}`;
}

// ── 最小平方法。回傳每日增量與 r2。
// r2 存在的理由：斜率本身不會告訴你「這條線像不像一條線」。一個叢集可能因為
// 單日暴衝而得到很陡的正斜率，但 r2 只有 0.1——那不是趨勢，是一次事件。
// A1 要靠這兩個數字一起看才判得出「持續升溫」與「單日爆量」的差別。
function leastSquares(points) {
  const n = points.length;
  if (n < 3) return { slope: null, r2: null, points: n };

  let sx = 0;
  let sy = 0;
  for (const [x, y] of points) {
    sx += x;
    sy += y;
  }
  const mx = sx / n;
  const my = sy / n;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of points) {
    sxx += (x - mx) * (x - mx);
    sxy += (x - mx) * (y - my);
    syy += (y - my) * (y - my);
  }

  if (sxx === 0) return { slope: null, r2: null, points: n };
  const slope = sxy / sxx;
  // 全平（syy===0）時線是完美水平線，r2 定義為 1：模型完全解釋了「沒有變化」。
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope: round4(slope), r2: round4(r2), points: n };
}

// ── 來源集中度（HHI）。
// 借金融業的市佔集中度指標：把每個來源在這個叢集裡的佔比平方後加總。
// 1 = 全部來自同一家；0.25 = 四家均分；越低代表越多獨立來源在談。
// 為什麼用它而不是「來源家數」：十家裡有九成量來自同一家，家數看起來是 10，
// 但實際上這個主題只有一個聲音。HHI 抓得到這件事，家數抓不到。
// effective_sources = 1/HHI，翻譯成白話就是「相當於幾家等量的獨立來源」。
export function herfindahl(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return { hhi: null, effective_sources: null };
  let hhi = 0;
  for (const c of counts) hhi += (c / total) * (c / total);
  return { hhi: round4(hhi), effective_sources: round4(1 / hhi) };
}

// ── 逐日彙總。
// 叢集歸屬沿用 build-insights.mjs buildClusters() 的規則：**非互斥**，
// 一則新聞命中幾個主題詞庫就同時計入幾個叢集。不要改成互斥指派——
// 既有的 trends.json 是這樣算的，改了之後新舊分數不可比，時間軸會斷。
function collectDaily(days) {
  const byCluster = new Map();
  for (const topic of TOPIC_LEXICONS) {
    byCluster.set(topic.cluster_id, {
      cluster_id: topic.cluster_id,
      title: topic.title,
      perDate: new Map(),
      sourceCounts: new Map(),
      titleGroups: new Map(),
      allKeys: new Set(),
      occurrences: 0,
    });
  }

  for (const day of days) {
    for (const item of itemsOf(day.daily)) {
      const hay = haystackOf(item);
      for (const topic of TOPIC_LEXICONS) {
        if (!matchTerms(hay, topic.terms).length) continue;
        const bucket = byCluster.get(topic.cluster_id);

        bucket.occurrences += 1;
        bucket.allKeys.add(itemKey(item));

        if (!bucket.perDate.has(day.date)) {
          bucket.perDate.set(day.date, { occurrences: 0, keys: new Set() });
        }
        const cell = bucket.perDate.get(day.date);
        cell.occurrences += 1;
        cell.keys.add(itemKey(item));

        const source = item.source || "未標示來源";
        bucket.sourceCounts.set(source, (bucket.sourceCounts.get(source) || 0) + 1);

        const norm = normalizeTitle(item.title);
        if (norm) {
          if (!bucket.titleGroups.has(norm)) {
            bucket.titleGroups.set(norm, { title: item.title, sources: new Set(), count: 0, dates: new Set() });
          }
          const group = bucket.titleGroups.get(norm);
          group.count += 1;
          group.sources.add(source);
          group.dates.add(day.date);
          // 顯示用標題取字典序最小的那一個，否則同一組在不同輪次會挑到不同標題。
          if (String(item.title) < String(group.title)) group.title = String(item.title);
        }
      }
    }
  }

  return byCluster;
}

// 某個尺度的移動平均。分母是「窗內實際觀測到的天數」，不是窗長。
// 這是本模組最重要的一個決定，理由見檔頭鐵律 4。
function movingAverage(perDate, observedDayNumbers, endDay, windowDays, corpusStartDay) {
  const startDay = endDay - windowDays + 1;
  const observed = observedDayNumbers.filter((d) => d >= startDay && d <= endDay);
  const coverage = round4(observed.length / windowDays);

  let sum = 0;
  for (const d of observed) {
    const cell = perDate.get(dateFromDayNumber(d));
    sum += cell ? cell.occurrences : 0;
  }

  return {
    window_days: windowDays,
    value: observed.length ? round4(sum / observed.length) : null,
    observed_days: observed.length,
    coverage,
    // 窗頭比語料起點還早＝這個窗根本不可能填滿，不是資料掉了。
    // 兩者要分開，否則 A1 會把「語料還不夠久」誤讀成「這幾天沒新聞」。
    truncated_by_corpus_start: startDay < corpusStartDay,
    sufficient: observed.length > 0 && coverage >= MIN_COVERAGE,
  };
}

/**
 * 算出每個叢集的跨日指標。純函式：同樣的 days 進去，位元一致的物件出來。
 *
 * @param {Array<{date: string, daily: object}>} days  由 corpus.loadWindow() 載入、已按日期升冪
 * @param {{maWindows?: number[], slopeWindow?: number, topN?: number}} [options]
 */
export function computeTrendMetrics(days, options = {}) {
  const maWindows = options.maWindows || MA_WINDOWS;
  const slopeWindow = options.slopeWindow || SLOPE_WINDOW;
  const topN = options.topN || 5;

  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const dates = sorted.map((d) => d.date);

  if (!dates.length) {
    return {
      schema_version: TREND_METRICS_SCHEMA,
      window: {
        start: null, end: null, observed_days: 0, calendar_days: 0,
        missing_dates: [], continuity: null,
      },
      clusters: [],
    };
  }

  const startDay = dayNumber(dates[0]);
  const endDay = dayNumber(dates[dates.length - 1]);
  const calendarDays = endDay - startDay + 1;
  const observedSet = new Set(dates);
  const missing = [];
  for (let d = startDay; d <= endDay; d += 1) {
    const iso = dateFromDayNumber(d);
    if (!observedSet.has(iso)) missing.push(iso);
  }

  const byCluster = collectDaily(sorted);
  const clusters = [];

  for (const topic of TOPIC_LEXICONS) {
    const bucket = byCluster.get(topic.cluster_id);
    if (!bucket.occurrences) continue;

    const observedDayNumbers = [...bucket.perDate.keys()].map(dayNumber).sort((a, b) => a - b);

    const daily = [...bucket.perDate.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, cell]) => ({ date, occurrences: cell.occurrences, unique_items: cell.keys.size }));

    // 斜率只吃窗內「有觀測」的日子；缺的日子不補 0（補了會製造假的上升段）。
    // x 用日曆日偏移而非陣列索引——中間缺三天，那三天的距離必須真的存在，
    // 否則缺口會被壓縮成瞬間跳躍，斜率被高估。
    const slopeStartDay = endDay - slopeWindow + 1;
    const slopePoints = observedDayNumbers
      .filter((d) => d >= slopeStartDay)
      .map((d) => [d - slopeStartDay, bucket.perDate.get(dateFromDayNumber(d)).occurrences]);
    const fit = leastSquares(slopePoints);

    const sourceEntries = [...bucket.sourceCounts.entries()].sort(
      ([sa, ca], [sb, cb]) => cb - ca || (sa < sb ? -1 : 1),
    );
    const concentration = herfindahl(sourceEntries.map(([, c]) => c));

    // syndication 的「證據」：同一個正規化標題出現超過一次，而且跨了不只一個來源。
    // 只有 count>1 還不夠——同一家自己更新兩次不是洗版。跨來源才是。
    const repeatGroups = [...bucket.titleGroups.values()].filter((g) => g.count > 1);
    const crossSourceGroups = repeatGroups.filter((g) => g.sources.size > 1);
    const maxRepeat = repeatGroups.reduce((m, g) => Math.max(m, g.count), 0);
    const uniqueTitles = bucket.titleGroups.size;

    const moving = {};
    for (const w of maWindows) {
      moving[`ma${w}`] = movingAverage(bucket.perDate, observedDayNumbers, endDay, w, startDay);
    }

    clusters.push({
      cluster_id: bucket.cluster_id,
      title: bucket.title,
      totals: {
        occurrences: bucket.occurrences,
        unique_items: bucket.allKeys.size,
        unique_titles: uniqueTitles,
        active_days: bucket.perDate.size,
        // 有資料的日子裡有幾成提到這個主題。跟 recency 不同：recency 的分母是
        // 視窗長度，這裡的分母是實際有語料的天數，缺日不會把它稀釋掉。
        active_day_rate: round4(bucket.perDate.size / dates.length),
      },
      daily,
      moving_average: moving,
      slope: {
        window_days: slopeWindow,
        // 單位：件／日／日。正值＝每天被提到的次數還在往上加。
        value_per_day: fit.slope,
        r2: fit.r2,
        observed_points: fit.points,
        // 少於 3 個觀測點連一條線都畫不出來，直接標不足，不要硬給數字。
        sufficient: fit.slope !== null && fit.points >= 3,
      },
      source_concentration: {
        distinct_sources: sourceEntries.length,
        hhi: concentration.hhi,
        effective_sources: concentration.effective_sources,
        top_sources: sourceEntries.slice(0, topN).map(([source, count]) => ({
          source,
          count,
          share: round4(count / bucket.occurrences),
        })),
      },
      // 這一區是「證據」不是「判決」。duplicate_title_ratio 高不等於洗版
      // （同一個主題本來就會有很多相似標題），要不要判洗版是 A1 的事。
      syndication_evidence: {
        occurrences: bucket.occurrences,
        unique_titles: uniqueTitles,
        duplicate_title_ratio: round4(1 - uniqueTitles / bucket.occurrences),
        repeated_title_groups: repeatGroups.length,
        cross_source_repeat_groups: crossSourceGroups.length,
        max_title_repeat: maxRepeat,
        top_repeats: crossSourceGroups
          .sort((a, b) => b.count - a.count || b.sources.size - a.sources.size || (a.title < b.title ? -1 : 1))
          .slice(0, topN)
          .map((g) => ({
            // 注意：title 是外部網站原文，屬**不可信輸入**。下游把它放進 prompt 時
            // 要走 injection-detection；本模組不做消毒，因為消毒過的標題就不能拿來
            // 給人核對「這兩則是不是同一則」了。
            title: g.title,
            count: g.count,
            distinct_sources: g.sources.size,
            sources: [...g.sources].sort(),
            dates: [...g.dates].sort(),
          })),
      },
    });
  }

  return {
    schema_version: TREND_METRICS_SCHEMA,
    window: {
      start: dates[0],
      end: dates[dates.length - 1],
      observed_days: dates.length,
      calendar_days: calendarDays,
      missing_dates: missing,
      continuity: round4(dates.length / calendarDays),
    },
    clusters,
  };
}

// ── 內建不變式檢查。
// 跑得動不等於跑得對。下面每一條都是「一旦回歸，圖上會出現看不出來的假訊號」的性質。
// 用法：node scripts/agent/lib/trend-metrics.mjs --self-test

function fakeDay(date, items) {
  return { date, daily: { date, data: { topnews: items } } };
}

// 用真的主題詞造樣本，避免測試通過但實際詞庫對不上。
const GOV = "AI governance framework";       // 命中 llm_evaluation_governance
const AGT = "agent orchestration framework"; // 命中 agent_engineering

function collectKeys(node, out = []) {
  if (Array.isArray(node)) {
    for (const v of node) collectKeys(v, out);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      out.push(k);
      collectKeys(v, out);
    }
  }
  return out;
}

export function selfTestCases() {
  const cases = [];
  const check = (label, ok) => cases.push([label, !!ok]);
  const clusterOf = (result, id) => result.clusters.find((c) => c.cluster_id === id);

  // 日期工具：跨月、跨年不能出錯，否則缺日偵測整個歪掉。
  check("日期差跨月正確", dayNumber("2026-05-01") - dayNumber("2026-04-30") === 1);
  check("日期差跨年正確", dayNumber("2026-01-01") - dayNumber("2025-12-31") === 1);
  check("日期往返一致", dateFromDayNumber(dayNumber("2026-07-09")) === "2026-07-09");

  // 標題正規化：大小寫與標點不該讓同一則被算成兩則；中文不可被吃掉。
  check("標點大小寫正規化後同一則", normalizeTitle("OpenAI, GPT-5!") === normalizeTitle("openai gpt 5"));
  check("中文標題不被清空", normalizeTitle("金管會發布監理指引") === "金管會發布監理指引");
  check("空標題回空字串", normalizeTitle(null) === "");

  // HHI：金融業市佔集中度的定義要對，否則「只有一個聲音」這件事量不出來。
  check("單一來源 HHI=1", herfindahl([10]).hhi === 1);
  check("四家均分 HHI=0.25", herfindahl([5, 5, 5, 5]).hhi === 0.25);
  check("四家均分等效來源=4", herfindahl([5, 5, 5, 5]).effective_sources === 4);
  check("空輸入不炸", herfindahl([]).hhi === null);

  // 缺日不補零——本模組最重要的一條。
  // 兩天各 1 則、中間缺一天：ma3 必須是 1（兩天的平均），不是 0.67（補零後的平均）。
  const gap = computeTrendMetrics([
    fakeDay("2026-07-01", [{ title: GOV, url: "u1", source: "A" }]),
    fakeDay("2026-07-03", [{ title: `${GOV} update`, url: "u2", source: "B" }]),
  ], { maWindows: [3, 4], slopeWindow: 3 });
  const gapCluster = clusterOf(gap, "llm_evaluation_governance");
  check("缺日不補零：ma 分母只算觀測日", gapCluster.moving_average.ma3.value === 1);
  check("缺日被列進 missing_dates", gap.window.missing_dates.length === 1 && gap.window.missing_dates[0] === "2026-07-02");
  check("連續性算得出來", gap.window.continuity === round4(2 / 3));
  check("coverage 反映缺口", gapCluster.moving_average.ma3.coverage === round4(2 / 3));
  // 3 日窗涵蓋 2/3 = 0.667 仍過 MIN_COVERAGE，4 日窗只有 2/4 = 0.5 才落到門檻下。
  // 兩條都留著，確保門檻真的有在分辨，而不是永遠回同一個值。
  check("coverage 過門檻標充足", gapCluster.moving_average.ma3.sufficient === true);
  check("coverage 低於門檻標不足",
    gapCluster.moving_average.ma4.coverage === 0.5 && gapCluster.moving_average.ma4.sufficient === false);

  // 不足窗必須跟「資料掉了」分開標：3 日窗的窗頭正好等於語料起點（沒被截），
  // 4 日窗的窗頭早一天（被截）。兩者要給出不同答案，否則這個旗標等於沒作用。
  check("窗頭等於語料起點時不標 truncated", gapCluster.moving_average.ma3.truncated_by_corpus_start === false);
  check("窗頭早於語料起點時標 truncated", gapCluster.moving_average.ma4.truncated_by_corpus_start === true);

  // 斜率方向：三種形狀各驗一次。少於三點不給數字。
  const trendDays = (counts) =>
    counts.map((n, i) =>
      fakeDay(dateFromDayNumber(dayNumber("2026-07-01") + i),
        Array.from({ length: n }, (_, k) => ({ title: `${AGT} ${i}-${k}`, url: `u${i}-${k}`, source: "S" }))));
  const up = clusterOf(computeTrendMetrics(trendDays([1, 2, 3, 4]), { slopeWindow: 30 }), "agent_engineering").slope;
  const down = clusterOf(computeTrendMetrics(trendDays([4, 3, 2, 1]), { slopeWindow: 30 }), "agent_engineering").slope;
  const flat = clusterOf(computeTrendMetrics(trendDays([2, 2, 2, 2]), { slopeWindow: 30 }), "agent_engineering").slope;
  check("上升序列斜率為正", up.value_per_day === 1);
  check("下降序列斜率為負", down.value_per_day === -1);
  check("水平序列斜率為 0", flat.value_per_day === 0);
  check("完美直線 r2=1", up.r2 === 1);
  check("水平線 r2 定義為 1", flat.r2 === 1);
  const two = clusterOf(computeTrendMetrics(trendDays([1, 2]), { slopeWindow: 30 }), "agent_engineering").slope;
  check("少於三點不給斜率", two.value_per_day === null && two.sufficient === false);

  // 缺口不得被壓縮：同樣四個觀測點，中間隔越久斜率必須越平。
  // 若 x 用陣列索引而不是日曆日偏移，這兩個數會相等——那就是把三天的缺口
  // 當成不存在，斜率被高估三倍。
  const spread = [
    fakeDay("2026-07-01", [{ title: `${AGT} a`, url: "a", source: "S" }]),
    fakeDay("2026-07-02", [{ title: `${AGT} b`, url: "b", source: "S" }, { title: `${AGT} c`, url: "c", source: "S" }]),
    fakeDay("2026-07-10", [...Array(3)].map((_, k) => ({ title: `${AGT} d${k}`, url: `d${k}`, source: "S" })),
    ),
  ];
  const spreadSlope = clusterOf(computeTrendMetrics(spread, { slopeWindow: 30 }), "agent_engineering").slope.value_per_day;
  check(`日曆日缺口不被壓縮（斜率 ${spreadSlope} < 1）`, spreadSlope !== null && spreadSlope < 1);

  // syndication 證據：跨來源才算，同一家自己重覆不算。
  // fixture 用詞庫裡的真詞（release / gpt / claude / inference）。不要用 released——
  // matchTerms 對 ASCII 詞加詞邊界，字尾多一個 d 就匹配不到，測試會沉默地取不到叢集。
  const synd = computeTrendMetrics([
    fakeDay("2026-07-01", [
      { title: "GPT release lands today", url: "x1", source: "來源甲" },
      { title: "GPT release lands today", url: "x2", source: "來源乙" },
      { title: "GPT release lands today", url: "x3", source: "來源丙" },
      { title: "Claude inference update", url: "y1", source: "來源甲" },
      { title: "Claude inference update", url: "y2", source: "來源甲" },
    ]),
  ]);
  const release = clusterOf(synd, "model_release_and_inference");
  check("跨來源重覆被抓到", release.syndication_evidence.cross_source_repeat_groups === 1);
  check("同來源重覆不算跨來源", release.syndication_evidence.repeated_title_groups === 2);
  check("最大重覆次數正確", release.syndication_evidence.max_title_repeat === 3);
  check("重覆組列出全部來源", release.syndication_evidence.top_repeats[0].sources.length === 3);
  check("來源集中度算得出來", release.source_concentration.distinct_sources === 3);

  // 非互斥歸屬：一則同時命中兩個詞庫要同時進兩個叢集（與 build-insights 同規則）。
  const both = computeTrendMetrics([
    fakeDay("2026-07-01", [{ title: "AI governance framework for agent orchestration", url: "b1", source: "S" }]),
  ]);
  check("一則新聞可同時屬多個叢集",
    !!clusterOf(both, "llm_evaluation_governance") && !!clusterOf(both, "agent_engineering"));

  // 空輸入不炸，且結構仍完整（乾淨 checkout / CI 會走到這條）。
  const empty = computeTrendMetrics([]);
  check("空輸入不炸", empty.clusters.length === 0 && empty.window.observed_days === 0);

  // 輸出不得含任何時間戳欄位。這條是「同輸入兩次位元一致」的結構性保證——
  // 只比對兩次結果相等會被同一秒內執行兩次騙過去，掃 key 名不會。
  const keys = collectKeys(synd);
  const timeish = keys.filter((k) => /generated_at|_at$|timestamp|now/i.test(k));
  check(`輸出無時間戳欄位（實測可疑鍵 ${timeish.length} 個）`, timeish.length === 0);

  // 決定論：同一批輸入連跑兩次必須逐字元相同。
  const fixture = [
    fakeDay("2026-07-01", [
      { title: GOV, url: "d1", source: "來源乙" },
      { title: AGT, url: "d2", source: "來源甲" },
    ]),
    fakeDay("2026-07-04", [
      { title: `${GOV} 續報`, url: "d3", source: "來源丙" },
      { title: AGT, url: "d4", source: "來源甲" },
    ]),
  ];
  check("同輸入兩次執行逐字元相同",
    JSON.stringify(computeTrendMetrics(fixture)) === JSON.stringify(computeTrendMetrics(fixture)));
  // 輸入順序被打亂也必須同結果（loadWindow 已排序，但別讓正確性依賴呼叫端）。
  check("輸入順序不影響結果",
    JSON.stringify(computeTrendMetrics(fixture)) === JSON.stringify(computeTrendMetrics([...fixture].reverse())));

  return cases;
}

if (process.argv[1] && process.argv[1].endsWith("trend-metrics.mjs")) {
  if (process.argv.includes("--self-test")) {
    const cases = selfTestCases();
    const failed = cases.filter(([, ok]) => !ok);
    for (const [label, ok] of cases) console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
    console.log(`self-test: ${cases.length - failed.length}/${cases.length}`);
    if (failed.length) process.exit(1);
  } else {
    console.log("這是函式庫模組。用 --self-test 跑內建不變式檢查，或由 build-timeline.mjs 匯入。");
  }
}
