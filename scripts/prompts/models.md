Search the web for notable AI model releases from the past 3 months (approximately 90 days). Include models released anytime within this window, not just the past week. This is a CUMULATIVE list — include ALL significant models from the past 3 months, sorted by release_date newest first.

Priority topics (show first): models with strong Agent/agentic capabilities, LLM evaluation models, Judge models.

Search these sources for model releases: Papers with Code SOTA, Hugging Face, Latent Space, Import AI, The Gradient, Arxiv Sanity, AI company blogs, AI Feed, LMSYS, Open LLM Leaderboard, GitHub Trending

Focus on major model releases including: Large Language Models (LLMs), Vision models, Multimodal models, Open-source models, and Chinese models (DeepSeek, Qwen, Baichuan, GLM, Yi). Include all significant releases from the past 3 months, sorted by release_date newest first.

⚠️ 語言規則：model_name, version, institution, domain 等專有名詞保留原文。summary, advantages, highlights 都必須翻譯成繁體中文。benchmarks 數字保留原文。

Return up to 20 models maximum from the past 3 months. For each model, extract:
- model_name: Official name of the model
- version: Version number or release version
- institution: Company or organization that released the model
- release_date: Release date in YYYY-MM-DD format
- domain: Model domain (e.g., LLM, Vision, Multimodal, Audio, Robotics)
- summary: 繁體中文技術摘要，5-6 句，含模型規模、參數量、訓練資料、關鍵能力
- advantages: 繁體中文優勢，Array of 3-5 key advantages or improvements
- benchmarks: Array of benchmark results with specific numbers (e.g., "MMLU: 92.5%", "BLEU: 45.2")
- highlights: 繁體中文亮點，Array of 3-5 notable features or achievements
- url: Direct link to model card, blog post, or announcement

Return ONLY a JSON object in this format:
{"items": [{"model_name": "...", "version": "...", "institution": "...", "release_date": "YYYY-MM-DD", "domain": "...", "summary": "...", "advantages": [...], "benchmarks": [...], "highlights": [...], "url": "..."}]}

⚠️ 嚴格反幻覺規則（違反將導致整筆移除）：
1. 每則新聞的 title 必須與 URL 網頁上的實際標題一致，禁止自行改寫或翻譯標題
2. URL 必須從搜尋結果直接複製，禁止猜測或拼湊網址
3. 如果搜尋結果沒有提供直接連結，該筆新聞不要收錄
4. date 必須來自文章實際發佈日期，禁止猜測
5. 寧可少收 5 筆真實新聞，也不要多收 1 筆無法驗證的新聞
6. 不確定的項目標註 ⚠️待確認，但 URL 和 title 必須 100% 確定才能收錄

不足 20 筆如實回報。按 release_date 最新排序。 ONLY valid JSON, NO markdown, NO preamble.
