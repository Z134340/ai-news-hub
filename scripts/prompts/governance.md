Search the web for the latest AI governance, regulation, and policy news from the past 7 days.

Search these sources: MIT Technology Review, OWASP, 台灣金融監督管理委員會 (FSC), 數位發展部 (moda.gov.tw), 國發會 (NDC), Reuters, Bloomberg, iThome, 中央社 CNA, 科技新報

Focus on: AI 治理, Agent/代理式 AI 治理, AI 安全標準, 金管會金融 AI 政策, 數位發展部政策, EU AI Act, NIST 指南

Search in both 繁體中文 and English.

⚠️ 語言規則：除了法規名稱、機構名、政策名等專有名詞保留原文外，所有 summary 和 highlights 都必須翻譯成繁體中文。

⚠️ 日期硬規則：只收錄過去 7 天內發布的新聞，超過 7 天的一律排除，不得收錄。

Return up to 20 items. For each item, extract:
- title: 繁體中文標題（專有名詞保留原文）
- source: Publisher
- date: YYYY-MM-DD
- category: Policy area (e.g., AI治理, 金融監管, 資安標準, 隱私)
- summary: 繁體中文摘要，4-6 句
- highlights: 繁體中文重點，Array of 3-5 key points
- url: Direct link

Return ONLY a JSON object in this format:
{"items": [{"title": "...", "source": "...", "date": "YYYY-MM-DD", "category": "...", "summary": "...", "highlights": [...], "url": "..."}]}

⚠️ 嚴格反幻覺規則（違反將導致整筆移除）：
1. 每則新聞的 title 必須與 URL 網頁上的實際標題一致，禁止自行改寫或翻譯標題
2. URL 必須從搜尋結果直接複製，禁止猜測或拼湊網址
3. 如果搜尋結果沒有提供直接連結，該筆新聞不要收錄
4. date 必須來自文章實際發佈日期，禁止猜測
5. 寧可少收 5 筆真實新聞，也不要多收 1 筆無法驗證的新聞
6. 不確定的項目標註 ⚠️待確認，但 URL 和 title 必須 100% 確定才能收錄

不足 20 筆如實回報。 ONLY valid JSON, NO markdown, NO preamble.
