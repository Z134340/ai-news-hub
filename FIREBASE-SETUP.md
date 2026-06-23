# Firebase 雲端書籤同步 — 設定指南

> 目的：讓書籤在 iPhone 與桌面之間自動同步。架構仿照你的 NeuroLearn 專案
> （Firebase v10 compat + Email/Password Auth + Firestore），但建立 **ai-news-hub 自己的專案**。
>
> 未完成本設定前，網站照常運作，書籤僅存於本機 localStorage（不同步）。
> 完成後，標頭會出現「☁ 同步」按鈕，登入即啟用跨裝置同步。

---

## A. 在 Firebase Console 建立專案（約 5 分鐘）

| 步驟 | 操作 |
|------|------|
| 1 | 開 https://console.firebase.google.com → **Add project** → 命名 `ai-news-hub` → 建立（Analytics 可關） |
| 2 | 左側 **Build → Authentication → Get started → Sign-in method** → 啟用 **Email/Password** |
| 3 | 左側 **Build → Firestore Database → Create database** → 選 **Production mode** → 區域選 `asia-east1`（台灣）或 `asia-northeast1`（東京） |
| 4 | 左上齒輪 **Project settings → General → Your apps** → 點 **Web `</>`** → 註冊 App（名稱隨意，不必勾 Hosting） → 複製出現的 `firebaseConfig` |

## B. 貼入設定（1 行檔案）

把步驟 4 的 config 貼進 **`assets/js/config.js`** 最上方的 `FIREBASE_CONFIG`，取代 `YOUR_*` 佔位字串：

```js
const FIREBASE_CONFIG = {
  apiKey:            "AIza....",                    // ← 你的
  authDomain:        "ai-news-hub-xxxx.firebaseapp.com",
  projectId:         "ai-news-hub-xxxx",
  storageBucket:     "ai-news-hub-xxxx.firebasestorage.app",
  messagingSenderId: "0000000000",
  appId:             "1:0000:web:abc123"
};
```

> 注意：這個 `apiKey` **不是機密**，是公開的前端識別碼（與 NeuroLearn 一樣寫在前端）。
> 安全性由下方 Firestore 規則保證，非靠隱藏 key。可安全 commit 進 GitHub。

## C. 部署 Firestore 安全規則

規則檔已備好在 repo 根目錄 `firestore.rules`（僅本人可讀寫自己 uid 的書籤）。二擇一：

**方式 1（簡單，免裝工具）：** Firebase Console → **Firestore Database → Rules** 分頁 → 貼上 `firestore.rules` 內容 → **Publish**。

**方式 2（CLI）：**
```bash
npm install -g firebase-tools
firebase login
firebase use --add        # 選 ai-news-hub-xxxx
firebase deploy --only firestore:rules
```

## D.（建議）限制 API key 網域

Google Cloud Console → **APIs & Services → Credentials** → 點該 Browser key → **Application restrictions → HTTP referrers** → 加入：
```
https://z134340.github.io/*
```
避免他人拿你的 config 從別的網域呼叫（即使有規則保護，仍是好習慣）。

## E. 驗收

1. push 後開啟網站 → 標頭出現「☁ 同步」。
2. 點 同步 → **註冊**（首次）一組 Email/密碼 → 自動登入。
3. 加幾個書籤 → 換到 iPhone 開同一網站 → 同步 → 用同帳號登入 → 書籤出現即成功。

| 驗收項目 | 通過條件 |
|----------|----------|
| 未登入 | 書籤仍可用（localStorage），無錯誤 |
| 登入後 | 本機既有書籤上傳雲端 |
| 跨裝置 | 另一裝置登入同帳號 → 書籤聯集出現 |
| 安全 | 未登入無法讀寫 Firestore（規則擋下） |

---

### 同步行為說明（已知邊界）
- 採 **offline-first**：每次加/刪書籤先寫 localStorage，已登入才寫雲端。
- 跨裝置同步發生在**登入當下**（聯集，衝突取較新 `savedAt`）；非即時推播。換裝置看不到最新時，重新整理或重新登入即可。
- 若要「即時多裝置同步」，可後續為 `users/{uid}` 加 `onSnapshot` 監聽（目前刻意不開，避免回寫迴圈）。
