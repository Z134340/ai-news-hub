<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

### D. `pull-feedback.mjs` 與 Firestore `feedback/`

- 憑證：`ARCHIVER_ENV` 或 `~/.config/ai-news-hub/archiver.env`，需 `FB_API_KEY / FB_PROJECT_ID / WRITER_EMAIL / WRITER_PASSWORD`；檔不存在 → 印 `pull-feedback skipped`、exit 0；self-test 失敗 1；fatal 2。
- 查詢：REST `runQuery`，`from feedback where ts >= last_ts orderBy ts, __name__`，每頁 500、最多 20 頁；**唯讀**。重新評分換新 `ts` 會再擷取一次，latest-wins 交給 replay；前端取消評分（刪文件）不會回帳本。
- 文件 `feedback/{uid}_{safe}`：`{uid, item_id, cat, rating, item_date, title, url, ts}`，`safe` = item_id 非 `[A-Za-z0-9_-]` 字元改成 `.` + 十六進位；docId 以 uid 開頭是 `firestore.rules` 硬條件。
- 前端：全域 `FEEDBACK`，`FB_RATINGS=['good','mid','bad']`；同鍵再按 = 取消。2026-09-18 起依 UID 分開保存 v2 快取，canonical feedback 與鏡射文件使用交易及刪除紀錄；`ainews-fb` 僅為 guest 舊資料遷入來源。契約唯一維護於 `docs/specs/personal-data.md`，程式定位見 `docs/shapes/site-robustness.md`。取消仍不追溯刪除已擷取的學習帳本。
