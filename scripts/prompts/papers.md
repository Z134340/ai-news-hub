Search the web for the latest AI research papers from the past 3 months, prioritizing papers from the last 7 days.

🔍 STEP 1 — Search these queries FIRST (highest priority, must include if found):
- site:arxiv.org "LLM-as-a-Judge" OR "LLM evaluation" OR "agent evaluation" OR "AgentBench" OR "SWE-bench" 2026
- site:arxiv.org "AI agent" OR "multi-agent" OR "context engineering" OR "agent memory" OR "tool use" 2026
- site:arxiv.org "LangChain" OR "LangGraph" OR "CrewAI" OR "AutoGen" OR "OpenAI Agents SDK" OR "Google ADK" 2026
- site:arxiv.org "harness engineering" OR "agent harness" OR "agent-as-a-judge" OR "adversarial agent" OR "agent red-teaming" OR "prompt injection" 2026
- site:arxiv.org "LLM benchmark" OR "model benchmark" 2026
- huggingface.co papers "agent" OR "context engineering" OR "LLM evaluation" 2026
- site:arxiv.org "Anthropic" OR "OpenAI" OR "Google DeepMind" OR "Meta AI" OR "Microsoft Research" 2026

🔍 STEP 2 — Also search from:
- Platforms: arxiv.org, Papers with Code, Hugging Face Papers, Semantic Scholar
- Institutions: Google DeepMind, OpenAI, Anthropic, Meta AI (FAIR), Stanford, MIT CSAIL, UC Berkeley BAIR, Microsoft Research, Tsinghua, CMU, Apple
- Conferences: NeurIPS, ICML, ICLR, CVPR, ACL, EMNLP, NAACL, AAAI, IJCAI

Priority ordering for the final list (MUST rank in this order):
1. 🥇 LLM-as-a-Judge, LLM evaluation methodology, evaluation frameworks
2. 🥇 Agent evaluation, AgentBench, agent benchmarks, agentic AI assessment
3. 🥇 AI Agent Engineering — context engineering, harness engineering, agent memory management, agent orchestration, agent workflow, tool use / function calling patterns
4. 🥇 Agent Ecosystem & Frameworks — LangChain, LangGraph, CrewAI, OpenAI Agents SDK, Google ADK, Microsoft AutoGen / AGT, Semantic Kernel, LlamaIndex, Haystack, Pydantic AI, AWS Bedrock Agents, Vertex AI Agents
5. 🥇 AI Agent research — new agent architectures, multi-agent systems, agentic frameworks
6. 🥈 LLM research — new models, training methods, RLHF/DPO/alignment
7. 🥉 Other AI research from top institutions (computer vision, multimodal, robotics)

⚠️ 語言規則：title, authors, institution, venue, field 等專有名詞保留原文。title_zh 提供繁體中文翻譯標題。summary 必須翻譯成繁體中文，impact 用繁體中文描述。

⚠️ 日期硬規則：只收錄過去 90 天內發布的論文，超過 90 天的一律排除，不得收錄。

Return up to 20 papers. For each paper, extract:
- title: Full paper title（保留原文英文標題，必須與 URL 頁面標題一致）
- title_zh: 繁體中文標題翻譯（專有名詞/模型名/機構名保留英文）
- authors: List of author names
- institution: Primary research institution
- venue: Conference or platform where published
- date: Publication date in YYYY-MM-DD format
- summary: 繁體中文技術摘要，4-5 句，含具體數字、指標或模型規模
- url: Direct link to paper
- field: Research field (e.g., LLM Evaluation, Agent Evaluation, LLM-as-a-Judge, AI Agent, Multi-Agent, LLM, Computer Vision, Multimodal)
- impact: 繁體中文影響力評估 (high/medium/low + 簡短說明)

Return ONLY a JSON object in this format:
{"items": [{"title": "...", "title_zh": "...", "authors": [...], "institution": "...", "venue": "...", "date": "YYYY-MM-DD", "summary": "...", "url": "...", "field": "...", "impact": "..."}]}

⚠️ 嚴格反幻覺規則（違反將導致整筆移除）：
1. 每則新聞的 title 必須與 URL 網頁上的實際標題一致，禁止自行改寫或翻譯標題
2. URL 必須從搜尋結果直接複製，禁止猜測或拼湊網址
3. 如果搜尋結果沒有提供直接連結，該筆新聞不要收錄
4. date 必須來自文章實際發佈日期，禁止猜測
5. 寧可少收 5 筆真實新聞，也不要多收 1 筆無法驗證的新聞
6. 不確定的項目標註 ⚠️待確認，但 URL 和 title 必須 100% 確定才能收錄

不足 20 筆如實回報。 ONLY valid JSON, NO markdown, NO preamble.
