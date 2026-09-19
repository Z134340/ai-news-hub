# 下一 Session 完整 Prompt：AH-04

請在 `/Users/zyc/ai-news-hub` 執行架構強化工項 **AH-04：部署後驗證、通知與 Cloudflare 回滾**，本 Session 只做 AH-04；若查證 AH-03 尚有未完成驗收，先接續 AH-03，不得跳過。

開始前：

1. 完整讀取根目錄 AGENTS.md、CLAUDE.md，以及 HANDOFF.md §0–§1。
2. 讀取 `docs/specs/architecture-hardening-v1.md`，確認 AH-01～AH-03 真實狀態、AH-04 範圍、re-scan 與 Gate A／B。
3. 讀取 `docs/specs/release-manifest.md`、`docs/shapes/release-manifest.md`、`docs/specs/category-quality.md`、`docs/shapes/category-quality.md`、`docs/shapes/data-contract-v2.md`、`docs/shapes/site-robustness.md`，以及 `docs/specs/deployment.md`、`workflows.md`、`run-daily.md`、`data-formats.md`、`architecture.md`；再讀受影響 workflows、manifest verifier、build 與測試。
4. fetch 最新 `origin/main`、`codex/ah-01-data-contract-v2`、`codex/ah-02-category-quality-gates`、`codex/ah-03-release-manifest`。核對 AH-03 遠端提交及同 SHA CI，不將本機通過當作遠端或部署證據。
5. 以已確認的 AH-03 遠端交付 SHA 建立獨立 worktree 與分支 `codex/ah-04-post-deploy-verification`，安全合併最新每日提交，保留 AH-00～AH-03。不得在每日排程 main 工作目錄開發，不得 force-push、reset 或覆蓋既有變更。

前置事實（須以 Git／文件核對）：

- AH-02 基準是 `a2982ece9d130661cfc6297050a51e5aa5e004bd`；AH-03 已在 `codex/ah-03-release-manifest` 完成離線實作及交付，具體 SHA 以 fetch 後分支與交接核實。
- AH-03 本機驗收：Python 119/119、Node 65/65、validator 24/24、merge 3/3、25 組既有離線回歸、語法／Cloudflare allowlist／實際 HTTP fixture／archive dry-run 通過。新 Node suite 已透過 Python discover 納入原 CI。
- manifest v1 綁定 AH-02 selected v2 的精確 bytes、`data_sha256`、`release_id`、不可變內容 path；先 blob／相容 latest，最後 manifest。`scope=local_snapshot` 不代表 Git push／部署成功；尚無 code/content Git SHA 的部署 receipt。
- 前端共用 manifest loader 及版本 cache；同版不重抓大型內容，畸形／hash 不符／版本交錯不宣稱驗證成功。舊快照缺 manifest 可用明示未驗版本的相容模式。正式資料仍沒有補 manifest 或證據。
- AH-01～AH-03 未整合 main、未啟用正式 store、未正式擷取或部署；既有 legacy／needs_review 不得冒充可靠前版。Gate A 整體尚未完成，不得以離線通過宣稱 production ready。

本次範圍：

1. 為 Cloudflare 發布加入 post-deploy smoke／manifest／精確內容 hash／必要 headers 核對，追溯實際 code SHA、內容身分與 deployment；各階段成功及失敗分開記錄。
2. 通知必須晚於相同發布的線上驗證成功；處理重跑、重複事件、部分失敗、舊／新發布交錯，錯 hash 或錯 SHA 不得發成功通知。
3. 定義指定「已驗證 SHA／deployment」的人工回滾，提供 dry-run、核對與失敗恢復；不以最新一次或任意舊快照冒充已驗證可回退版本。
4. 保留 AH-03 舊前端相容、品質閘、LKG、隔離原件、時間語意、canonical URL／item_id／原書籤 itemKey。

勿動及授權邊界：

- 一般測試全部使用 fixture／暫存目錄／假的部署與通知端點，不正式擷取、不以 production 寫入或真實通知當驗收。
- 此 Prompt 授權 AH-04 程式、workflow 設計／測試與文件；不自動授權 main 整合、正式部署、回滾執行、token／secret／權限修改或真實通知。需要外部動作時先完成可審查產物，再核對既有授權與 Gate；未執行須如實記錄。
- 不提前 AH-05 停用 GitHub Pages、不做 L3 拆分、Firebase v3、書籤 ID 切換；不放寬 learning-loop manual_only／preview／promotion／權限或人工審核邊界。

驗收：

- 同 SHA success／failure、404／超時、畸形 manifest、錯 hash／bytes／metadata、headers 缺失、版本交錯與重跑／通知冪等正反 fixture。
- 人工回滾 dry-run，指定版本不存在／未驗證時拒絕，以及失敗恢復證據。
- AH-01～AH-03 Python／Node 全套、validate.py --self-test、merge-stack.py --self-test、test_robustness.py、受影響語法、既有 25 組離線回歸、Cloudflare allowlist build、git diff --check。
- 本機、GitHub CI、production deployment、線上驗收與授權分開記錄；沒有外部驗收不得假稱端到端完成。

完成後更新 architecture-hardening-v1.md 真實狀態與 re-scan、受影響 spec／shape 與 HANDOFF.md §0。只提交 AH-04 檔案並立即 push 專用分支，不整合 main。回報 commit、分支、測試、外部限制、風險與回滾方式，並附依實際結果重寫的下一 Session 完整 Prompt；AH-04 若未完成必須接續剩餘工作，不得提前 AH-05。
