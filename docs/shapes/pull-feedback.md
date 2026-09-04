<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

### D. `pull-feedback.mjs` 與 Firestore `feedback/`

- 憑證：`ARCHIVER_ENV` 或 `~/.config/ai-news-hub/archiver.env`，需 `FB_API_KEY / FB_PROJECT_ID / WRITER_EMAIL / WRITER_PASSWORD`；檔不存在 → 印 `pull-feedback skipped`、exit 0；self-test 失敗 1；fatal 2。
- 查詢：REST `runQuery`，`from feedback where ts >= last_ts orderBy ts, __name__`，每頁 500、最多 20 頁；**唯讀**。重新評分換新 `ts` 會再擷取一次，latest-wins 交給 replay；前端取消評分（刪文件）不會回帳本。
- 文件 `feedback/{uid}_{safe}`：`{uid, item_id, cat, rating, item_date, title, url, ts}`，`safe` = item_id 非 `[A-Za-z0-9_-]` 字元改成 `.` + 十六進位；docId 以 uid 開頭是 `firestore.rules` 硬條件。
- 前端：localStorage `ainews-fb` = `{[itemId]: {rating, cat, item_date, title, url, ts}}`，全域 `FEEDBACK`（`config.js:54`）；`FB_RATINGS=['good','mid','bad']`；同鍵再按 = 取消（本機刪 + Firestore `delete()`）；雙向比 `ts`，較新者勝。

