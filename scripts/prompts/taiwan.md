Search the web for the latest AI news reported by Taiwan media sources published TODAY or YESTERDAY only.
目標是「台灣媒體在熱議的 AI 新聞」，不限新聞內容是否與台灣相關。

<!-- SEARCH_QUERIES:BEGIN -->
🔍 STEP 1 — 直接搜尋台灣媒體網站（7 條 query，控制在 turns 預算內）：
- site:ithome.com.tw AI agent OR "代理程式" OR "智能體" OR LangChain OR CrewAI OR AutoGen 2026
- site:ithome.com.tw OpenAI OR Anthropic OR Google OR Microsoft OR NVIDIA OR AWS OR Apple 2026
- site:ithome.com.tw LLM OR "大型語言模型" OR "資安" OR "安全漏洞" OR "新模型" 2026
- site:technews.tw AI agent OR LLM OR "資安" OR LangChain OR CrewAI OR OpenAI OR Anthropic 2026
- site:inside.com.tw OR site:digitimes.com.tw AI OR "人工智慧" 2026
- site:cna.com.tw "人工智慧" OR AI OR OpenAI OR Anthropic 2026
- 台灣 OR Taiwan AI 投資 OR 融資 OR 收購 OR 政策 OR 法規 OR 應用 OR 教育 OR 醫療 OR 製造 OR 金融 OR 半導體 2026

🔍 STEP 2 — 補充搜尋（若 STEP 1 不足 20 筆，視剩餘 turns 選擇）：
Media: 數位時代/SmartM, AI 郵報 (AI Post Hub), AI人工智慧網, 科技報橘, PanSci, AI Academy, 資策會 FIND/ITRI
Social: LinkedIn, Medium, PTT Tech_Job/Soft_Job, Dcard AI版, X 台灣 AI 工程師圈
Also search: "context engineering" OR "Google ADK" OR "OpenAI Agents" Taiwan 2026

Search in both 繁體中文 and English. Return summaries in 繁體中文.
<!-- SEARCH_QUERIES:END -->

<!-- PRIORITY:BEGIN -->
Priority ordering for the final 20-item list (MUST rank in this order):
1. 🥇 AI Agent / Agentic AI / Multi-agent 在台灣的發展、應用、平台、框架
2. 🥇 Agent Ecosystem & Frameworks — LangChain / LangGraph、CrewAI、OpenAI Agents SDK、Google ADK、Microsoft AutoGen / AGT、Semantic Kernel、LlamaIndex — 新版本、新功能、台灣社群討論
3. 🥇 AI Agent Engineering — Context Engineering（情境工程）、Harness Engineering（控制框架工程）、Agent 記憶管理、Agent 工具使用、Agent 工作流設計
4. 🥇 LLM 相關：新模型發布、重大更新、評測基準、台灣團隊/機構研發
5. 🥇 科技大廠新產品/新模型在台灣動態（OpenAI, Anthropic, Google, Meta, Microsoft, NVIDIA, Apple, AWS 等）
6. 🥈 AI 資安：漏洞、對抗攻擊、AI 安全事件（台灣或影響台灣）
7. 🥈 台灣 AI 產業重大動態 — 投資、融資、併購、政策、法規、產業應用案例（醫療、教育、製造、金融、半導體）
8. 🥉 其他台灣 AI 產業新聞（新創、人才、社群）
<!-- PRIORITY:END -->

⚠️ 語言規則：除了新聞標題、公司名、模型名、產品名、人名等專有名詞保留原文外，所有摘要和重點都必須是繁體中文。

⚠️ 日期硬規則：只收錄今天或昨天發布的新聞（date 欄位必須是今天或昨天的日期），超過 2 天的一律排除，不得收錄。筆數不足時如實回報，絕對不可收錄 2 天前的舊新聞。

Return up to 20 items. For each item, extract:
- title: 繁中標題
- source: 來源媒體
- date: YYYY-MM-DD
- topic: 主題分類（如：AI Agent, LLM發布, 資安, 技術趨勢, 產業應用）
- summary: 繁中摘要 (4-6句)
- relevance: 與台灣 AI 產業的相關性
- discussion: 社群討論熱度
- url: 原文連結

Return ONLY a JSON object in this format:
{"items": [{"title": "...", "source": "...", "date": "YYYY-MM-DD", "topic": "...", "summary": "...", "relevance": "...", "discussion": "...", "url": "..."}]}

⚠️ 嚴格反幻覺規則（違反將導致整筆移除）：
1. 每則新聞的 title 必須與 URL 網頁上的實際標題一致，禁止自行改寫或翻譯標題
2. URL 必須從搜尋結果直接複製，禁止猜測或拼湊網址
3. 如果搜尋結果沒有提供直接連結，該筆新聞不要收錄
4. date 必須來自文章實際發佈日期，禁止猜測
5. 寧可少收 5 筆真實新聞，也不要多收 1 筆無法驗證的新聞
6. 不確定的項目標註 ⚠️待確認，但 URL 和 title 必須 100% 確定才能收錄

不足 20 筆如實回報。 ONLY valid JSON, NO markdown, NO preamble.
