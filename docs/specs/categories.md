<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

## 十二大分類規範

### 1. 📄 AI 論文發表 (`papers`)
**機構（12）：** Google DeepMind, OpenAI, Google Research/Brain, Meta AI (FAIR), Stanford, MIT CSAIL, UC Berkeley BAIR, Microsoft Research, Tsinghua, CMU, Anthropic, Apple
**頂會（12）：** NeurIPS, ICML, ICLR, CVPR, ICCV, ECCV, ACL, EMNLP, NAACL, SIGGRAPH, AAAI, IJCAI
**平台：** arxiv.org, Papers with Code, Hugging Face Papers, Semantic Scholar
**優先主題（排序固定）：** 🥇 LLM-as-a-Judge / LLM 評估 → 🥇 Agent 評估 / AgentBench → 🥇 AI Agent Engineering（Context Engineering / Harness Engineering / Agent Memory / Orchestration）→ 🥇 AI Agent / Multi-agent 研究 → 🥈 LLM 新架構/訓練 → 🥉 其他頂尖論文
**搜尋策略：** 先用具體 arxiv Query 搜尋優先主題（含 context engineering、agent harness、agent workflow、tool use），再擴大搜尋其他論文
**欄位：** title, authors, institution, venue, date, summary(4-5句技術摘要含數字), url, field, impact

### 2. 🔥 全球熱門 AI 新聞 Top 20 (`topnews`)
**來源：** TechCrunch, The Verge, VentureBeat, Wired, MIT Tech Review, Bloomberg, Reuters, Ars Technica, The Information, Hacker News, Latent Space, Import AI, The Gradient, Arxiv Sanity, 各大 AI 公司 Blog, LangChain blog, CrewAI blog, Microsoft AutoGen GitHub, Hugging Face, Papers with Code, AI Feed
**優先主題（排序固定）：** 🥇 AI Agent/Agentic/Multi-agent → 🥇 Agent Ecosystem & Frameworks（LangChain/LangGraph, CrewAI, OpenAI Agents SDK, Google ADK, Microsoft AutoGen/AGT, Semantic Kernel, LlamaIndex, Haystack, Pydantic AI, AWS Bedrock Agents, Vertex AI Agents）→ 🥇 AI Agent Engineering（Context Engineering / Harness Engineering / Agent Orchestration / Agent Memory）→ 🥇 LLM 新模型發布 → 🥇 技術大廠新產品/模型 → 🥈 AI 資安 → 🥉 其他
**搜尋策略：** 先以具體 Query 搜尋優先主題（含各 Agent 框架名稱、context engineering、harness engineering），再擴大搜尋其他新聞
**欄位：** title, source, date, domain, model_area, summary(4-6句), highlights, url

### 3. 🇹🇼 台灣 AI 熱議 Top 20 (`taiwan`)
**媒體：** 科技新報, iThome, 數位時代/SmartM, 中央社 CNA, DIGITIMES, INSIDE 硬塞的網路趨勢觀察, AI 郵報 (AI Post Hub), AI人工智慧網, 科技報橘, PanSci, AI Academy, 資策會 FIND/ITRI
**社群：** LinkedIn, Medium, YouTube(AI Reading Club/泛科學), PTT Tech_Job/Soft_Job, Dcard AI版, X 台灣 AI 工程師圈
**語言：** 繁中+英文搜尋，繁中摘要
**優先主題（排序固定）：** 🥇 AI Agent/Agentic/Multi-agent 在台灣 → 🥇 Agent Ecosystem & Frameworks（LangChain/LangGraph, CrewAI, OpenAI Agents SDK, Google ADK, AutoGen/AGT）→ 🥇 AI Agent Engineering（Context Engineering / Harness Engineering）→ 🥇 LLM 模型發布/更新 → 🥇 技術大廠新產品/模型在台灣動態 → 🥈 AI 資安 → 🥉 其他台灣 AI 產業
**搜尋策略：** 先以具體中英文 Query 搜尋優先主題（含各 Agent 框架、context engineering、agent 工程），再擴大搜尋其他新聞
**欄位：** title(繁中), source, date, topic, summary(繁中), relevance, discussion, url

### 4. 🇨🇳 中國 AI 熱議 Top 20 (`china`)
**來源：** 机器之心, 量子位, 36氪, Baidu/Alibaba/Tencent/ByteDance, SenseTime, Huawei, DeepSeek, Moonshot, Baichuan, 01.AI, MiniMax, Zhipu, Tsinghua, Zhihu, MIIT/MOST, Dify.AI
**語言：** 簡中+英文
**優先主題（排序固定）：** 🥇 AI Agent/智能體/Multi-agent → 🥇 Agent Ecosystem & Frameworks（LangChain/LangGraph, CrewAI, OpenAI Agents SDK, Google ADK, AutoGen/AGT, Dify, 國內 Agent 框架）→ 🥇 AI Agent Engineering（Context Engineering / 上下文工程 / Agent 編排 / Agent 記憶管理）→ 🥇 中國 LLM 新模型（DeepSeek/Qwen/GLM/Baichuan/Yi 等） → 🥇 技術大廠新產品/模型 → 🥈 AI 資安 → 🥉 其他中國 AI 動態
**搜尋策略：** 先以具體中英文 Query 搜尋優先主題（含各 Agent 框架、context engineering、智能體工程），再擴大搜尋其他新聞
**欄位：** title, source, date, company, topic, summary, discussion, url

### 5. 🇺🇸 美國 AI 熱議 Top 20 (`usa`)
**來源：** OpenAI, Google/DeepMind, Anthropic, Meta, Microsoft, Apple, AWS, NVIDIA, xAI, Cohere, LangChain, CrewAI, AI Business, AI Magazine, The Rundown AI, US AI 政策(White House/Congress/FTC/NIST), Stanford HAI, MIT, X/Reddit/HN, VentureBeat, TechCrunch, The Information
**優先主題（排序固定）：** 🥇 AI Agent/Agentic/Multi-agent → 🥇 Agent Ecosystem & Frameworks（LangChain/LangGraph, CrewAI, OpenAI Agents SDK, Google ADK, Microsoft AutoGen/AGT, Semantic Kernel, LlamaIndex, Haystack, Pydantic AI, AWS Bedrock Agents, Vertex AI Agents）→ 🥇 AI Agent Engineering（Context Engineering / Harness Engineering / Agent Orchestration / Agent Memory）→ 🥇 LLM 新模型發布 → 🥇 技術大廠新產品/模型 → 🥈 AI 資安 → 🥉 其他美國 AI 動態
**搜尋策略：** 先以具體 Query 搜尋優先主題（各 Agent 框架 blog/GitHub + agent engineering + context engineering + LLM + 資安），再擴大搜尋
**欄位：** title, source, date, topic, summary, highlights, discussion, url

### 6. 📈 技術趨勢 Top 20 (`techtrends`)
**來源：** Deloitte 勤業眾信, KPMG 安侯建業, PwC 資誠, EY 安永, BCG 波士頓諮詢, McKinsey 麥肯錫, IDC, Gartner, Forrester, 數位時代, TechCrunch, VentureBeat, MIT Technology Review
**欄位：** title, source, date, category, summary(4-6句), highlights, url

### 7. ⚖️ 科技治理 Top 20 (`governance`)
**來源：** MIT Technology Review, OWASP, 台灣金融監督管理委員會 (FSC), 數位發展部 AI 專區 (https://moda.gov.tw/major-policies/ai/1781), 國發會 (NDC), Reuters, Bloomberg, iThome, 中央社 CNA, 科技新報
**數發部專區收錄方式：** 以 AI 專區為官方探索入口，追蹤 AI 風險分類、AI 應用影響評估、評測制度與治理政策。僅收錄具可核實發布日期、符合治理主題且在既有 7 天時窗內的政策／新聞原文，使用直接連結；常設專區及無日期資源不得當作當日新聞。此入口透過每日 WebSearch 提示使用，不是 RSS/Atom feed。
**焦點：** AI 治理, Agent/代理式 AI 治理, AI 安全標準, 金管會金融 AI 政策, 數位發展部政策, EU AI Act, NIST 指南
**語言：** 繁中+英文搜尋
**欄位：** title, source, date, category, summary(4-6句), highlights, url

### 8. 🛠️ AI 工具教學 Top 20 (`tutorials`)
**來源：** iThome, AI 郵報 (AI Post Hub), Medium, YouTube, 科技新報, 數位時代, INSIDE, OpenAI Blog, Anthropic Blog, Google AI Blog, Hugging Face Blog, LangChain Blog
**焦點：** AI 工具實戰教學, Prompt 工程, LLM 應用開發, AI Agent 建構, RAG 實作, 微調指南
**欄位：** title, source, date, tool_name, difficulty(beginner/intermediate/advanced), category, summary(4-6句), highlights, url

### 9. 🎓 AI 官方課程/證照 (`courses`)
**來源：** Coursera, edX, DeepLearning.AI, Google Cloud Skills Boost, Microsoft Learn, AWS Training, NVIDIA DLI, OpenAI, Anthropic, Meta AI, Stanford Online, MIT OCW, iThome, 科技新報
**焦點：** 免費官方 AI/LLM/Agent 課程, 專業 AI 證照, 大學 AI 課程
**欄位：** title, source, date, provider, is_free, cert_included, level, duration, topics, summary(4-6句), highlights, url

### 10. 🏢 企業官方資訊 (`official_info`)
**網站導覽：** 與 `models` 共同歸在主選單「企業生態系」；此分類顯示子分頁「官方資訊」。
**時間範圍：** 最近 30 天，每日擷取後與既有資料去重累積，最多保留 20 筆。
**來源：** 僅接受 `skills/official-ai-ecosystem-research/references/official-sources.json` 核准網域中的公司 newsroom、官方 blog、文件、release notes、政策或安全頁面。媒體、聚合站、搜尋摘要與社群貼文只能協助發現，不得成為最終 URL。
**收錄：** 產品、API、價格、合作、可用區域／平台、安全、政策、公司與平台動態。具名新模型或主要版本歸 `models`；同一事件多篇官方文件合為一筆，其他網址放 `evidence_urls`。
**欄位：** title(官方原文標題), company, date, event_type(product/api/pricing/partnership/availability/safety/policy/company/platform), summary, highlights, analysis, url, evidence_urls

### 11. 🚀 模型發布快訊 (`models`)
**網站導覽：** 主選單「企業生態系」的子分頁「模型快訊」；資料 key 仍為 `models`，避免破壞既有封存、書籤與前端相容性。
**時間範圍：** 最近 90 天，每日擷取後與既有資料去重累積，最多保留 20 筆。
**來源：** 僅接受模型開發公司的官方公告、模型頁、Model Card、System Card 或技術報告；核准公司與網域只在 `skills/official-ai-ecosystem-research/references/official-sources.json` 維護。排行榜、媒體、聚合站、GitHub Trending 與非官方 repository 不得作為最終 URL。
**收錄：** 具名新模型、主要版本或既有模型的實質能力更新。純 API 參數、定價、額度、地區上架、合作與第三方雲端平台上架歸 `official_info`。
**去重：** 優先以 canonical `url`，其次以 `(institution, model_name, version)`；同日 Model Card／System Card 是同一發布的證據，不另建一筆。
**欄位：** model_name, version, institution, release_date, release_status, domain, modalities, summary, advantages, capabilities, access_channels, context_window, pricing, license, benchmarks(標明官方自述), highlights, limitations, analysis, url, evidence_urls

### 12. ✨ 熱門 Agent Skills (`skills`)
**定位：** 跨工具 Agent Skills 專案人氣榜，涵蓋 Claude Code、Codex 與其他支援 Agent Skills 的工具。GitHub 星數屬專案層級，單一技能、技能包與官方技能包必須明確標示，不把同一 repo 的星數冒充個別 Skill 星數。
**來源：** GitHub REST API；候選白名單只在 `scripts/skills-repositories.json` 維護。初始來源包含 Superpowers、Matt Pocock Skills、Anthropic Skills、Ponytail、UI UX Pro Max、Addy Osmani Agent Skills、Archify、Marketing Skills、Humanizer、Obsidian Skills、Scientific Agent Skills、Diagram Design。
**納入門檻：** repo 內含 `SKILL.md`；明確支援至少兩種 agent client；非 archived／fork；近期仍有維護；網址與星數由 GitHub API 取得。聚合目錄、規格 repo、一般應用程式與已棄用 repo 不進主榜。
**排序：** 每日依 `stargazers_count` 由高至低，星數相同時依 repo 全名；API 任一來源失敗時整批不覆寫，沿用上一份成功資料。
**欄位：** title(repo full name), source, date(last push), summary, url, stars, forks, license, type, focus, tools, verified

---
