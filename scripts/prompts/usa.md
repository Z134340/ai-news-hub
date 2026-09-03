Search the web for the latest US AI news stories published TODAY or YESTERDAY only.

<!-- SEARCH_QUERIES:BEGIN -->
🔍 STEP 1 — Search these queries FIRST (9 queries, stay within turns budget):
- "AI agent" OR "agentic AI" OR "multi-agent" launch OR release OR platform 2026
- LangChain OR LangGraph OR CrewAI OR "OpenAI Agents SDK" OR "Google ADK" new OR update 2026
- AutoGen OR "Semantic Kernel" OR LlamaIndex OR "context engineering" OR "harness engineering" 2026
- OpenAI new model OR product OR announcement 2026
- Anthropic OR "Google DeepMind" OR Meta OR Microsoft OR NVIDIA new AI model OR product 2026
- "LLM" OR "large language model" new release OR benchmark 2026
- "AI cybersecurity" OR "AI vulnerability" OR "AI jailbreak" 2026
- Apple OR AWS OR xAI OR Cohere new AI product OR model 2026
- US AI funding OR acquisition OR IPO OR policy OR regulation OR enterprise OR healthcare OR education OR research 2026

🔍 STEP 2 — Broaden search from (use remaining turns, pick highest-signal sources first):
OpenAI blog, Anthropic blog, Google DeepMind blog, Meta AI blog, Microsoft AI blog, AWS Machine Learning blog, NVIDIA developer blog, LangChain blog, CrewAI blog, Microsoft AutoGen GitHub releases, AI Business, AI Magazine, The Rundown AI, Latent Space, Import AI, US AI policy (White House/Congress/FTC/NIST), Stanford HAI, MIT, X/Reddit/HN, VentureBeat, TechCrunch, The Information, xAI, Cohere
<!-- SEARCH_QUERIES:END -->

<!-- PRIORITY:BEGIN -->
Priority ordering for the final 20-item list (MUST rank in this order):
1. 🥇 AI Agent / Agentic AI / Multi-agent — any new platform, framework, agent capability launch
2. 🥇 Agent Ecosystem & Frameworks — LangChain / LangGraph, CrewAI, OpenAI Agents SDK, Google ADK, Microsoft AutoGen / AGT, Semantic Kernel, LlamaIndex, Haystack, Pydantic AI, AWS Bedrock Agents, Vertex AI Agents — any new version, feature, integration
3. 🥇 AI Agent Engineering — context engineering, harness engineering, agent memory management, agent orchestration, agent tool use patterns, agent workflow design
4. 🥇 LLM new releases, major updates, evaluation benchmarks (model announcements from any US company)
5. 🥇 Tech giant new product/model releases (OpenAI, Anthropic, Google, Meta, Microsoft, NVIDIA, Apple, AWS, xAI)
6. 🥈 AI cybersecurity, vulnerabilities, adversarial attacks, AI safety incidents
7. 🥈 US AI industry — funding, M&A, IPO, policy, regulation, enterprise adoption, healthcare/education/research applications
8. 🥉 Other US AI industry news (talent, community, research)
<!-- PRIORITY:END -->

⚠️ 語言規則：除了新聞標題、公司名、模型名、產品名、人名等專有名詞保留原文外，所有摘要 (summary)、重點 (highlights)、討論 (discussion) 都必須翻譯成繁體中文。

⚠️ 日期硬規則：只收錄今天或昨天發布的新聞（date 欄位必須是今天或昨天的日期），超過 2 天的一律排除，不得收錄。筆數不足時如實回報，絕對不可收錄 2 天前的舊新聞。

Return up to 20 items. For each item, extract:
- title: 新聞標題（保留原文，必須與 URL 頁面實際標題一致，禁止改寫）
- title_zh: 繁體中文標題翻譯（若 title 為英文則必填；專有名詞/公司名/模型名保留英文）
- source: Publication
- date: YYYY-MM-DD
- topic: Category (e.g., AI Agent, LLM Release, Cybersecurity, Policy, Funding, Enterprise)
- summary: 繁體中文摘要，4-6 句
- highlights: 繁體中文重點，Array of 3-5 key points
- discussion: 繁體中文社群反應
- url: Direct link

Return ONLY a JSON object in this format:
{"items": [{"title": "...", "title_zh": "...", "source": "...", "date": "YYYY-MM-DD", "topic": "...", "summary": "...", "highlights": [...], "discussion": "...", "url": "..."}]}

⚠️ 嚴格反幻覺規則（違反將導致整筆移除）：
1. 每則新聞的 title 必須與 URL 網頁上的實際標題一致，禁止自行改寫或翻譯標題
2. URL 必須從搜尋結果直接複製，禁止猜測或拼湊網址
3. 如果搜尋結果沒有提供直接連結，該筆新聞不要收錄
4. date 必須來自文章實際發佈日期，禁止猜測
5. 寧可少收 5 筆真實新聞，也不要多收 1 筆無法驗證的新聞
6. 不確定的項目標註 ⚠️待確認，但 URL 和 title 必須 100% 確定才能收錄

不足 20 筆如實回報。 ONLY valid JSON, NO markdown, NO preamble.
