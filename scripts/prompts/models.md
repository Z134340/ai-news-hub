Search the web for significant first-party AI model releases and major model updates published within the past 90 days. This is a cumulative list, sorted by release_date newest first.

Only accept a named model or major version released by its developer. Cover LLM, reasoning, multimodal, vision, audio, video, robotics, embedding and open-weight models from OpenAI, Anthropic, Google DeepMind, Meta AI, Microsoft, NVIDIA, Mistral AI, xAI, Cohere, Qwen, DeepSeek and Stability AI.
Use the exact approved company name from official-sources.json in the institution field.

<!-- PRIORITY:BEGIN -->
Prioritize releases with substantial Agent/agentic, tool-use, reasoning, multimodal or evaluation capabilities.
<!-- PRIORITY:END -->

<!-- SEARCH_QUERIES:BEGIN -->
Search only official company newsrooms, official model pages, official model cards, official system cards and official technical reports. Use the approved company list and domains in skills/official-ai-ecosystem-research/references/official-sources.json.
<!-- SEARCH_QUERIES:END -->

Classification boundary:
- Include a new named model, major version, or material capability update to an existing model.
- Exclude API-only settings, pricing, quota, regional availability, partnerships, and third-party cloud listings; those belong to official_info.
- A model card or system card published for the same launch is evidence for the same item, not a second item.

Return at most 20 items. For each item provide:
- model_name, version, institution, release_date (YYYY-MM-DD)
- source_title: exact official page title; display_title: Traditional Chinese display title
- release_status: preview / beta / ga / open_weight / research / updated / deprecated
- domain, modalities, summary (Traditional Chinese)
- advantages, capabilities, access_channels, highlights, limitations (Traditional Chinese arrays)
- context_window, pricing, license (officially published value or null)
- benchmarks: array of official self-reported results as concise strings; do not imply independent verification
- analysis: Traditional Chinese explanation of practical impact and affected users
- url: direct official announcement, model page, model card, system card, or technical report
- evidence_urls: other direct official evidence URLs; may be []

Return ONLY:
{"items":[{"source_title":"Exact official title","display_title":"繁體中文標題","model_name":"...","version":"...","institution":"...","release_date":"YYYY-MM-DD","release_status":"ga","domain":"Multimodal","modalities":["text","image"],"summary":"...","advantages":["..."],"capabilities":["..."],"access_channels":["..."],"context_window":null,"pricing":null,"license":null,"benchmarks":["...（官方自述）"],"highlights":["..."],"limitations":["..."],"analysis":"...","url":"https://official.example/release","evidence_urls":[]}]}

Strict evidence rules:
1. url and every evidence_urls entry must use an approved official domain and must be copied from search results, never guessed.
2. model_name, release_date, release_status, access, pricing, context window and benchmark numbers must be stated by the official source. Use null or omit an uncertain optional claim.
3. Never use media, aggregators, social posts, leaderboards, GitHub Trending, or unofficial repositories as the final source.
4. Do not include an announced-but-unreleased rumor. Preview and beta are allowed only when the official source explicitly names that status.
5. Prefer fewer verified releases over filling the quota. Preserve model names and version strings in their official language; write explanatory prose in Traditional Chinese.

ONLY valid JSON. NO markdown or preamble.
