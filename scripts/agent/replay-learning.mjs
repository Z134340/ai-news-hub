#!/usr/bin/env node
// 把共享帳本重播成 repo 內的彙總檔 data/agent/learning-status.json。
//
// 白話講這支在幹嘛：build-insights.mjs 每跑一輪、人審每接受或退回一筆，都會在
// ~/.ai-news-hub/learning/events.jsonl 追加一行。這支把那個檔從頭讀一次，
// 算出「哪些主題被看過幾次、哪些被人改過、哪些被接受」，寫成一份彙總。
// Hermes 那邊的自主優化讀的是同一個帳本，這份彙總則是給 repo 內的驗證器與
// 之後的 dashboard 用的。
//
// 為什麼要重播而不是增量更新：帳本是 append-only，重播是冪等的——同一個帳本
// 重播幾次結果都一樣。增量更新一旦漏掉一次就永遠對不回來，而且沒人會發現。
//
// 兩條邊界要守住：
//   1. raw_feedback_off_repo —— repo 內只放彙總數字，原始事件（含標題、URL、
//      人審寫了什麼）一律留在 ~/.ai-news-hub/。這裡刻意只輸出 id 與計數。
//   2. agent_outputs_advisory_only —— 這支只寫彙總，不改任何 proposal 狀態、
//      不動 profile、不碰 data/latest.json。
//
// 用法：
//   node scripts/agent/replay-learning.mjs              # 產到 data/agent/.preview/
//   node scripts/agent/replay-learning.mjs --promote    # 寫進 data/agent/（會發布）
//   node scripts/agent/replay-learning.mjs --self-test  # 只跑內建不變式檢查

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { readEvents, LEDGER_FILE } from "./lib/ledger.mjs";

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const PROMOTE = flags.has("--promote");
const OUT_DIR = path.join(ROOT, PROMOTE ? "data/agent" : "data/agent/.preview");

// 既有那份 learning-status.json 用這四個 lens id，沿用不改名，
// 否則之後跟 2026-07-09 的歷史彙總對不起來。
// 六個叢集對應到四個 lens 是多對一：agent 工程與教育訓練都算在開發工具這條，
// 因為它們影響的是「內部怎麼做」而不是「外部怎麼監理」。
const CLUSTER_TO_LENS = {
  llm_evaluation_governance: "financial_governance",
  ai_security_and_privacy: "security",
  developer_tooling_rag: "developer_tooling",
  agent_engineering: "developer_tooling",
  model_release_and_inference: "novelty",
  ai_learning_and_enablement: "developer_tooling",
};
const LENS_IDS = ["developer_tooling", "financial_governance", "novelty", "security"];

// 一筆人審回饋能把權重推動多少。刻意設小：帳本目前只有個位數事件，
// 一筆就把權重拉走 50% 的話，那是雜訊不是學習。上下限也夾住，
// 避免長期單向累積把某個主題推到壓過其他所有訊號。
const FEEDBACK_STEP = 0.1;
const WEIGHT_MIN = 0.5;
const WEIGHT_MAX = 1.5;
const SUMMARY_LIMIT = 6;
const RATING_HALF_LIFE_DAYS = 30;   // 人類評分的時間衰減半衰期：30 天前的一票只算半票

const round3 = (n) => Math.round(n * 1000) / 1000;
const nowIso = () => new Date().toISOString();

function readJsonIfExists(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function clampWeight(weight) {
  return round3(Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, weight)));
}

function directionOf(accepted, corrected) {
  if (accepted > corrected) return "up";
  if (corrected > accepted) return "down";
  return "neutral";
}

// 把事件流摺成「每個主題被看過幾次 / 被接受幾次 / 被改過幾次」。
// 只認 subject_id 與 cluster_id 這種代號，不把任何標題或人審原文帶進來。
export function foldEvents(events) {
  const topics = new Map();
  const sources = new Map();
  const styles = new Map();
  const effects = {};
  let latestProfileVersion = "";
  let latestOutputsAt = "";

  const topicOf = (id) => {
    if (!topics.has(id)) topics.set(id, { id, observed: 0, accepted: 0, corrected: 0 });
    return topics.get(id);
  };

  for (const event of events) {
    effects[event.event_type] = (effects[event.event_type] || 0) + 1;
    const payload = event.payload || {};

    if (event.event_type === "outputs_generated") {
      latestOutputsAt = event.ts || latestOutputsAt;
      if (payload.profile_version) latestProfileVersion = String(payload.profile_version);
      for (const cluster of Array.isArray(payload.clusters) ? payload.clusters : []) {
        if (cluster && cluster.cluster_id) topicOf(String(cluster.cluster_id)).observed += 1;
      }
      continue;
    }

    // 人審類事件：subject_id 是叢集或提案代號，payload.cluster_id 是它影響到的主題。
    const clusterId = String(payload.cluster_id || (event.subject_type === "cluster" ? event.subject_id : "") || "");
    if (event.event_type === "output_accepted" && clusterId) topicOf(clusterId).accepted += 1;
    if (event.event_type === "user_correction" && clusterId) topicOf(clusterId).corrected += 1;
    if (event.event_type === "proposal_reviewed" && clusterId) {
      if (payload.decision === "approved") topicOf(clusterId).accepted += 1;
      if (payload.decision === "rejected") topicOf(clusterId).corrected += 1;
    }

    // 來源訊號只收來源代號（網域或機構名），不收單篇文章。
    const sourceId = String(payload.source || "");
    if (sourceId && (event.event_type === "output_accepted" || event.event_type === "user_correction")) {
      const entry = sources.get(sourceId) || { id: sourceId, accepted: 0, corrected: 0 };
      if (event.event_type === "output_accepted") entry.accepted += 1;
      else entry.corrected += 1;
      sources.set(sourceId, entry);
    }

    // 風格訊號來自人審明講的偏好標籤（例如 "shorter_summary"），不是自動推斷的。
    for (const tag of Array.isArray(payload.style_tags) ? payload.style_tags : []) {
      const id = String(tag || "");
      if (id) styles.set(id, (styles.get(id) || 0) + 1);
    }
  }

  // 人類評分：每個 subject 只留最新一筆（重新評分覆蓋舊評分）。
  const ratings = new Map();
  for (const event of events) {
    if (event.event_type !== "human_rating") continue;
    const id = String(event.subject_id || "");
    if (!id) continue;
    const prev = ratings.get(id);
    if (!prev || String(event.ts || "") > String(prev.ts || "")) ratings.set(id, event);
  }

  return { topics, sources, styles, effects, latestProfileVersion, latestOutputsAt, human_ratings: ratings };
}


// 彙總人類評分：只輸出計數、分類、來源網域與衰減後分數；標題與 URL 絕不離開帳本。
export function summarizeHumanRatings(ratings, now = Date.now()) {
  const byCategory = {};
  const bySource = {};
  const bump = (bucket, key, rating, weight) => {
    if (!key) return;
    const b = bucket[key] || (bucket[key] = { good: 0, mid: 0, bad: 0, wsum: 0, wscore: 0 });
    if (rating in b) b[rating] += 1;
    b.wsum += weight;
    b.wscore += weight * (rating === "good" ? 1 : rating === "bad" ? -1 : 0);
  };
  for (const event of ratings.values()) {
    const payload = event.payload || {};
    const rating = String(payload.rating || "");
    if (!["good", "mid", "bad"].includes(rating)) continue;
    const ageDays = Math.max(0, (now - Date.parse(event.ts || "")) / 86400000) || 0;
    const weight = Math.pow(0.5, ageDays / RATING_HALF_LIFE_DAYS);
    bump(byCategory, String(payload.cat || ""), rating, weight);
    bump(bySource, String(payload.source || ""), rating, weight);
  }
  const finish = (b) => ({ good: b.good, mid: b.mid, bad: b.bad, score: b.wsum ? round3(b.wscore / b.wsum) : 0 });
  const by_category = {};
  for (const [cat, b] of Object.entries(byCategory).sort()) by_category[cat] = finish(b);
  const by_source_domain = Object.entries(bySource)
    .map(([id, b]) => ({ id, ...finish(b), feedback_count: b.good + b.mid + b.bad }))
    .sort((a, b) => b.feedback_count - a.feedback_count || a.id.localeCompare(b.id))
    .slice(0, SUMMARY_LIMIT);
  return { half_life_days: RATING_HALF_LIFE_DAYS, items_rated: ratings.size, by_category, by_source_domain };
}

export function buildSummary(events, now = Date.now()) {
  const folded = foldEvents(events);
  const humanRatings = summarizeHumanRatings(folded.human_ratings, now);

  const topicSignals = [...folded.topics.values()]
    .map((t) => ({
      id: t.id,
      weight: clampWeight(1 + FEEDBACK_STEP * (t.accepted - t.corrected)),
      direction: directionOf(t.accepted, t.corrected),
      observed: t.observed,
      feedback_count: t.accepted + t.corrected,
    }))
    // 先照回饋量排（有人講過話的優先），同量再照被看過的次數，最後照 id 讓結果決定論。
    .sort((a, b) => b.feedback_count - a.feedback_count || b.observed - a.observed || a.id.localeCompare(b.id))
    .slice(0, SUMMARY_LIMIT);

  const sourceSignals = [...folded.sources.values()]
    .map((s) => ({
      id: s.id,
      weight: clampWeight(1 + FEEDBACK_STEP * (s.accepted - s.corrected)),
      direction: directionOf(s.accepted, s.corrected),
      feedback_count: s.accepted + s.corrected,
    }))
    .sort((a, b) => b.feedback_count - a.feedback_count || a.id.localeCompare(b.id))
    .slice(0, SUMMARY_LIMIT);

  // lens 是固定四條，永遠都列出來——缺項會讓下游以為那個面向沒被看過，
  // 但實際上是「看過但沒有人給過回饋」，兩者意義不同。
  const lensAgg = new Map(LENS_IDS.map((id) => [id, { accepted: 0, corrected: 0 }]));
  for (const t of folded.topics.values()) {
    const lens = CLUSTER_TO_LENS[t.id];
    if (!lens || !lensAgg.has(lens)) continue;
    const entry = lensAgg.get(lens);
    entry.accepted += t.accepted;
    entry.corrected += t.corrected;
  }
  const lensSignals = LENS_IDS.map((id) => {
    const { accepted, corrected } = lensAgg.get(id);
    return {
      id,
      weight: clampWeight(1 + FEEDBACK_STEP * (accepted - corrected)),
      direction: directionOf(accepted, corrected),
    };
  });

  const styleSignals = [...folded.styles.entries()]
    .map(([id, count]) => ({ id, weight: clampWeight(1 + FEEDBACK_STEP * count), direction: "up", feedback_count: count }))
    .sort((a, b) => b.feedback_count - a.feedback_count || a.id.localeCompare(b.id))
    .slice(0, SUMMARY_LIMIT);

  return {
    generated_from_events: events.length,
    summary_limit: SUMMARY_LIMIT,
    topic_signals: topicSignals,
    source_signals: sourceSignals,
    lens_signals: lensSignals,
    human_ratings: humanRatings,
    style_signals: styleSignals,
    applied_effect_counts: folded.effects,
    latest_profile_version: folded.latestProfileVersion,
    latest_outputs_at: folded.latestOutputsAt,
  };
}

function selfTest() {
  const cases = [];
  const check = (label, ok) => cases.push([label, !!ok]);

  // 空帳本：四條 lens 仍要齊全且中性，不能因為沒事件就消失。
  const empty = buildSummary([]);
  check("空帳本 lens 仍為四條", empty.lens_signals.length === 4);
  check("空帳本 lens 全中性", empty.lens_signals.every((l) => l.direction === "neutral" && l.weight === 1));
  check("空帳本無主題訊號", empty.topic_signals.length === 0);

  const gen = (clusters) => ({
    ts: "2026-07-26T00:00:00.000Z", event_type: "outputs_generated", actor: "t",
    subject_type: "trends", subject_id: "d", payload: { clusters, profile_version: "p1" },
  });
  const fb = (type, cluster, extra = {}) => ({
    ts: "2026-07-26T01:00:00.000Z", event_type: type, actor: "human",
    subject_type: "cluster", subject_id: cluster, payload: { cluster_id: cluster, ...extra },
  });

  // 只有生產事件、沒有人審回饋時，方向必須是 neutral——
  // 「看過很多次」不等於「被認可」，把它算成 up 就是無中生有的學習。
  const observedOnly = buildSummary([gen([{ cluster_id: "security_x" }]), gen([{ cluster_id: "security_x" }])]);
  check("只有生產事件時方向為中性", observedOnly.topic_signals[0].direction === "neutral");
  check("只有生產事件時權重不動", observedOnly.topic_signals[0].weight === 1);
  check("被看過的次數有記錄", observedOnly.topic_signals[0].observed === 2);

  const accepted = buildSummary([gen([{ cluster_id: "ai_security_and_privacy" }]), fb("output_accepted", "ai_security_and_privacy")]);
  check("接受一次 → 權重 1.1、方向 up", accepted.topic_signals[0].weight === 1.1 && accepted.topic_signals[0].direction === "up");
  check("接受會傳導到對應 lens", accepted.lens_signals.find((l) => l.id === "security").weight === 1.1);

  const corrected = buildSummary([fb("user_correction", "ai_security_and_privacy")]);
  check("修正一次 → 權重 0.9、方向 down", corrected.topic_signals[0].weight === 0.9 && corrected.topic_signals[0].direction === "down");

  // 上下限：連續 20 次同向回饋不能把權重推到失控。
  const flood = buildSummary(Array.from({ length: 20 }, () => fb("output_accepted", "agent_engineering")));
  check("權重被上限夾住（≤1.5）", flood.topic_signals[0].weight === WEIGHT_MAX);

  // 冪等：同一批事件重播兩次結果要逐字元相同。
  const batch = [gen([{ cluster_id: "agent_engineering" }]), fb("output_accepted", "agent_engineering"), fb("user_correction", "developer_tooling_rag")];
  check("重播兩次結果相同", JSON.stringify(buildSummary(batch)) === JSON.stringify(buildSummary(batch)));

  // 邊界：彙總裡不得出現標題或 URL 這類原始內容。
  const leaky = buildSummary([fb("user_correction", "agent_engineering", { title: "某則新聞標題", url: "https://example.com/x", source: "example.com" })]);
  const serialized = JSON.stringify(leaky);
  check("彙總不外洩標題", !serialized.includes("某則新聞標題"));
  check("彙總不外洩 URL", !serialized.includes("https://example.com/x"));
  check("來源代號可保留", serialized.includes("example.com"));

  // 六個叢集都要有 lens 對應，否則回饋會靜靜消失在對照表裡。
  const mapped = Object.values(CLUSTER_TO_LENS).every((lens) => LENS_IDS.includes(lens));
  check("叢集對 lens 的對照全部落在既有四條", mapped);

  // 人類評分：計數、latest-wins、去敏（標題／URL 不得出現在彙總）。
  const hr = (id, rating, ts, extra = {}) => ({
    ts, event_type: "human_rating", actor: "human", subject_type: "news_item", subject_id: id,
    payload: { rating, cat: "topnews", title: "SECRET TITLE", url: "https://news.example.com/x", source: "news.example.com", ...extra },
  });
  const nowTs = Date.parse("2026-09-03T00:00:00.000Z");
  const rated = buildSummary([
    hr("a", "good", "2026-09-02T00:00:00.000Z"),
    hr("b", "good", "2026-09-02T00:00:00.000Z"),
    hr("c", "bad", "2026-09-01T00:00:00.000Z"),
    hr("c", "mid", "2026-09-02T12:00:00.000Z"),
  ], nowTs).human_ratings;
  check("人類評分：items_rated 去重", rated.items_rated === 3);
  check("人類評分：分類計數（latest-wins，c 由 bad 變 mid）", rated.by_category.topnews.good === 2 && rated.by_category.topnews.mid === 1 && rated.by_category.topnews.bad === 0);
  check("人類評分：分數落在 (0,1]", rated.by_category.topnews.score > 0 && rated.by_category.topnews.score <= 1);
  check("人類評分：來源網域保留", rated.by_source_domain[0].id === "news.example.com" && rated.by_source_domain[0].feedback_count === 3);
  const leak = JSON.stringify(rated);
  check("人類評分：彙總不含標題／URL", !leak.includes("SECRET TITLE") && !leak.includes("https://"));
  check("人類評分：空帳本結構完整", empty.human_ratings.items_rated === 0 && Object.keys(empty.human_ratings.by_category).length === 0);

  const failed = cases.filter(([, ok]) => !ok);
  for (const [label, ok] of cases) console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
  console.log(`self-test: ${cases.length - failed.length}/${cases.length}`);
  if (failed.length) process.exit(1);
}

function main() {
  if (flags.has("--self-test")) return selfTest();

  const { events, skipped } = readEvents();
  // 帳本不存在時 readEvents 會回一筆 events_file_missing。那不是壞掉，
  // 是還沒有人跑過生產者——照實記在 skipped 裡，不要當成錯誤中止。
  const summary = buildSummary(events);

  const existing = readJsonIfExists(path.join(ROOT, "data/agent/learning-status.json"), {});
  const proposalsIndex = readJsonIfExists(path.join(ROOT, "data/agent/proposals.json"), { proposals: [] });
  const proposalCount = Array.isArray(proposalsIndex.proposals) ? proposalsIndex.proposals.length : 0;

  const status = {
    mode: "auto-opt-v2",
    last_replay_at: nowIso(),
    events_count: events.length,
    // profile 版本以帳本裡最後一次生產事件為準；帳本還沒事件時沿用既有值，
    // 不要因為重播就把歷史版本抹成空字串。
    profile_version: summary.latest_profile_version || existing.profile_version || "",
    active_boundaries: Array.isArray(existing.active_boundaries) && existing.active_boundaries.length
      ? existing.active_boundaries
      : [
          "agent_outputs_advisory_only",
          "no_write_data_latest_json",
          "no_direct_prompt_patch",
          "raw_feedback_off_repo",
          "human_review_required_for_memory_and_skills",
          "evaluator_gated_auto_apply",
        ],
    // proposal_count 以 proposals.json 為單一真相來源。驗證器在 --strict 下會比對
    // 這兩個數字，讓它們從同一處推導出來，就不會有人改了一邊忘了另一邊。
    proposal_count: proposalCount,
    last_error: null,
    skipped_events_count: skipped.length,
    learning_summary: summary,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, "learning-status.json");
  fs.writeFileSync(outFile, `${JSON.stringify(status, null, 2)}\n`, "utf8");

  console.log(`帳本：${LEDGER_FILE}`);
  console.log(`輸出：${path.relative(ROOT, outFile)}${PROMOTE ? "" : "（預覽路徑，不會發布）"}`);
  console.log(`事件 ${events.length} 筆、跳過 ${skipped.length} 筆、提案 ${proposalCount} 件`);
  if (skipped.length) console.log(`  跳過原因：${skipped.map((s) => `${s.line}:${s.reason}`).join("、")}`);
  for (const t of summary.topic_signals) {
    console.log(`  ${t.direction.padEnd(7)} ${t.id.padEnd(30)} 權重 ${t.weight}｜看過 ${t.observed} 次｜回饋 ${t.feedback_count} 次`);
  }
}

main();
