# 網站與每日流程定位（2026-09-18）

此檔只提供程式與資料入口；契約在連結的 spec 維護。

| 目標 | 程式入口 | 權威契約／回歸 |
|---|---|---|
| 個人快取與刪除合併 | `assets/js/personal-data.js`：`cleanPersonal`、`mergePersonal`、`persistPersonal`、`switchPersonalAccount` | `docs/specs/personal-data.md`；`scripts/tests/frontend.test.mjs` |
| 登入與同步 | `assets/js/firebase.js`：`syncPersonalToCloud`、`performPersonalSync`；`assets/js/bookmarks.js` 操作入口 | 同上；雲端 `users/{uid}` 與 `feedback/{uid}_{bmId}` |
| 安全外連 | `assets/js/config.js`：`esc`、`safeURL`、`linkOut` | `scripts/tests/frontend.test.mjs` |
| 逾時與歷史 | `assets/js/data.js`：`fetchJSON`、`loadData`；`firebase.js`：`archivePage`、`archiveGet`；`history.js`：歷史清單與回到最新；`dashboard.js`：先靜態後冷層 | `docs/specs/architecture.md`；前端回歸 |
| 候選驗證 | `scripts/validate.py`：`validate_items`、CLI `--input`／`--output`／`--dry-run` | `docs/specs/validate.md`、`data-formats.md`；`docs/shapes/data-contract-v2.md`；`scripts/tests/test_robustness.py`、`test_data_contract.py` |
| 分類品質／可靠前版 | `scripts/category-publication.py`、`contracts/category_quality.py` | `docs/specs/category-quality.md`、`docs/shapes/category-quality.md`；`test_category_quality.py` |
| 排程鎖與發布 | `scripts/run-locked.py`：`run_locked`；`scripts/publish-daily.py`：`publish`、`push_candidate`、`retry_pending`；`run-daily.sh` 組合流程 | `docs/specs/run-daily.md`；Python 回歸 |

驗證入口為 `.github/workflows/selftest.yml`；本機模型與暫存 Git remote 測試，不代表正式 Firebase、實際每日擷取或部署驗收。

AH-03 接續入口：[release-manifest.md](release-manifest.md)。內容發布與原始 bytes cache 保留既有 v2、品質閘與書籤契約。
