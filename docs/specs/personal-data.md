# 個人資料契約

`personal-data.js` 負責快取、資料清理、時間戳及刪除合併；`firebase.js` 負責身分與雲端交易；`bookmarks.js` 負責操作與顯示。維持 classic script、零 build。

## 身分與本機儲存

- localStorage key：`ainews-personal-v2:guest` 或 `ainews-personal-v2:user:<encoded uid>`；內容含 `version:2`、`bookmarks`、`feedback`、`deleted`、`feedbackDeleted`。
- 初次未登入時可讀舊 `ainews-bm`／`ainews-fb`；不刪除舊 key。舊資料沒有可靠身分歸屬，因此只留本機，登入後不自動上傳。登入顯示該 UID 快取及雲端資料；登出顯示 guest 收藏。
- 同一身分重複 auth callback 不重載快取；切換身分增加 epoch，舊的非同步回應不得修改新身分記憶體或上傳到新 UID。
- 只接受合法 bm ID、物件記錄、已知分類、ISO 時間戳和有效評分。分類名稱／色彩來自程式常數；null、陣列、壞 JSON 不得中斷新聞啟動。
- 儲存失敗顯示提示；操作仍保留在記憶體，登入時繼續嘗試同步，不能宣稱關閉後仍會保留。跨分頁合併後再次保存穩定排序的快取，避免遺失及事件迴圈。

## 雲端交易

`users/{uid}` 保留書籤 map，新增 `bookmark_deleted`、`feedback_state`、`feedback_deleted`、`feedback_v2:true`。回饋仍鏡射到既有 `feedback/{uid}_{bmId}`，供夜班讀取；不改寫既有學習帳本，也不將原始回饋寫入公開 repo。

- 以 `savedAt`／`ts` 比較新舊；刪除時間相同或更新時，刪除勝出。刪除紀錄不自動清除，避免長期離線裝置重新帶回舊項目。新操作時間大於本機已知時間，可重新加入。
- 同 UID／epoch 同步序列化；交易內合併雲端最新 map，整個 map 欄位使用 update 取代，避免 merge 遺留已刪除子項。
- 初次以本人 feedback 查詢遷入 canonical state；之後 canonical state 與 feedback 鏡射於同筆 transaction 更新。外部查詢比交易狀態舊時重新查詢，最多重試兩次；失敗保留本機並顯示未同步。
- 每個 await 前後核對身分；交易永遠使用捕捉的 UID。重連、下一次操作、重新登入會重試本機變更。

## 相容性與驗收界線

- 所有裝置須重新載入新版，才能遵守 tombstone；舊版客戶端不理解新契約。不要把舊版持續寫入的環境宣告為跨裝置驗收通過。
- 保留既有單文件模型，仍受 Firestore 單文件大小及交易寫入限制；本次未擅自清除歷史紀錄。同步失敗必須可見且本機可用；若實際用量接近限制，下一工項為逐筆子集合遷移，不能靜默丟資料。
- 時間先後以客戶端 ISO 時間判定；裝置時鐘偏移會影響衝突排序。這不是多人即時協作資料庫。
- 離線模型測試與本機 DOM smoke test 不等於真實 Firebase 帳號、多裝置或已部署規則驗收。正式驗收須以專用測試帳號執行，核對書籤新增／刪除、快速評分取消、A→B→登出和跨裝置重連。
