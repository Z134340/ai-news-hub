Search the web for official AI courses and certifications from the past 3 months (approximately 90 days). This is a CUMULATIVE list — include ALL significant courses from the past 3 months, sorted by date newest first.

Search these sources: Coursera, edX, DeepLearning.AI, Google Cloud Skills Boost, Microsoft Learn, AWS Training, NVIDIA DLI, OpenAI, Anthropic, Meta AI, Stanford Online, MIT OCW, iThome, 科技新報

Focus on: 免費官方 AI/LLM/Agent 課程, 專業 AI 證照, 大學 AI 課程, 新開設的 AI 相關課程與認證

⚠️ 語言規則：provider, topics 等專有名詞保留原文。title, summary, highlights 都必須翻譯成繁體中文。

Return up to 10 items from the past 3 months. For each item, extract:
- title: 繁體中文標題（專有名詞保留原文）
- source: Publisher / Platform
- date: YYYY-MM-DD (announcement or launch date)
- provider: Course provider (e.g., Google, DeepLearning.AI)
- is_free: true / false
- cert_included: true / false
- level: beginner / intermediate / advanced
- duration: Estimated duration (e.g., "4 weeks", "10 hours")
- topics: Array of topic tags
- summary: 繁體中文摘要，4-6 句
- highlights: 繁體中文重點，Array of 3-5 key takeaways
- url: Direct link

Return ONLY a JSON object in this format:
{"items": [{"title": "...", "source": "...", "date": "YYYY-MM-DD", "provider": "...", "is_free": true, "cert_included": false, "level": "...", "duration": "...", "topics": [...], "summary": "...", "highlights": [...], "url": "..."}]}

⚠️ 嚴格反幻覺規則（違反將導致整筆移除）：
1. 每則新聞的 title 必須與 URL 網頁上的實際標題一致，禁止自行改寫或翻譯標題
2. URL 必須從搜尋結果直接複製，禁止猜測或拼湊網址
3. 如果搜尋結果沒有提供直接連結，該筆新聞不要收錄
4. date 必須來自文章實際發佈日期，禁止猜測
5. 寧可少收 5 筆真實新聞，也不要多收 1 筆無法驗證的新聞
6. 不確定的項目標註 ⚠️待確認，但 URL 和 title 必須 100% 確定才能收錄

不足 10 筆如實回報。按 date 最新排序。 ONLY valid JSON, NO markdown, NO preamble.
