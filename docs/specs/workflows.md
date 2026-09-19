<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

## .github/workflows/backup-fetch.yml → health-check.yml 規範

**目的：** 本機排程沒跑時，更新 health.json 讓網站顯示警告。不執行擷取、不呼叫 API。

```yaml
觸發：每天 UTC 04:17（台灣 12:17）＋ workflow_dispatch（手動驗證）
      · 避開整點：GitHub 排程整點壅塞，實測延遲 3–9 小時，常跨台灣午夜
邏輯：
  1. checkout repo
  2. 計算 SLOT_DATE（這次檢查對應哪一天的 10:00 擷取）：
     · 台灣時間 < 12:00 → 檢查已延遲到隔天，SLOT_DATE = 昨天
     · 否則 SLOT_DATE = 今天
     （2026-09-05 修正：舊邏輯用「latest.date == 今天」，cron 延遲跨午夜就誤判 missed，
       08-28／08-29／09-01／09-05 四次皆為誤判）
  3. 讀取 data/latest.json 的 date 欄位
  4. 如果 date >= SLOT_DATE → 輸出 "本機已完成" → 結束
  5. 否則更新 data/health.json（同一 SLOT_DATE 已標記過則略過，不重複累加）：
     · status: "missed"
     · last_missed: SLOT_DATE
     · consecutive_failures +1
     · note: "本機排程未執行，等待電腦上線後自動補跑"
  6. health.json 有變更才 git commit + push（讓網站讀到最新 health.json）
權限：contents: write
```

**費用：$0**（僅讀寫 JSON，不呼叫任何 AI API）
**補跑機制：** 電腦上線後，macOS launchd MisfiredPolicy 會自動補執行 run-daily.sh。

### 不再需要 backup-fetch.mjs
此版本不執行備援擷取，移除 scripts/backup-fetch.mjs。

---

## 已退役：.github/workflows/keep-alive.yml

GitHub Pages 已於 2026-09-19 在 Cloudflare production 通過正常每日週期驗收後停用；只為 Pages 存在的每月保活 workflow 同步移除。`data/health.json` 的既有 `keep_alive` 欄位只保留歷史相容，不再由排程更新，也不得作為 Cloudflare 健康證據。

---


## 離線自測 CI

`selftest.yml` 在 main／codex 分支 push、所有 PR 與手動觸發時執行，無路徑篩選。保留原 26 組離線命令，另加入所有前端 JS 語法、run-daily 語法、前端狀態／同步回歸與 Python 驗證／Git／程序鎖回歸。測試使用暫存資料及本機 bare remote，禁止正式擷取、雲端寫入和 promote。

CI 設定不等於 GitHub 已啟用必須通過的 branch protection；未查證外部設定時不得宣稱必須通過才能合併。Firebase 規則部署與真實帳號驗收另行記錄。

---

## Cloudflare Pages production

`cloudflare-pages.yml` 只在 `main` 的「離線自測」成功後部署該次測試的同一個 `head_sha`；人工 deploy 也必須釘住完整 target SHA、成功 CI run ID 與 expected release ID。工作流程重新建置 `dist/` allowlist，不使用整個 repository 當 web root。

- 權限只有 `contents: read` 與 `deployments: write`。
- `cloudflare/wrangler-action` 與 Wrangler 固定版本，runner 固定 `ubuntu-24.04`。
- production deploy 與 rollback 共用單一 concurrency group；不取消已開始的 production mutation。
- GitHub secrets 只存 `CLOUDFLARE_ACCOUNT_ID` 與 Pages Edit scoped token；不得加入 Firebase writer 帳密。
- workflow 不部署 pull request 或外部 fork，避免讓 production token 進入未受信任程式碼路徑。
- Cloudflare GitHub App callback 的帳號層連線錯誤及 Direct Upload 決策記在 `docs/specs/deployment.md`，不能並行啟用第二條 production 自動部署。
- upload 後必須以 `scripts/post-deploy.mjs` 對固定 production URL 驗 manifest／四資產／headers；終態 receipt 以唯一 artifact 保存。`notify.yml` 僅為 verified receipt 的 reusable workflow，不再監聽 main push。
- 人工 rollback 只走 `cloudflare-rollback.yml` 的 plan／execute 雙階段；完整 identity、receipt、重試、通知與失敗契約只在 `docs/specs/deployment.md` 維護。
