#!/usr/bin/env bash
# ============================================================
# setup-prompts.sh — 從 SKILL.md 規範自動產生 11 個 prompt 檔案
# 用法: bash scripts/setup-prompts.sh
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
PROMPTS_DIR="$SCRIPT_DIR/prompts"
SKILL_MD="$REPO_DIR/SKILL.md"

mkdir -p "$PROMPTS_DIR"

if [[ ! -f "$SKILL_MD" ]]; then
  echo "❌ 找不到 SKILL.md: $SKILL_MD"
  exit 1
fi

echo "📝 從 SKILL.md 產生 prompt 檔案 → $PROMPTS_DIR/"

# ── 共用尾行 ──
TAIL='所有 URL 必須從搜尋結果直接複製。所有數據來自原始出處。不確定標註⚠️待確認。不足指定筆數如實回報。ONLY valid JSON, NO markdown, NO preamble.'

# ── 1. papers ──
cat > "$PROMPTS_DIR/papers.md" << 'EOF'
Search the web for the latest AI research papers from the past 7 days, prioritizing papers from the last 24 hours.
Priority topics (show first): LLM-as-a-Judge, LLM evaluation, Agent evaluation, AI Agent, multi-agent systems, agentic frameworks.

Search sources: Google DeepMind, OpenAI, Google Research/Brain, Meta AI (FAIR), Stanford, MIT CSAIL, UC Berkeley BAIR, Microsoft Research, Tsinghua, CMU, Anthropic, Apple

Focus on papers from these major conferences and platforms:
- Conferences: NeurIPS, ICML, ICLR, CVPR, ICCV, ECCV, ACL, EMNLP, NAACL, SIGGRAPH, AAAI, IJCAI
- Platforms: arxiv.org, Papers with Code, Hugging Face Papers, Semantic Scholar

Return exactly 10 papers maximum. For each paper, extract:
- title: Full paper title
- authors: List of author names
- institution: Primary research institution
- venue: Conference or platform where published
- date: Publication date in YYYY-MM-DD format
- summary: 4-5 sentence technical abstract including specific numbers, metrics, or model sizes where available
- url: Direct link to paper
- field: Research field (e.g., LLM, Computer Vision, NLP, Multimodal, Robotics, Agent Evaluation, LLM-as-a-Judge)
- impact: Brief assessment of potential impact (high/medium/low)

Return ONLY a JSON object in this format:
{"items": [{"title": "...", "authors": [...], "institution": "...", "venue": "...", "date": "YYYY-MM-DD", "summary": "...", "url": "...", "field": "...", "impact": "..."}]}

所有 URL 必須從搜尋結果直接複製。所有數據來自原始出處。不確定標註⚠️待確認。不足 10 筆如實回報。ONLY valid JSON, NO markdown, NO preamble.
EOF

# ── 2. topnews ──
cat > "$PROMPTS_DIR/topnews.md" << 'EOF'
Search the web for the top 10 global AI news stories and announcements from today and recent days.
Priority topics (show first): LLM evaluation benchmarks, Agent evaluation, AI Agent launches, multi-agent systems.

Search these primary sources: TechCrunch, The Verge, VentureBeat, Wired, MIT Technology Review, Bloomberg, Reuters, Ars Technica, The Information, Hacker News, Latent Space, Import AI, The Gradient, Arxiv Sanity, AI company blogs, Hugging Face, Papers with Code, AI Feed

Focus on major AI announcements, product launches, research breakthroughs, funding, policy changes, and industry developments.

Return exactly 10 news items maximum. For each item, extract:
- title: Headline of the news story
- source: News publication or source name
- date: Publication date in YYYY-MM-DD format
- domain: Category (e.g., LLM, VisionAI, NLP, Policy, Funding, Hardware, Safety, Agent)
- model_area: Specific model or area mentioned (if applicable)
- summary: 4-6 sentence summary of the news with key details and context
- highlights: Array of 3-5 key bullet points or facts
- url: Direct link to the article

Return ONLY a JSON object in this format:
{"items": [{"title": "...", "source": "...", "date": "YYYY-MM-DD", "domain": "...", "model_area": "...", "summary": "...", "highlights": [...], "url": "..."}]}

所有 URL 必須從搜尋結果直接複製。所有數據來自原始出處。不確定標註⚠️待確認。不足 10 筆如實回報。ONLY valid JSON, NO markdown, NO preamble.
EOF

# ── 3. taiwan ──
cat > "$PROMPTS_DIR/taiwan.md" << 'EOF'
Search the web for the latest Taiwan AI news stories from the past 7 days.

Search these Taiwan media sources: 科技新報, iThome, 數位時代/SmartM, 中央社 CNA, DIGITIMES, INSIDE 硬塞的網路趨勢觀察, AI 郵報 (AI Post Hub), AI人工智慧網, 科技報橘, PanSci, AI Academy, 資策會 FIND/ITRI
Social: LinkedIn, Medium, YouTube(AI Reading Club/泛科學), PTT Tech_Job/Soft_Job, Dcard AI版, X 台灣 AI 工程師圈

Search in both 繁體中文 and English. Return summaries in 繁體中文.

Return up to 30 items. For each item, extract:
- title: 繁中標題
- source: 來源媒體
- date: YYYY-MM-DD
- topic: 主題分類
- summary: 繁中摘要 (4-6句)
- relevance: 與台灣 AI 產業的相關性
- discussion: 社群討論熱度
- url: 原文連結

Return ONLY a JSON object in this format:
{"items": [{"title": "...", "source": "...", "date": "YYYY-MM-DD", "topic": "...", "summary": "...", "relevance": "...", "discussion": "...", "url": "..."}]}

所有 URL 必須從搜尋結果直接複製。所有數據來自原始出處。不確定標註⚠️待確認。不足 30 筆如實回報。ONLY valid JSON, NO markdown, NO preamble.
EOF

# ── 4. china ──
cat > "$PROMPTS_DIR/china.md" << 'EOF'
Search the web for the latest China AI news stories from the past 7 days.

Search these sources: 机器之心, 量子位, 36氪, Baidu, Alibaba, Tencent, ByteDance, SenseTime, Huawei, DeepSeek, Moonshot, Baichuan, 01.AI, MiniMax, Zhipu, Tsinghua, Zhihu, MIIT/MOST

Search in both 简体中文 and English.

Return up to 20 items. For each item, extract:
- title: 標題
- source: 來源
- date: YYYY-MM-DD
- company: 相關公司
- topic: 主題分類
- summary: 摘要 (4-6句)
- discussion: 社群討論度
- url: 原文連結

Return ONLY a JSON object in this format:
{"items": [{"title": "...", "source": "...", "date": "YYYY-MM-DD", "company": "...", "topic": "...", "summary": "...", "discussion": "...", "url": "..."}]}

所有 URL 必須從搜尋結果直接複製。所有數據來自原始出處。不確定標註⚠️待確認。不足 20 筆如實回報。ONLY valid JSON, NO markdown, NO preamble.
EOF

# ── 5. usa ──
cat > "$PROMPTS_DIR/usa.md" << 'EOF'
Search the web for the latest US AI news stories from the past 7 days.
Priority topics (show first): LLM evaluation, Agent capabilities, multi-agent systems, AI Agent platforms.

Search these sources: OpenAI, Google/DeepMind, Anthropic, Meta, Microsoft, Apple, AWS, NVIDIA, xAI, Cohere, AI Business, AI Magazine, The Rundown AI, US AI policy (White House/Congress/FTC/NIST), Stanford HAI, MIT, X/Reddit/HN, VentureBeat, TechCrunch, The Information

Return up to 30 items. For each item, extract:
- title: Headline
- source: Publication
- date: YYYY-MM-DD
- topic: Category
- summary: 4-6 sentence summary
- highlights: Array of 3-5 key points
- discussion: Community reaction level
- url: Direct link

Return ONLY a JSON object in this format:
{"items": [{"title": "...", "source": "...", "date": "YYYY-MM-DD", "topic": "...", "summary": "...", "highlights": [...], "discussion": "...", "url": "..."}]}

所有 URL 必須從搜尋結果直接複製。所有數據來自原始出處。不確定標註⚠️待確認。不足 30 筆如實回報。ONLY valid JSON, NO markdown, NO preamble.
EOF

# ── 6. techtrends ──
cat > "$PROMPTS_DIR/techtrends.md" << 'EOF'
Search the web for the latest AI technology trend reports and analyses from the past 30 days.

Search these sources: Deloitte 勤業眾信, KPMG 安侯建業, PwC 資誠, EY 安永, BCG 波士頓諮詢, McKinsey 麥肯錫, IDC, Gartner, Forrester, 數位時代, TechCrunch, VentureBeat, MIT Technology Review

Return up to 20 items. For each item, extract:
- title: Report/article title
- source: Publisher
- date: YYYY-MM-DD
- category: Trend category (e.g., AI趨勢, Agent應用, 企業AI, 產業報告)
- summary: 4-6 sentence summary with key statistics
- highlights: Array of 3-5 key findings
- url: Direct link

Return ONLY a JSON object in this format:
{"items": [{"title": "...", "source": "...", "date": "YYYY-MM-DD", "category": "...", "summary": "...", "highlights": [...], "url": "..."}]}

所有 URL 必須從搜尋結果直接複製。所有數據來自原始出處。不確定標註⚠️待確認。不足 20 筆如實回報。ONLY valid JSON, NO markdown, NO preamble.
EOF

# ── 7. governance ──
cat > "$PROMPTS_DIR/governance.md" << 'EOF'
Search the web for the latest AI governance, regulation, and policy news from the past 14 days.

Search these sources: MIT Technology Review, OWASP, 台灣金融監督管理委員會 (FSC), 數位發展部 (moda.gov.tw), 國發會 (NDC), Reuters, Bloomberg, iThome, 中央社 CNA, 科技新報

Focus on: AI 治理, Agent/代理式 AI 治理, AI 安全標準, 金管會金融 AI 政策, 數位發展部政策, EU AI Act, NIST 指南

Search in both 繁體中文 and English.

Return up to 18 items. For each item, extract:
- title: Headline
- source: Publisher
- date: YYYY-MM-DD
- category: Policy area (e.g., AI治理, 金融監管, 資安標準, 隱私)
- summary: 4-6 sentence summary
- highlights: Array of 3-5 key points
- url: Direct link

Return ONLY a JSON object in this format:
{"items": [{"title": "...", "source": "...", "date": "YYYY-MM-DD", "category": "...", "summary": "...", "highlights": [...], "url": "..."}]}

所有 URL 必須從搜尋結果直接複製。所有數據來自原始出處。不確定標註⚠️待確認。不足 18 筆如實回報。ONLY valid JSON, NO markdown, NO preamble.
EOF

# ── 9. tutorials ──
cat > "$PROMPTS_DIR/tutorials.md" << 'EOF'
Search the web for the latest AI tool tutorials and practical guides from the past 14 days.

Search these sources: iThome, AI 郵報 (AI Post Hub), Medium, YouTube, 科技新報, 數位時代, INSIDE, OpenAI Blog, Anthropic Blog, Google AI Blog, Hugging Face Blog, LangChain Blog

Focus on: AI 工具實戰教學, Prompt 工程, LLM 應用開發, AI Agent 建構, RAG 實作, 微調指南

Return up to 10 items. For each item, extract:
- title: Tutorial title
- source: Publisher
- date: YYYY-MM-DD
- tool_name: Tool or framework covered
- difficulty: beginner / intermediate / advanced
- category: Tutorial category
- summary: 4-6 sentence summary
- highlights: Array of 3-5 key takeaways
- url: Direct link

Return ONLY a JSON object in this format:
{"items": [{"title": "...", "source": "...", "date": "YYYY-MM-DD", "tool_name": "...", "difficulty": "...", "category": "...", "summary": "...", "highlights": [...], "url": "..."}]}

所有 URL 必須從搜尋結果直接複製。所有數據來自原始出處。不確定標註⚠️待確認。不足 10 筆如實回報。ONLY valid JSON, NO markdown, NO preamble.
EOF

# ── 10. models ──
cat > "$PROMPTS_DIR/models.md" << 'EOF'
Search the web for notable AI model releases from the past 3 months (approximately 90 days). Include models released anytime within this window, not just the past week.
Priority topics (show first): models with strong Agent/agentic capabilities, LLM evaluation models, Judge models.

Search these sources for model releases: Papers with Code SOTA, Hugging Face, Latent Space, Import AI, The Gradient, Arxiv Sanity, AI company blogs, AI Feed, LMSYS, Open LLM Leaderboard, GitHub Trending

Focus on major model releases including: Large Language Models (LLMs), Vision models, Multimodal models, Open-source models, and Chinese models (DeepSeek, Qwen, Baichuan, GLM, Yi). Include all significant releases from the past 3 months, sorted by release_date newest first.

Return up to 15 models maximum from the past 3 months. For each model, extract:
- model_name: Official name of the model
- version: Version number or release version
- institution: Company or organization that released the model
- release_date: Release date in YYYY-MM-DD format
- domain: Model domain (e.g., LLM, Vision, Multimodal, Audio, Robotics)
- summary: 5-6 sentence technical summary including model size, parameter count, training data, and key capabilities
- advantages: Array of 3-5 key advantages or improvements
- benchmarks: Array of benchmark results with specific numbers (e.g., "MMLU: 92.5%", "BLEU: 45.2")
- highlights: Array of 3-5 notable features or achievements
- url: Direct link to model card, blog post, or announcement

Return ONLY a JSON object in this format:
{"items": [{"model_name": "...", "version": "...", "institution": "...", "release_date": "YYYY-MM-DD", "domain": "...", "summary": "...", "advantages": [...], "benchmarks": [...], "highlights": [...], "url": "..."}]}

所有 URL 必須從搜尋結果直接複製。所有數據來自原始出處。不確定標註⚠️待確認。不足 15 筆如實回報。按 release_date 最新排序。ONLY valid JSON, NO markdown, NO preamble.
EOF

# ── 完成 ──
echo ""
echo "✅ 已產生 $(ls "$PROMPTS_DIR"/*.md | wc -l | tr -d ' ') 個 prompt 檔案："
ls -1 "$PROMPTS_DIR"/*.md | while read f; do
  echo "   📄 $(basename "$f")"
done
echo ""
echo "完成！提示詞已依 SKILL.md 規範產生。"
