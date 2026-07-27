#!/usr/bin/env node
// TechRoadmap 的輸入生產者：把三份既有產物併成一份 roadmap-input-v0.1。
//
// 三個來源各自只有一半的事實：
//   1. data/agent/.preview/timeline.json      量的部分（次數、ma7/30/90、斜率）
//   2. data/agent/.preview/trend-assessment.json  TrendAnalyst 的判讀（stage / 擴散 / 理由）
//   3. ~/.hermes/curator/curation-latest.json     NewsCurator 的 T 軸五軸（層／成熟度／證據）
//        搭配 ~/.hermes/curator/clusters-latest.json 取叢集規模、詞彙與成員標題
//
// 為什麼這支是「程式」不是「agent」：判準 §0——需要判斷的做成 agent，需要一致的做成程式。
// 併表本身沒有判斷空間，同一批輸入跑兩次必須得到逐位元相同的結果，否則 TechRoadmap
// 的 golden 期望就會隨併表漂移，紅燈分不清是模型退步還是 join 換了口味。
//
// 兩個 repo 的叢集粒度不同，這是本支存在的主因：
//   - hub 側是 6 個固定主題（TOPIC_LEXICONS），時間軸要能跨月比較，主題必須不變。
//   - curator 側是每晚重算的 35 個左右的動態叢集（c_xxxxxxxx），會生會滅。
// 所以 T 軸要往上聚合一層。聚合規則見下方 aggregateTech()，刻意照抄 TECH_RUBRIC §6.2
// 的累積支撐演算法，而不是自創一套——同一份判準在兩個層級用同一種算法，
// 讀輸出的人才不用記兩套規則。
//
// 用法：
//   node scripts/agent/build-roadmap-input.mjs                 # 產到 .preview
//   node scripts/agent/build-roadmap-input.mjs --self-test     # 只跑決定論不變式
//   node scripts/agent/build-roadmap-input.mjs --out <path>
//
// 發布安全：預設輸出到 data/agent/.preview/（已在 .gitignore）。這份輸入含 curator
// 的完整理由文字，不該隨 GitHub Pages 上線，因此本支**不提供** --promote。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { TOPIC_LEXICONS, matchTerms } from "./lib/lexicons.mjs";

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const valueOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

const SCHEMA = "roadmap-input-v0.1";
const CURATOR_DIR = path.join(os.homedir(), ".hermes", "curator");

const TIMELINE = valueOf("--timeline", path.join(ROOT, "data/agent/.preview/timeline.json"));
const TREND = valueOf("--trend", path.join(ROOT, "data/agent/.preview/trend-assessment.json"));
const CURATION = valueOf("--curation", path.join(CURATOR_DIR, "curation-latest.json"));
const CLUSTERS = valueOf("--clusters", path.join(CURATOR_DIR, "clusters-latest.json"));
const OUT = valueOf("--out", path.join(ROOT, "data/agent/.preview/roadmap-input.json"));

// 一個 curator 叢集要命中幾個主題詞才算屬於該主題。1 個太鬆——"安全" 這種詞
// 在幾乎所有中文報導裡都會出現一次，單一命中多半是順帶提到，不是主題。
const MIN_TERM_HITS = 2;

// 聚合時最多帶幾筆上游理由。newshub_roadmap.py 的投影只吃前 4 筆 × 300 字元，
// 這裡先對齊，避免產一堆之後必被截斷的文字。
const MAX_RATIONALE = 4;
const MAX_SECONDARY_LAYERS = 3;

// TECH_RUBRIC §6.2 的累積支撐門檻。原文用在「叢集 → 成員新聞」，這裡用在
// 「主題 → 成員叢集」，同一個常數。
const EVIDENCE_MIN_SUPPORT = 2;

const MATURITIES = ["M1", "M2", "M3", "M4", "M5"];
const DELTAS = ["D0", "D1", "D2", "D3"];
const GRADES = ["E1", "E2", "E3", "E4"];
const BLOCKERS = ["B1", "B2", "B3", "B4", "B5", "B6"];

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

// --------------------------------------------------------------------------
// 聚合規則
// --------------------------------------------------------------------------

// 證據等級：照 TECH_RUBRIC §6.2——E1 → E2 → E3 逐級累加成員數，回傳第一個
// 累計數 ≥ 門檻的等級；都不到則 E4。
//
// 門檻取 min(EVIDENCE_MIN_SUPPORT, 成員數)：一個主題底下只有一個 curator 叢集時，
// 支撐數不可能達到 2，硬套會讓它一律變成 E4（= T 軸整個消失）。支撐要求不能大於
// 母體本身。這是本支唯一對 §6.2 的調整，且只在成員數 < 2 時生效。
export function aggregateEvidenceGrade(memberGrades) {
  const need = Math.min(EVIDENCE_MIN_SUPPORT, memberGrades.length);
  if (!need) return "E4";
  let cum = 0;
  for (const g of ["E1", "E2", "E3"]) {
    cum += memberGrades.filter((x) => x === g).length;
    if (cum >= need) return g;
  }
  return "E4";
}

// 成熟度與增量取「觀察到的最高值」而不是平均或多數決：
// 主題層級問的是「這件事最遠走到哪裡」，只要有一個叢集已經進到監理要求（M5），
// 這個主題就是已經被制度化了，不會因為旁邊還有三個 preprint 就退回 M1。
// 保守性由後面的證據封頂負責，不由這裡的取值負責——兩件事分開，才查得出是哪一條在動。
const maxBy = (values, order) => {
  let best = null;
  for (const v of values) {
    if (order.indexOf(v) < 0) continue;
    if (best === null || order.indexOf(v) > order.indexOf(best)) best = v;
  }
  return best;
};

// TECH_RUBRIC §6.3 證據封頂，只降不升。在主題層級用主題層級的證據等級再套一次：
// 成員叢集各自封過頂，但聚合後的等級可能比任一成員更保守（累積支撐不足會退級），
// 那就必須用新的等級重新封一次，否則會出現「E3 主題掛著 M4」這種上游擋掉的組合。
export function applyEvidenceCap(grade, maturity, delta, memberGrades) {
  const notes = [];
  let m = maturity;
  let d = delta;
  if (grade === "E3") {
    if (MATURITIES.indexOf(m) > MATURITIES.indexOf("M2")) {
      notes.push(`E3 封頂：${m} → M2`);
      m = "M2";
    }
    if (DELTAS.indexOf(d) > DELTAS.indexOf("D1")) {
      notes.push(`E3 封頂：${d} → D1`);
      d = "D1";
    }
  }
  if (d === "D3" && !memberGrades.includes("E1")) {
    notes.push("D3 但無 E1 成員：D3 → D2");
    d = "D2";
  }
  return { maturity: m, delta: d, cap_notes: notes };
}

// 主層取「成員新聞則數最多」的那層，不是叢集數最多的那層：一個 20 則的叢集
// 比三個 3 則的叢集更能代表這個主題現在在哪一層。同分時取 S 編號小的，
// 純粹為了決定論（並非低層比較重要）。
export function aggregateTech(members) {
  const live = members.filter((m) => m.tech && typeof m.tech === "object");
  if (!live.length) return null;

  const bySize = new Map();
  const layerName = new Map();
  for (const m of live) {
    const layer = m.tech.tech_layer;
    if (!layer) continue;
    bySize.set(layer, (bySize.get(layer) || 0) + (m.size || 1));
    if (m.tech.tech_layer_name) layerName.set(layer, m.tech.tech_layer_name);
  }
  if (!bySize.size) return null;
  const primary = [...bySize.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];

  const secondary = new Set();
  for (const m of live) {
    if (m.tech.tech_layer && m.tech.tech_layer !== primary) secondary.add(m.tech.tech_layer);
    for (const s of m.tech.secondary_layers || []) if (s !== primary) secondary.add(s);
  }

  const grades = live.map((m) => m.tech.evidence_grade).filter((g) => GRADES.includes(g));
  const grade = aggregateEvidenceGrade(grades);
  const capped = applyEvidenceCap(
    grade,
    maxBy(live.map((m) => m.tech.maturity), MATURITIES) || "M1",
    maxBy(live.map((m) => m.tech.delta), DELTAS) || "D0",
    grades,
  );

  // 落地約束取聯集，依「幾個叢集提到」排序，同票取 B 編號小的。這裡刻意不裁剪成
  // 兩個——RM-6 要求 TechRoadmap 只能從候選裡挑最多兩個，候選先裁掉就等於替它挑了。
  const blockerCount = new Map();
  for (const m of live) {
    for (const b of m.tech.blockers || m.tech.blocker_candidates || []) {
      if (BLOCKERS.includes(b)) blockerCount.set(b, (blockerCount.get(b) || 0) + 1);
    }
  }
  const blockers = [...blockerCount.entries()]
    .sort((a, b) => b[1] - a[1] || BLOCKERS.indexOf(a[0]) - BLOCKERS.indexOf(b[0]))
    .map(([b]) => b);

  const rationale = live
    .slice()
    .sort((a, b) => (b.size || 0) - (a.size || 0) || a.cluster_id.localeCompare(b.cluster_id))
    .flatMap((m) => (m.tech.rationale_zh || []).slice(0, 1))
    .slice(0, MAX_RATIONALE);

  return {
    tech_layer: primary,
    tech_layer_name: layerName.get(primary) || "",
    secondary_layers: [...secondary].sort().slice(0, MAX_SECONDARY_LAYERS),
    maturity: capped.maturity,
    delta: capped.delta,
    evidence_grade: grade,
    blocker_candidates: blockers,
    rationale_zh: rationale,
    source_cluster_ids: live.map((m) => m.cluster_id).sort(),
    cap_notes: capped.cap_notes,
  };
}

// curator 叢集 → hub 主題。單一歸屬，不做多重歸屬：同一個叢集若同時算進兩個主題，
// 它的證據會被計兩次，累積支撐就被灌水，等級會比實際情況高。
export function assignTopic(haystack) {
  let best = null;
  for (const topic of TOPIC_LEXICONS) {
    const hits = matchTerms(haystack, topic.terms).length;
    if (hits < MIN_TERM_HITS) continue;
    if (!best || hits > best.hits) best = { cluster_id: topic.cluster_id, hits };
  }
  return best;
}

// --------------------------------------------------------------------------
function build() {
  for (const [label, p] of [["timeline", TIMELINE], ["trend", TREND],
                            ["curation", CURATION], ["clusters", CLUSTERS]]) {
    if (!fs.existsSync(p)) {
      console.error(`[roadmap-input] 找不到 ${label}：${p}`);
      process.exit(2);
    }
  }

  const timeline = readJson(TIMELINE);
  const trend = readJson(TREND);
  const curation = readJson(CURATION);
  const clusters = readJson(CLUSTERS);

  const trendById = new Map();
  for (const a of trend.assessments || []) trendById.set(a.cluster_id, a);

  const techById = new Map();
  for (const a of curation.assessments || []) {
    // decision=drop 的叢集也算：drop 說的是「不值得開新主題」，不是「這件事沒發生」。
    // 真正該排除的是 tech_assessment=null（E4，來源不可指認），那才是沒有技術事實可用。
    if (a.tech_assessment) techById.set(a.cluster_id, a.tech_assessment);
  }

  const members = new Map();      // hub cluster_id → 成員陣列
  let unmatchedCurator = 0;
  for (const c of clusters.clusters || []) {
    const hay = [
      c.label || "",
      (c.terms || []).join(" "),
      ...(c.members || []).flatMap((m) => [m.title || "", m.summary || ""]),
    ].join(" \n ");
    const hit = assignTopic(hay);
    if (!hit) { unmatchedCurator += 1; continue; }
    if (!members.has(hit.cluster_id)) members.set(hit.cluster_id, []);
    members.get(hit.cluster_id).push({
      cluster_id: c.cluster_id,
      size: c.size || (c.members || []).length,
      tech: techById.get(c.cluster_id) || null,
    });
  }

  const out = [];
  let techAbsent = 0;
  let unmatched = 0;
  for (const tc of timeline.clusters || []) {
    const t = trendById.get(tc.cluster_id);
    if (!t) { unmatched += 1; continue; }
    const tech = aggregateTech(members.get(tc.cluster_id) || []);
    if (!tech) techAbsent += 1;
    out.push({
      cluster_id: tc.cluster_id,
      title: tc.title,
      metrics: {
        present_in_window: tc.present_in_window,
        totals: tc.totals,
        delta: tc.delta,
        moving_average: tc.moving_average,
        slope: tc.slope,
      },
      trend: {
        stage: t.stage,
        confidence: t.confidence,
        syndication_call: t.syndication_call,
        headline_zh: t.headline_zh,
        rationale: t.rationale || [],
        security_flag: !!t.security_flag,
        source: t.source,
      },
      tech_assessment: tech,
    });
  }

  const w = timeline.window || {};
  const payload = {
    schema: SCHEMA,
    generated_at: new Date().toISOString(),
    window: {
      start: w.start,
      end: w.end,
      observed_days: w.observed_days,
      calendar_days: w.calendar_days,
      continuity: w.continuity,
      missing_dates_count: (w.missing_dates || []).length,
    },
    join: {
      method: "cluster_id + TOPIC_LEXICONS",
      matched: out.length,
      unmatched,
      tech_absent: techAbsent,
      curator_clusters_unmatched: unmatchedCurator,
      trend_source: trend.source,
      curation_source: curation.source,
    },
    clusters: out,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[roadmap-input] clusters=${out.length} tech_absent=${techAbsent} ` +
              `curator 未歸屬=${unmatchedCurator} → ${OUT}`);
  return payload;
}

// --------------------------------------------------------------------------
function selfTest() {
  let pass = 0;
  let fail = 0;
  const check = (name, cond) => {
    if (cond) { pass += 1; console.log(`  ok    ${name}`); }
    else { fail += 1; console.log(`  FAIL  ${name}`); }
  };

  console.log("=== build-roadmap-input 決定論不變式 ===\n");

  // 累積支撐：兩篇 E1 → E1；一篇 E1 兩篇 E3 → 累到 E3 才滿 2 → E3
  check("§6.2 兩個 E1 成員 → E1", aggregateEvidenceGrade(["E1", "E1", "E3"]) === "E1");
  check("§6.2 單一 E1 撐不起整體", aggregateEvidenceGrade(["E1", "E3", "E3"]) === "E3");
  check("§6.2 全是 E4 → E4", aggregateEvidenceGrade(["E4", "E4"]) === "E4");
  check("§6.2 成員只有一個時門檻降為 1", aggregateEvidenceGrade(["E2"]) === "E2");
  check("§6.2 零成員 → E4", aggregateEvidenceGrade([]) === "E4");

  // 封頂只降不升
  const cap1 = applyEvidenceCap("E3", "M5", "D3", ["E3", "E3"]);
  check("§6.3 E3 封頂 M5→M2", cap1.maturity === "M2");
  check("§6.3 E3 封頂 D3→D1", cap1.delta === "D1");
  const cap2 = applyEvidenceCap("E1", "M4", "D3", ["E1", "E1"]);
  check("§6.3 E1 不封頂", cap2.maturity === "M4" && cap2.delta === "D3");
  const cap3 = applyEvidenceCap("E2", "M3", "D3", ["E2", "E2"]);
  check("§6.3 D3 無 E1 成員 → D2", cap3.delta === "D2");
  check("§6.3 封頂會留痕跡", cap1.cap_notes.length === 2 && cap2.cap_notes.length === 0);

  // 聚合
  const agg = aggregateTech([
    { cluster_id: "c_b", size: 3, tech: { tech_layer: "S5", tech_layer_name: "評估與安全",
        secondary_layers: ["S6"], maturity: "M2", delta: "D0", evidence_grade: "E3",
        blockers: ["B5"], rationale_zh: ["政策宣示"] } },
    { cluster_id: "c_a", size: 12, tech: { tech_layer: "S4", tech_layer_name: "代理與工具鏈",
        secondary_layers: [], maturity: "M4", delta: "D2", evidence_grade: "E3",
        blockers: ["B5", "B4"], rationale_zh: ["具名客戶部署"] } },
  ]);
  check("主層取則數多的那層", agg.tech_layer === "S4");
  check("次層含被擠下來的主層", agg.secondary_layers.includes("S5"));
  check("成熟度取最高再封頂", agg.maturity === "M2");
  check("增量取最高再封頂", agg.delta === "D1");
  check("blocker 依提及次數排序", agg.blocker_candidates[0] === "B5");
  check("blocker 不預先裁成兩個", agg.blocker_candidates.length === 2);
  check("理由依叢集規模排序", agg.rationale_zh[0] === "具名客戶部署");
  check("source_cluster_ids 排序決定論", agg.source_cluster_ids.join() === "c_a,c_b");
  check("全無 T 軸 → null", aggregateTech([{ cluster_id: "c_x", size: 4, tech: null }]) === null);
  check("空成員 → null", aggregateTech([]) === null);

  // 歸屬
  check("單一命中不算歸屬",
        assignTopic("這篇提到監理一次") === null);
  const gov = assignTopic("金管會發布 AI 監理指引，強調治理與稽核");
  check("多詞命中才歸屬", gov && gov.cluster_id === "llm_evaluation_governance");
  check("完全不相關 → null", assignTopic("今日天氣晴") === null);
  const twice = [assignTopic("金管會發布 AI 監理指引，強調治理與稽核"),
                 assignTopic("金管會發布 AI 監理指引，強調治理與稽核")];
  check("同輸入兩次結果相同",
        JSON.stringify(twice[0]) === JSON.stringify(twice[1]));

  console.log(`\n${pass}/${pass + fail} 通過`);
  return fail === 0 ? 0 : 1;
}

// 只有被直接執行時才動檔案。純 import 不得有副作用——golden 閘門與其他工具要能
// 單獨載入 assignTopic()/aggregateTech() 驗聚合規則，不該因為缺一份輸入檔就整個退出。
const isMain = process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname);
if (isMain) {
  if (flags.has("--self-test")) process.exit(selfTest());
  build();
}
