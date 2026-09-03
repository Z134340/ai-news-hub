Search the web for the latest China AI news stories published TODAY or YESTERDAY only.

<!-- SEARCH_QUERIES:BEGIN -->
🔍 STEP 1 — Search these queries FIRST (highest priority, must include if found):
- "AI Agent" OR "智能体" OR "多智能体" 中国 2026
- "Context Engineering" OR "上下文工程" OR "智能体工程" 中国 2026
- "Agent 编排" OR "Agent 记忆" OR "工具调用" OR "工作流" 大模型 2026
- LangChain OR LangGraph OR CrewAI 中国 OR 国内 2026
- "OpenAI Agents SDK" OR "Google ADK" OR AutoGen 中国 2026
- "Dify" OR "字节 Agent" OR "百度 Agent" OR "阿里 Agent" 2026
- DeepSeek OR Qwen OR GLM OR Baichuan OR Yi 新模型 OR 发布 2026
- "大模型" OR "LLM" 发布 OR 更新 中国 2026
- Baidu OR Alibaba OR Tencent OR ByteDance AI 新产品 OR 模型 2026
- "AI 安全" OR "AI 漏洞" OR "人工智能 资安" 中国 2026
- 中国 OR 中國 AI 投资 OR 融资 OR 收购 OR 政策 OR 监管 OR 应用 OR 医疗 OR 教育 OR 金融 OR 制造 2026
- site:jiqizhixin.com OR site:qbitai.com "Agent" OR "大模型" OR "Context Engineering" OR "LangChain" 2026

🔍 STEP 2 — Broaden search from:
机器之心, 量子位, 36氪, Baidu AI, Alibaba DAMO/Qwen, Tencent AI Lab, ByteDance, Huawei, SenseTime, DeepSeek, Moonshot, Baichuan, 01.AI, MiniMax, Zhipu AI, Tsinghua KEG, Zhihu AI, MIIT/MOST, Dify.AI

Search in both 简体中文 and English.
<!-- SEARCH_QUERIES:END -->

<!-- PRIORITY:BEGIN -->
Priority ordering for the final 20-item list (MUST rank in this order):
1. 🥇 AI Agent / Agentic AI / Multi-agent（智能體）— 新平台、框架、應用發布
2. 🥇 Agent Ecosystem & Frameworks — LangChain / LangGraph、CrewAI、OpenAI Agents SDK、Google ADK、Microsoft AutoGen / AGT、Dify、國內 Agent 框架 — 新版本、新功能、中國社群使用情況
3. 🥇 AI Agent Engineering — Context Engineering（上下文工程）、Agent 編排、Agent 記憶管理、工具調用模式、工作流設計
4. 🥇 中國 LLM 新模型發布（DeepSeek, Qwen, GLM, Baichuan, Yi, MiniMax 等）及評測
5. 🥇 科技大廠新產品/新模型（Baidu, Alibaba, Tencent, ByteDance, Huawei 等）
6. 🥈 AI 資安：漏洞、對抗攻擊、AI 安全事件
7. 🥈 中國 AI 產業重大動態 — 投資、融資、併購、政策、監管、產業應用案例（醫療、教育、金融、製造）
8. 🥉 其他中國 AI 動態（研究突破、人才流動、社群）
<!-- PRIORITY:END -->

⚠️ 語言規則：除了新聞標題、公司名、模型名、產品名、人名等專有名詞保留原文外，所有摘要 (summary) 和討論 (discussion) 都必須翻譯成繁體中文。

⚠️ 日期硬規則：只收錄今天或昨天發布的新聞（date 欄位必須是今天或昨天的日期），超過 2 天的一律排除，不得收錄。筆數不足時如實回報，絕對不可收錄 2 天前的舊新聞。

Return up to 20 items. For each item, extract:
- title: 繁體中文標題（原文為簡中請轉為繁中，專有名詞保留原文）
- source: 來源
- date: YYYY-MM-DD
- company: 相關公司
- topic: 主題分類（如：AI Agent, LLM發布, 資安, 產業應用, 政策）
- summary: 繁體中文摘要 (4-6句)
- discussion: 繁體中文社群討論度
- url: 原文連結

Return ONLY a JSON object in this format:
{"items": [{"title": "...", "source": "...", "date": "YYYY-MM-DD", "company": "...", "topic": "...", "summary": "...", "discussion": "...", "url": "..."}]}

⚠️ 嚴格反幻覺規則（違反將導致整筆移除）：
1. 每則新聞的 title 必須與 URL 網頁上的實際標題一致，禁止自行改寫或翻譯標題
2. URL 必須從搜尋結果直接複製，禁止猜測或拼湊網址
3. 如果搜尋結果沒有提供直接連結，該筆新聞不要收錄
4. date 必須來自文章實際發佈日期，禁止猜測
5. 寧可少收 5 筆真實新聞，也不要多收 1 筆無法驗證的新聞
6. 不確定的項目標註 ⚠️待確認，但 URL 和 title 必須 100% 確定才能收錄

不足 20 筆如實回報。 ONLY valid JSON, NO markdown, NO preamble.
