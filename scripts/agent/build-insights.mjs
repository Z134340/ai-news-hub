#!/usr/bin/env node
// ai-news-hub agent 輸出的生產者。
//
// 為什麼要有這支：repo 裡本來只有 scripts/agent/check-agent-outputs.mjs，
// 那是「驗證器」——它會檢查 data/agent/*.json 合不合契約，但不會產生它們。
// 2026-07-26 盤點時 grep 全 repo 找不到任何產生那些檔的程式，而所有輸出的
// 時間戳都停在 2026-07-09 18:10（正好是擷取管線因 detached HEAD 中斷的同一天）。
// 也就是說：這套系統有驗收標準、有資料格式、有治理契約、有稽核程式，
// 唯獨缺了真正做事的那一半。這支就是補上缺的那一半。
//
// 它是「程式」不是「agent」，理由見 lib/lexicons.mjs 開頭：這裡要的是一致性，
// 同一批新聞跑兩次必須得到完全一樣的叢集與分數，否則時間軸會出現假趨勢。
//
// 發布安全：run-daily.sh 每天 18:00 會跑 `git add data/` 然後 push 到公開的
// GitHub Pages。所以預設輸出到 data/agent/.preview/（已在 .gitignore），
// 確認過內容再用 --promote 落到正式的 data/agent/。
//
// 用法：
//   node scripts/agent/build-insights.mjs                # 產到 .preview，不影響線上
//   node scripts/agent/build-insights.mjs --promote      # 落正式路徑（會被隔天推上線）
//   node scripts/agent/build-insights.mjs --window 14    # 改變趨勢掃描視窗
//   node scripts/agent/build-insights.mjs --self-test    # 只跑內建不變式檢查

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { TOPIC_LEXICONS, FINANCIAL_LEXICON, HIGH_QUALITY_SOURCE_HINTS, matchTerms } from "./lib/lexicons.mjs";
import { loadWindow, itemsOf, haystackOf, listDailyFiles, readDaily, CORPUS_DIR } from "./lib/corpus.mjs";
import { appendEvent, ledgerStats } from "./lib/ledger.mjs";

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const valueOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

const WINDOW_DAYS = Number(valueOf("--window", "7"));
const PROMOTE = flags.has("--promote");
const OUT_DIR = path.join(ROOT, valueOf("--out-dir", PROMOTE ? "data/agent" : "data/agent/.preview"));

// 六個子分數的權重。這組數字不是拍腦袋定的，是從 2026-07-09 那批既有輸出反推的：
// 該批 llm_evaluation_governance 的 score=0.89，其 breakdown 除 financial_relevance
// (0.448) 外五項皆為 1。代入 0.20/0.20/0.15/0.20/0.15/0.10 得 0.8896 → 0.89，吻合；
// 其餘五個叢集回推出的 financial_relevance 也都落在 0.215~0.45 的合理區間。
// 沿用同一組權重，新舊分數才可以放在同一條時間軸上比較。
const WEIGHTS = {
  relevance: 0.2,
  recency: 0.2,
  novelty: 0.15,
  financial_relevance: 0.2,
  evidence_quality: 0.15,
  topic_weight: 0.1,
};

// relevance 打滿所需的證據筆數。低於這個數的叢集分數會被壓低，避免只有兩三則
// 新聞就被推上趨勢首位——那通常是同一則消息被多家轉述造成的假訊號。
const RELEVANCE_FULL = 20;
const EVIDENCE_PER_CLUSTER = 8;
const MAX_SOURCES = 10;

// financial_relevance 用兩層算，不是單純數詞頻。
// 白話講：「模型治理」這個主題對銀行的意義天生就比「教學文」高，這是主題的固有屬性
// （lexicons.mjs 的 financial_base）；但某一週如果真的出現金管會、Basel、洗錢防制
// 這類具體訊號，該叢集當週的金融相關度就該再往上跳一段（觀測項）。
// 為什麼不能只用觀測項：實測過了——這個語料是 AI 技術新聞，逐則數金融詞的命中率
// 只有 0~0.161 且六個叢集全擠在 0.12 附近，完全沒有鑑別力，等於白佔 20% 權重。
// 為什麼不能只用固定值：那樣這個子分數永遠不隨時間變，時間軸上會變成一條直線。
const FINANCIAL_BASE_SHARE = 0.7;
// 命中率到這個水準就算「當週金融訊號滿載」。0.25 是照近 7 天實測上緣（0.161）
// 再留餘裕定的，避免平常週就把觀測項打滿而失去區別。
const FINANCIAL_HIT_FULL = 0.25;

const round3 = (n) => Math.round(n * 1000) / 1000;
const nowIso = () => new Date().toISOString();

function readJsonIfExists(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

// 學習側寫（learning-profile.json）目前是全 1 的中性權重。之後 events.jsonl 有流量、
// replay 跑起來以後，topic_weights 會開始偏離 1，趨勢排序就會反映人審的實際偏好。
function loadProfile() {
  const file = path.join(process.env.HOME || "", ".ai-news-hub", "learning", "learning-profile.json");
  const profile = readJsonIfExists(file, {});
  return {
    profile_version: profile.profile_version || "profile-bootstrap",
    topic_weights: profile.topic_weights || {},
    source_weights: profile.source_weights || {},
  };
}

// 判斷一則證據的品質：擷取鏈已驗證過連結，或來自一手來源（論文站、模型廠、監理機關）。
function isHighQuality(item) {
  if (item.verified) return true;
  const source = String(item.source || "").toLowerCase();
  const url = String(item.url || "").toLowerCase();
  return HIGH_QUALITY_SOURCE_HINTS.some((hint) => {
    const h = hint.toLowerCase();
    return source.includes(h) || url.includes(h);
  });
}

// 收集視窗外（更早）的 URL，用來算 novelty：視窗內首次出現的比例。
// 沒有這一項的話，一個連續三個月每天都被提到的老話題會永遠佔著趨勢第一名。
function priorUrls(windowDates) {
  const earliest = windowDates[0];
  const seen = new Set();
  for (const entry of listDailyFiles(CORPUS_DIR)) {
    if (entry.date >= earliest) continue;
    for (const item of itemsOf(readDaily(entry.file))) {
      if (item.url) seen.add(item.url);
    }
  }
  return seen;
}

function buildClusters(days, profile) {
  const windowDates = days.map((d) => d.date);
  const older = priorUrls(windowDates);
  const clusters = [];

  for (const topic of TOPIC_LEXICONS) {
    const occurrences = [];   // 同一則新聞連續兩天都出現就算兩筆，反映「持續被談論」
    const uniqueUrls = new Map();
    const categories = new Set();
    const sources = new Set();
    let financialHits = 0;
    let qualityHits = 0;
    const daysWithHits = new Set();

    for (const day of days) {
      for (const item of itemsOf(day.daily)) {
        const hits = matchTerms(haystackOf(item), topic.terms);
        if (!hits.length) continue;
        occurrences.push(item);
        daysWithHits.add(day.date);
        categories.add(item.category);
        if (item.source) sources.add(item.source);
        if (matchTerms(haystackOf(item), FINANCIAL_LEXICON).length) financialHits += 1;
        if (isHighQuality(item)) qualityHits += 1;
        const key = item.url || `${item.title}@${item.date}`;
        if (!uniqueUrls.has(key)) {
          uniqueUrls.set(key, { item, reason: `Matched ${hits.slice(0, 4).join(", ")}` });
        }
      }
    }

    if (!occurrences.length) continue;

    const total = occurrences.length;
    const unique = [...uniqueUrls.values()];
    const freshCount = unique.filter(({ item }) => !item.url || !older.has(item.url)).length;

    const financialHitRate = financialHits / total;
    const financialObserved = Math.min(1, financialHitRate / FINANCIAL_HIT_FULL);
    const financialBase = Number(topic.financial_base ?? 0.3);

    const breakdown = {
      relevance: round3(Math.min(1, total / RELEVANCE_FULL)),
      recency: round3(daysWithHits.size / Math.max(1, days.length)),
      novelty: round3(unique.length ? freshCount / unique.length : 0),
      financial_relevance: round3(
        FINANCIAL_BASE_SHARE * financialBase + (1 - FINANCIAL_BASE_SHARE) * financialObserved,
      ),
      evidence_quality: round3(qualityHits / total),
      topic_weight: round3(Number(profile.topic_weights[topic.cluster_id] ?? 1)),
    };

    const score = round3(
      Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + breakdown[key] * weight, 0),
    );

    // 證據挑選：先照品質再照日期，同分時用標題排序，確保同一批輸入永遠得到同一份證據清單。
    const evidence = unique
      .sort((a, b) => {
        const q = Number(isHighQuality(b.item)) - Number(isHighQuality(a.item));
        if (q) return q;
        if (a.item.date !== b.item.date) return b.item.date.localeCompare(a.item.date);
        return a.item.title.localeCompare(b.item.title);
      })
      .slice(0, EVIDENCE_PER_CLUSTER)
      .map(({ item, reason }) => ({
        title: item.title,
        url: item.url,
        source: item.source,
        date: item.date,
        category: item.category,
        reason,
      }));

    clusters.push({
      cluster_id: topic.cluster_id,
      title: topic.title,
      mode: "ranking-only",
      advisory: true,
      score,
      score_breakdown: breakdown,
      evidence_count: total,
      unique_item_count: unique.length,
      // 把 financial_relevance 的兩層拆開留檔，稽核時才看得出分數是主題固有值還是當週訊號推上去的。
      financial_base: financialBase,
      financial_signal_rate: round3(financialHitRate),
      categories: [...categories].sort(),
      sources: [...sources].sort().slice(0, MAX_SOURCES),
      why_now: `${topic.title} appears across ${categories.size} category/categories with ${unique.length} evidence item(s) inside the latest ${days.length}-day window.`,
      financial_implication: topic.financial_implication,
      suggested_action: topic.suggested_action,
      evidence,
    });
  }

  return clusters.sort((a, b) => b.score - a.score || a.cluster_id.localeCompare(b.cluster_id));
}

function buildCandidates(clusters, meta) {
  return clusters.map((cluster) => ({
    candidate_id: `cand-trend_topic-${cluster.cluster_id}`,
    candidate_type: "trend_topic",
    created_at: meta.generated_at,
    topic: cluster.title,
    category: cluster.cluster_id,
    mode: "ranking-only",
    advisory: true,
    production_write: false,
    status: "pending_review",
    source_signal: {
      evidence_count: cluster.evidence_count,
      unique_item_count: cluster.unique_item_count,
      categories: cluster.categories.length,
      sources: cluster.sources.length,
      window_days: meta.window_days,
      source_latest_date: meta.source_latest_date,
    },
    score: cluster.score,
    scores: cluster.score_breakdown,
    reason: cluster.why_now,
    why_now: cluster.why_now,
    financial_implication: cluster.financial_implication,
    research_questions: [
      `${cluster.title} 目前的證據裡，哪幾則是一手來源、哪幾則只是轉述？`,
      `這個趨勢若成立，對現行的模型風險控制或作業流程要改哪一條？`,
    ],
    suggested_next_queries: cluster.sources.slice(0, 3).map((s) => `${cluster.title} ${s}`),
    evidence: cluster.evidence.slice(0, 5),
    boundary: {
      mode: "ranking-only",
      advisory_only: true,
      requires_human_review: true,
    },
  }));
}

function buildRecommendations(clusters, meta) {
  return clusters.slice(0, 5).map((cluster, index) => ({
    recommendation_id: `rec-${String(index + 1).padStart(2, "0")}-${cluster.cluster_id}`,
    cluster_id: cluster.cluster_id,
    priority: index + 1,
    mode: "ranking-only",
    advisory: true,
    title: `追蹤 ${cluster.title}`,
    rationale: `${cluster.evidence_count} item(s), score ${cluster.score}, evidence quality ${cluster.score_breakdown.evidence_quality}.`,
    suggested_action: cluster.suggested_action,
    review_questions: [
      `這個叢集的 ${cluster.score_breakdown.financial_relevance} 金融相關度，是否足以排進本季追蹤清單？`,
      `證據裡的 ${cluster.sources.length} 個來源是否過度集中在單一機構？`,
    ],
    evidence_urls: cluster.evidence.map((e) => e.url).filter(Boolean).slice(0, 5),
    source_latest_date: meta.source_latest_date,
    profile_version: meta.profile_version,
  }));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return fs.statSync(file).size;
}

// 取一批真實語料供 self-test 用。self-test 必須在沒有語料時也能跑完
// （CI、乾淨 checkout），所以讀不到就回 null 由呼叫端跳過，不讓整個檢查掛掉。
function safeLoadWindow() {
  try {
    const days = loadWindow({ repoDir: ROOT, windowDays: WINDOW_DAYS });
    return days.length ? { days, profile: loadProfile() } : null;
  } catch (error) {
    return null;
  }
}

// 內建不變式檢查。跑得動不等於跑得對——這幾條是「輸出一定要成立」的性質，
// 任何一條掛掉就代表叢集邏輯有回歸。
function selfTest() {
  const cases = [];
  const check = (label, ok) => cases.push([label, !!ok]);

  // 詞邊界：英文詞不該命中更長的單字，中文詞用子字串比對。
  check("英文詞不誤命中長單字", matchTerms("secondary market", ["sec "]).length === 0);
  check("英文詞正常命中", matchTerms("NIST released a framework", ["nist"]).length === 1);
  check("中文詞子字串命中", matchTerms("金管會發布監理指引", ["監理"]).length === 1);
  check("空詞不當命中", matchTerms("anything", [""]).length === 0);
  check("正則字元不炸開", matchTerms("c++ guide", ["c++"]).length >= 0);

  // 權重必須加總為 1，否則分數會脫離 0~1 區間、跟歷史輸出不可比。
  const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  check("六項權重加總為 1", Math.abs(sum - 1) < 1e-9);

  // 反推驗證：五項滿分 + financial_relevance 0.448 必須還原成 0.89。
  const replay = round3(
    1 * WEIGHTS.relevance + 1 * WEIGHTS.recency + 1 * WEIGHTS.novelty +
    0.448 * WEIGHTS.financial_relevance + 1 * WEIGHTS.evidence_quality + 1 * WEIGHTS.topic_weight,
  );
  check("權重可還原 2026-07-09 的 0.89", replay === 0.89);

  // 金融詞庫不得與 governance 主題詞庫重疊，否則 financial_relevance 變成
  // 「它是不是 governance」的複製品（第一次試跑就踩到，分數被推到 0.6~0.67）。
  const governanceTerms = new Set(
    TOPIC_LEXICONS.find((t) => t.cluster_id === "llm_evaluation_governance").terms.map((t) => t.toLowerCase()),
  );
  const overlap = FINANCIAL_LEXICON.filter((t) => governanceTerms.has(t.toLowerCase()));
  check(`金融詞庫與 governance 主題詞零重疊（實測重疊 ${overlap.length} 個）`, overlap.length === 0);

  // 每個主題都要有 financial_base，且落在既有基準觀測到的 0.2~0.45 區間。
  check("六個主題都有 financial_base", TOPIC_LEXICONS.every((t) => typeof t.financial_base === "number"));
  check("financial_base 落在 0.2~0.45", TOPIC_LEXICONS.every((t) => t.financial_base >= 0.2 && t.financial_base <= 0.45));

  // 混合公式：零金融訊號時等於 0.7×base；訊號打滿時等於 0.7×base+0.3。
  const mix = (base, rate) =>
    round3(FINANCIAL_BASE_SHARE * base + (1 - FINANCIAL_BASE_SHARE) * Math.min(1, rate / FINANCIAL_HIT_FULL));
  check("零金融訊號 → 只剩主題固有值", mix(0.45, 0) === 0.315);
  check("金融訊號打滿 → 加滿 0.3", mix(0.45, 0.5) === 0.615);
  check("觀測項不會超過上限", mix(0.2, 10) === mix(0.2, 0.25));

  // 正規化：沒有標題的項目要被丟掉，不能變成空字串證據。
  check("無標題項目被丟棄", itemsOf({ data: { papers: [{ url: "u" }] } }).length === 0);
  check("有標題項目被保留", itemsOf({ data: { papers: [{ title: "T", url: "u" }] } }).length === 1);
  check("非陣列分類不炸", itemsOf({ data: { papers: null } }).length === 0);

  // 決定論：同一批輸入連跑兩次，叢集結果必須逐字元相同。
  // 這條是整個設計的前提——分派之所以做成程式而不是 agent，就是為了「一致」。
  // 一旦這裡開始飄，時間軸圖上會出現不存在的趨勢波動（同一則新聞今天算 governance、
  // 明天算 security），而那種假訊號從圖上看不出來。時間戳本來就每次不同，
  // 所以只比 clusters，不比 meta。沒有語料時（例如乾淨 checkout）跳過並標明。
  const probe = safeLoadWindow();
  if (probe) {
    const first = JSON.stringify(buildClusters(probe.days, probe.profile));
    const second = JSON.stringify(buildClusters(probe.days, probe.profile));
    check(`叢集結果兩次執行逐字元相同（${probe.days.length} 天）`, first === second);
  } else {
    console.log("  skip 決定論檢查：找不到每日檔，無法取樣");
  }

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

  const profile = loadProfile();
  const latest = days[days.length - 1];
  const meta = {
    generated_at: nowIso(),
    source_latest_date: latest.date,
    source_latest_generated_at: String(latest.daily.generated_at || latest.daily.time || ""),
    profile_version: profile.profile_version,
    window_days: days.length,
    mode: "ranking-only",
    advisory: true,
    production_write: false,
  };

  const clusters = buildClusters(days, profile);
  const totalItems = days.reduce((sum, d) => sum + itemsOf(d.daily).length, 0);
  const categoryCounts = {};
  for (const item of itemsOf(latest.daily)) {
    categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
  }

  const trends = {
    ...meta,
    schema_version: "agent-trends-v0.1",
    input_summary: { total_items: totalItems, window_days: days.length, categories: categoryCounts },
    clusters,
  };
  const candidates = {
    ...meta,
    schema_version: "agent-candidates-v0.1",
    candidate_count: clusters.length,
    candidates: buildCandidates(clusters, meta),
  };
  const recommendations = {
    ...meta,
    schema_version: "agent-recommendations-v0.1",
    recommendations: buildRecommendations(clusters, meta),
  };

  const sizes = {
    trends: writeJson(path.join(OUT_DIR, "trends.json"), trends),
    candidates: writeJson(path.join(OUT_DIR, "candidates.json"), candidates),
    recommendations: writeJson(path.join(OUT_DIR, "recommendations.json"), recommendations),
  };

  // 把這一輪記進共享帳本。這是 Hermes 端之後做自主優化的唯一輸入來源。
  // 只記彙總後的判斷（叢集 id 與分數），不記原始新聞內容——帳本雖然在 repo 外，
  // 仍照 raw_feedback_off_repo 的精神維持最小揭露。
  appendEvent({
    event_type: "outputs_generated",
    actor: "build-insights.mjs",
    subject_type: "trends",
    subject_id: latest.date,
    payload: {
      window_days: days.length,
      total_items: totalItems,
      clusters: clusters.map((c) => ({ cluster_id: c.cluster_id, score: c.score, evidence_count: c.evidence_count })),
      profile_version: profile.profile_version,
      promoted: PROMOTE,
    },
  });

  console.log(`輸出目錄：${path.relative(ROOT, OUT_DIR)}${PROMOTE ? "（正式路徑，隔天 18:00 會被推上線）" : "（預覽路徑，不會發布）"}`);
  console.log(`視窗：${days[0].date} ~ ${latest.date}（${days.length} 天，${totalItems} 筆）`);
  for (const c of clusters) {
    console.log(`  ${c.score.toFixed(3)}  ${c.cluster_id.padEnd(28)} 出現 ${String(c.evidence_count).padStart(4)} 次 / 不重複 ${String(c.unique_item_count).padStart(3)} 則 / 金融相關 ${c.score_breakdown.financial_relevance}`);
  }
  console.log(`檔案大小：trends ${sizes.trends}B、candidates ${sizes.candidates}B、recommendations ${sizes.recommendations}B`);
  const stats = ledgerStats();
  console.log(`共享帳本：${stats.events_count} 筆事件 ${JSON.stringify(stats.event_types)}`);
}

main();
