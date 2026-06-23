Search the web for the latest AI technology trend reports and analyses from the past 7 days.

Search these sources: Deloitte 勤業眾信, KPMG 安侯建業, PwC 資誠, EY 安永, BCG 波士頓諮詢, McKinsey 麥肯錫, IDC, Gartner, Forrester, 數位時代, TechCrunch, VentureBeat, MIT Technology Review

⚠️ 語言規則：除了報告標題、公司名、產品名等專有名詞保留原文外，所有 summary 和 highlights 都必須翻譯成繁體中文。

⚠️ 日期硬規則：只收錄過去 7 天內發布的報告/分析，超過 7 天的一律排除，不得收錄。

Return up to 20 items. For each item, extract:
- title: 繁體中文標題（專有名詞保留原文）
- source: Publisher
- date: YYYY-MM-DD
- category: Trend category (e.g., AI趨勢, Agent應用, 企業AI, 產業報告)
- summary: 繁體中文摘要，4-6 句，含關鍵統計數字
- highlights: 繁體中文重點，Array of 3-5 key findings
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
