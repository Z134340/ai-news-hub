# AH-03 release manifest shape

權威：[發布與快取契約](../specs/release-manifest.md)。沿用 AH-01 v2 與 AH-02 selected snapshot；不涉及部署、Firebase 或 learning-loop 權限。

| 入口 | 職責 |
|---|---|
| `schemas/release/manifest-v1.schema.json` | 小型 manifest v1 的完整必要欄位、型別與格式 |
| `scripts/release-manifest.py` | `manifest_for`／`validate_manifest`／`verify_payload`：精確 bytes hash 與跨欄位驗證；`install`：quality lock 下核對 current selection，先 blob／latest，再 manifest；`verify_site`：建置一致性驗證 |
| `scripts/run-daily.sh` | AH-02 candidate 後呼叫 installer；每日與 supplement 共用路徑 |
| `scripts/build-site.mjs` | optional manifest 相容；來源及輸出驗證，只複製被引用 blob；Python 標準庫，無新第三方依賴 |
| `assets/js/data.js` | `readLatestRelease`：in-flight 合併、manifest 檢查、原始 text cache、hash／time 驗證、legacy／cached／failed；`checkLatestRelease`：15 分鐘檢查；`releaseNotice`：降級提示 |
| `assets/js/dashboard.js:dashFetch` | latest 使用共用 release loader，避免首頁與 dashboard 重複下載 |
| `assets/js/ui.js:updateHeader` | 最新頁保留 release 降級提示；歷史獨立 |
| `scripts/tests/test_release_manifest.py` | schema、精確 bytes、確定性／重跑、故障注入、過時候選、品質保留、allowlist；透過既有 Python unittest discover 也執行新增 Node suite，無 CI 設定變動 |
| `scripts/tests/release-data.test.mjs` | 真實 Web Crypto／原始 response bytes 的 VM fixture，版本／快取／併發／輪詢／降級 |
| `scripts/tests/test_category_quality.py` | AH-02 原 daily install fixture 接上實際 release installer，驗證 latest／日期封存相容 |

測試只寫暫存 data/store；正式資料沒有生成 manifest 或 blob。`config.js:itemKey`、canonical URL／item_id 與 `_checked_at`／`_updated_at`／outcome 原樣保留。
