<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

## validate.py 規範

八步驟驗證（詳細規範）：

**前置檢查（⚠️ Bug Fix #2）：**
```python
import os, sys
path = "data/latest.json"
if not os.path.exists(path):
    print("⚠️ latest.json 不存在，跳過驗證")
    sys.exit(0)
try:
    data = json.load(open(path))
except json.JSONDecodeError:
    print("❌ latest.json 格式錯誤")
    sys.exit(1)
```

**Step 1 — URL 存活檢測（⚠️ Bug Fix #3）：**
- 優先 HTTP HEAD 請求，timeout=10s
- 若 HEAD 回傳 405 Method Not Allowed → 改用 GET + stream（只讀 header 不下載 body）
- User-Agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
- concurrent.futures.ThreadPoolExecutor(max_workers=5)
- 每批次間隔 0.5 秒
- 判斷邏輯：
  · 2xx/3xx → verified: true
  · 403 → needs_review（不移除，某些網站正常擋 bot）
  · 405 → 已用 GET 重試，依 GET 結果判斷
  · 404/410 → verified: false → 移除
  · 5xx → verified: false → 移除
  · 超時/DNS 錯誤/ConnectionError → verified: false → 移除
  · URL 格式不合法 → verified: false → 移除
```python
def check_url(url):
    try:
        req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': UA})
        resp = urllib.request.urlopen(req, timeout=10)
        return resp.status
    except urllib.error.HTTPError as e:
        if e.code == 405:
            # HEAD 不支援，改 GET
            try:
                req = urllib.request.Request(url, headers={'User-Agent': UA})
                resp = urllib.request.urlopen(req, timeout=10)
                return resp.status
            except:
                return e.code
        return e.code
    except Exception:
        return 0  # 連線失敗
```

**Step 2 — 標題一致性檢測（反幻覺核心）：**
- 對 verified URL 抓取頁面內容，提取 `<title>` 或 `<h1>` 標籤
- 計算頁面標題與新聞 title 欄位的相似度（SequenceMatcher）
- 評分規則：
  · score ≥ 0.3 → 通過（允許翻譯差異與摘要改寫）
  · 0 < score < 0.3 → needs_review（標記但不移除，paywall/動態頁面等）
  · score = 0（完全無法對應）→ verified: false → 移除
- needs_review 計入 pass_rate（不扣分）
- 特例：TITLE_CHECK_RELAXED_DOMAINS（arxiv, medium, 中文媒體等）跳過標題比對
```python
TITLE_CHECK_RELAXED_DOMAINS = [
    "arxiv.org", "medium.com", "ithome.com.tw", "technews.tw",
    "digitimes.com", "inside.com.tw", "cna.com.tw", "nikkei.com",
]
def title_similarity(title_a, title_b):
    from difflib import SequenceMatcher
    a = re.sub(r'[^\w\s]', '', title_a.lower())
    b = re.sub(r'[^\w\s]', '', title_b.lower())
    return SequenceMatcher(None, a, b).ratio()
```

**Step 3 — 域名白名單**
- `TRUSTED_DOMAINS`（檔內硬編碼）在 import 時併入 `scripts/tier-b-domains.json` 的 `domains[]`（learning-loop v1 L-3，2026-09-11）。
- 合併規則：**add-only**（只增不減，決策 4）；每個網域小寫、去 `www.`；檔案缺失或 JSON 壞掉 → 記 warning、視為空集合，不中斷驗證。
- `tier-b-domains.json` 格式：`{ "schema": "tier-b-domains-v0.1", "note": "...", "domains": ["a.com", ...] }`，整檔即 `apply-change.mjs` 的 `TIER_B_DOMAINS` 區段；只允許 `add_domain` 追加，`validate.py` 只讀不寫。
- `check_domain_whitelist(url)` 仍是去 `www.` 後精確比對（不做子網域萬用），所以 tier-b 要登錄實際文章網域（如 `blogs.nvidia.com`），不是 feed 主機。
- 判定為 untrusted 只加 `Untrusted domain: X` 到 issues 並計 warning，不移除項目。
- 同目錄 `scripts/sources-registry.json`（`sources-registry-v0.1`）登錄 10 分類 × 官方站與 RSS/Atom feed（`name, tier A|B|C, lang, site|null, feed, type rss|atom|rdf`；`checked_at` 為查證日，全部 `curl -sI` 直接 200 且 feed 前 4KB 含 XML 標記；`site: null` 表示官方站 HEAD 非 200 只登錄 feed）。消費者是 L-4 `discover-trends.mjs`；`validate.py` 只在 `--self-test` 驗結構。
- `--self-test`（不打網路）：tier-b 缺檔／壞檔容忍、小寫去 www、add-only、白名單判定、registry 10 分類且每分類 ≥ 3 feed、分類內 feed 唯一，共 17 項，全 PASS 回 0。

**Step 4 — 欄位完整性**（同前）

**Step 5 — 日期合理性**
- 格式驗證 YYYY-MM-DD（用 try/except datetime.strptime）
- 各類別分別設定 max_days（CATEGORY_DATE_LIMITS）：
  · topnews/taiwan/china/usa → max_days=2（今天+昨天）
  · techtrends/governance → max_days=7
  · papers/tutorials/courses → max_days=90
  · models → allow_future（允許未來日期，最多 2 年前）
```python
CATEGORY_DATE_LIMITS = {
    'papers': 90, 'topnews': 2, 'taiwan': 2, 'china': 2, 'usa': 2,
    'techtrends': 7, 'governance': 7, 'tutorials': 90, 'courses': 90, 'models': None,
}
def validate_date(date_str, allow_future=False, no_limit=False, max_days=90):
    ...
    if parsed_date > today + timedelta(days=1) or parsed_date < today - timedelta(days=max_days):
        return False, 'date_out_of_range'
```

**Step 6 — 重複檢測**（同前）

**Step 7 — 驗證報告** → `data/logs/validate-YYYY-MM-DD.json`

**Step 8 — 自動修復**
- 移除 verified: false 項目
- 注入 verified/verified_at/url_status/complete 欄位
- 更新 stats 和 validation 摘要
- 覆寫 latest.json + 日期歸檔

接受參數：無參數=完整驗證，--category X=單類別，--dry-run=只報告，--self-test=離線自測後直接 exit（不讀 latest.json）
全部 try/except 包裹，不因單一項目中斷。

---

