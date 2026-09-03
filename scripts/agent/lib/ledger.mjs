// 共享學習帳本（shared ledger）的讀寫。
//
// 白話講這是什麼：ai-news-hub 這邊每天產生的判斷（分了哪些叢集、推薦了什麼、
// 人審接受或退回了哪一筆），以一行一筆的方式記進一個檔；Hermes 那邊之後
// 要做自主優化時，讀的就是這個檔。沒有它，兩邊只有合約沒有流量。
//
// 為什麼要特地寫這支：ai-news-hub 的 hermes.project.yaml 早在建置時就把
//   learning.shared_ledger: ~/.ai-news-hub/learning/events.jsonl
// 指好了，Hermes 的 hermes-projects.json 也登記了同一個路徑。但兩邊都只有
// 宣告、沒有任何程式碰過它——2026-07-26 查證時 replay-report.json 裡寫著
//   "events_read": 0, "events_skipped": [{"reason": "events_file_missing"}]
// 也就是這個檔從來沒有被建立過。整條回饋鏈斷在這個物理位置。
//
// 邊界：帳本一律在 repo 外（~/.ai-news-hub/），對應 raw_feedback_off_repo 這條
// active_boundary。repo 裡只會出現彙總後的 learning-status.json，不會有原始事件。

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const LEARNING_DIR = path.join(os.homedir(), ".ai-news-hub", "learning");
export const LEDGER_FILE = path.join(LEARNING_DIR, "events.jsonl");

export const EVENT_TYPES = new Set([
  "outputs_generated",   // 生產者跑完一輪，記下這輪的叢集與分數
  "curation_imported",   // Hermes NewsCurator 的判斷回流進來
  "output_accepted",     // 人審接受某筆輸出
  "user_correction",     // 人審改了某筆輸出（含改成什麼）
  "proposal_reviewed",   // 某筆 proposal 被人審處理（核可或退回）
  "audit_finding",       // SystemAuditor 提出的系統面觀察
  "human_rating",        // 前端 好/中/不好 按鈕，經 Firestore 由 pull-feedback.mjs 讀回
  "proposal_evaluated",  // change-evaluator 對某筆 proposal 的裁定（accept / reject）
  "proposal_auto_applied", // apply-change.mjs 實際改了檔案（含 diff 摘要與 canary 起算日）
  "canary_reverted",     // canary-check.mjs 偵測退化並回滾
]);

function ensureDir() {
  fs.mkdirSync(LEARNING_DIR, { recursive: true });
}

// 事件一律帶 ts / event_type / actor / subject，payload 才放各型別自己的欄位。
// 這樣 replay 端可以只認前四個欄位就做分流，不必知道每一種 payload 的形狀。
export function appendEvent(event) {
  const type = String(event && event.event_type || "");
  if (!EVENT_TYPES.has(type)) {
    throw new Error(`未知的 event_type：${type || "(空)"}`);
  }
  ensureDir();
  const record = {
    ts: event.ts || new Date().toISOString(),
    event_type: type,
    actor: String(event.actor || "system"),
    subject_type: String(event.subject_type || ""),
    subject_id: String(event.subject_id || ""),
    payload: event.payload && typeof event.payload === "object" ? event.payload : {},
  };
  fs.appendFileSync(LEDGER_FILE, `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

// 讀帳本。壞行不讓整個 replay 死掉——回報在 skipped 裡，由呼叫端決定要不要當成錯誤。
// （這條是刻意的：帳本是 append-only 的長期檔，一行寫壞不該讓後面幾百行都讀不到。）
export function readEvents() {
  if (!fs.existsSync(LEDGER_FILE)) {
    return { events: [], skipped: [{ line: 0, reason: "events_file_missing" }] };
  }
  const events = [];
  const skipped = [];
  const lines = fs.readFileSync(LEDGER_FILE, "utf8").split("\n");
  lines.forEach((line, index) => {
    const text = line.trim();
    if (!text) return;
    try {
      const parsed = JSON.parse(text);
      if (!EVENT_TYPES.has(parsed.event_type)) {
        skipped.push({ line: index + 1, reason: `unknown_event_type:${parsed.event_type}` });
        return;
      }
      events.push(parsed);
    } catch (error) {
      skipped.push({ line: index + 1, reason: "invalid_json" });
    }
  });
  return { events, skipped };
}

export function ledgerStats() {
  const { events, skipped } = readEvents();
  const byType = {};
  for (const event of events) byType[event.event_type] = (byType[event.event_type] || 0) + 1;
  return { events_count: events.length, event_types: byType, skipped_count: skipped.length };
}
