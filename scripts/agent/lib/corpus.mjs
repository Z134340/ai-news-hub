// 每日新聞檔的讀取與正規化。
//
// 資料來源有兩處，刻意都支援：
//   1. repo 內 data/YYYY-MM-DD.json —— 熱層，目前只留 7 天（run-daily.sh 會冷封存後 prune）
//   2. ~/.ai-news-hub/corpus/YYYY-MM-DD.json —— off-repo 語料鏡像，目前 34 天
// 趨勢叢集只看近 7 天就夠；時間軸圖需要更長歷史，那時就吃 corpus。
// 兩邊 schema 相同，差別只在保存長度，所以用同一支載入器。

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const CORPUS_DIR = path.join(os.homedir(), ".ai-news-hub", "corpus");

const DATE_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;

// 每日檔的 items 藏在 data 這一層的十個分類底下，不是攤平在頂層。
// （踩過一次：直接對頂層做 sum(len(v)) 會得到 0。）
export function itemsOf(daily) {
  const buckets = daily && typeof daily.data === "object" ? daily.data : {};
  const out = [];
  for (const [category, list] of Object.entries(buckets)) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const item = normalizeItem(raw, category, daily.date);
      if (item) out.push(item);
    }
  }
  return out;
}

// 各分類的欄位不完全一致：papers 有 authors/institution/venue，新聞類有 source。
// 統一成同一組欄位，下游（叢集、時間軸、dashboard）就不必各自處理分歧。
export function normalizeItem(raw, category, fallbackDate) {
  if (!raw || typeof raw !== "object") return null;
  const title = String(raw.title_zh || raw.title || "").trim();
  if (!title) return null;
  return {
    title,
    title_en: String(raw.title || "").trim(),
    url: String(raw.url || "").trim(),
    source: String(raw.source || raw.institution || raw.venue || "").trim() || "未標示來源",
    date: String(raw.date || fallbackDate || "").slice(0, 10),
    category,
    summary: String(raw.summary || raw.impact || "").trim(),
    // 擷取鏈自己標的驗證狀態，用來算 evidence_quality；缺欄位時保守當成未驗證。
    verified: raw.verified === true || raw.url_status === "verified",
  };
}

// 供比對用的一整串文字。標題權重最高，但摘要裡的關鍵詞也算數，
// 否則像「Anthropic 發表新的對齊研究」這種標題會漏掉 governance 訊號。
export function haystackOf(item) {
  return [item.title, item.title_en, item.summary, item.source].join(" \n ");
}

export function listDailyFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => DATE_FILE.test(name))
    .sort()
    .map((name) => ({ date: name.slice(0, 10), file: path.join(dir, name) }));
}

export function readDaily(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`無法讀取每日檔 ${file}：${error.message}`);
  }
}

// 取最近 windowDays 天。repo 與 corpus 都掃，同一天以 repo 為準
// （repo 那份是 run-daily.sh 剛驗證過的最新版，corpus 是鏡像可能落後一輪）。
export function loadWindow({ repoDir, windowDays = 7, corpusDir = CORPUS_DIR }) {
  const byDate = new Map();
  for (const entry of listDailyFiles(corpusDir)) byDate.set(entry.date, entry.file);
  for (const entry of listDailyFiles(path.join(repoDir, "data"))) byDate.set(entry.date, entry.file);
  const dates = [...byDate.keys()].sort();
  const picked = windowDays > 0 ? dates.slice(-windowDays) : dates;
  return picked.map((date) => ({ date, file: byDate.get(date), daily: readDaily(byDate.get(date)) }));
}
