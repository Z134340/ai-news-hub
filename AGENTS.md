# AGENTS.md — AI News Hub

> 本檔刻意精簡，**單一事實來源為 `CLAUDE.md`**。請先完整閱讀 `CLAUDE.md` 再行動，避免雙文件漂移。
> 交接狀態（已完成 / 待辦 / 勿動 / 上線 checklist）見 `HANDOFF.md`。

## 給 coding agent 的最低限度須知

1. **架構已正規化（2026-06）**：前端為 `index.html`（結構）+ `assets/css/` + `assets/js/` 九個 classic script 模組（載入順序固定，見 `CLAUDE.md`「架構正規化」節）。**不要把模組重新內聯回單檔。**
2. **儲存為混合冷熱分層**：熱資料（latest + 近 7 天）走 static JSON + Pages；冷封存（逾 7 天）與書籤走 Firebase。設定見 `FIREBASE-SETUP.md`、`ARCHIVE-SETUP.md`。
3. **placeholder 不要自行填值**：`assets/js/config.js` 的 `FIREBASE_CONFIG`、`firestore.rules` 的 `WRITER_UID` 由人從 Firebase console 填。
4. **機密界定**：`firebaseConfig` apiKey 非機密可進 repo；`~/.config/ai-news-hub/archiver.env`（writer 帳密）為機密，off-repo + gitignore，絕不 commit。
5. **後端不要動**：`scripts/run-daily.sh`、`validate.py` 等擷取/驗證鏈運作中；除非明確要求，僅驗證不重寫。
6. **驗證而非重建**：改動後跑 `node --check assets/js/*.js`、本機 `python3 -m http.server` smoke test、`node scripts/archive-to-firestore.mjs --dry-run`。

詳細規範（十二大分類、JSON 格式、validate 八步驟、排程、UX 規範）一律以 `CLAUDE.md` 為準。
