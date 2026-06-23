Search the web for the top 20 global AI news stories published TODAY or YESTERDAY only.

⚡ TURN BUDGET: You have at most 12 search turns total. Run ALL 6 STEP 1 searches first, then output JSON immediately. Do NOT run extra searches beyond STEP 2 cap.

🔍 STEP 1 — Run these 6 searches in order (all required):
1. "AI agent" OR "agentic AI" OR "multi-agent" OR "agent framework" launch OR release OR update 2026
2. LangChain OR LangGraph OR CrewAI OR "OpenAI Agents SDK" OR "Google ADK" OR AutoGen OR "context engineering" new OR update 2026
3. OpenAI OR Anthropic OR Gemini OR Claude new model OR product OR announcement 2026
4. Meta OR Microsoft OR NVIDIA OR Apple OR AWS new AI model OR product 2026
5. "AI cybersecurity" OR "AI vulnerability" OR "AI safety incident" 2026
6. AI funding OR acquisition OR IPO OR policy OR regulation OR enterprise OR healthcare OR education OR research breakthrough 2026

🔍 STEP 2 — At most 2 additional searches if turns remain:
Pick from: VentureBeat, TechCrunch, MIT Technology Review, Reuters, Bloomberg, Hacker News, Latent Space, Import AI

Priority for final list (rank in this order):
1. 🥇 AI Agent / Agentic / Multi-agent — launches, platforms, benchmarks
2. 🥇 Agent frameworks — LangChain/LangGraph, CrewAI, OpenAI Agents SDK, Google ADK, AutoGen, Semantic Kernel, LlamaIndex
3. 🥇 AI Agent Engineering — context engineering, harness engineering, agent memory, orchestration
4. 🥇 LLM new releases, major updates, benchmarks
5. 🥇 Tech giant new product/model (OpenAI, Anthropic, Google, Meta, Microsoft, NVIDIA, Apple, AWS, xAI)
6. 🥈 AI cybersecurity, vulnerabilities, safety incidents
7. 🥈 AI industry — funding, M&A, IPO, policy, enterprise adoption, healthcare/education/research applications
8. 🥉 Other AI industry news

⚠️ 語言規則：除標題、公司名、模型名、產品名、人名等專有名詞外，summary 和 highlights 均用繁體中文。

Return up to 20 items. Each item:
- title: 原文標題（必須與 URL 頁面實際標題一致，禁止改寫）
- title_zh: 繁體中文標題翻譯（英文標題必填）
- source: 來源媒體
- date: YYYY-MM-DD
- domain: 類別（Agent, LLM, Hardware, Policy, Safety, Cybersecurity 等）
- model_area: 涉及的模型或技術領域（若有）
- summary: 繁體中文摘要，3-4 句，含關鍵數據
- highlights: 繁體中文重點，2-3 個要點的陣列
- url: 直接連結

Return ONLY:
{"items": [{"title": "...", "title_zh": "...", "source": "...", "date": "YYYY-MM-DD", "domain": "...", "model_area": "...", "summary": "...", "highlights": [...], "url": "..."}]}

⚠️ 日期硬規則：只收錄今天或昨天發布的新聞（date 欄位必須是今天或昨天的日期），超過 2 天的一律排除，不得收錄。筆數不足時如實回報，絕對不可收錄 2 天前的舊新聞。
⚠️ 反幻覺規則：URL 必須來自搜尋結果、禁止猜測；title 必須與頁面一致；date 必須來自實際發佈日期；不確定就不收錄。寧可少收，不要捏造。
ONLY valid JSON. NO markdown. NO preamble.
