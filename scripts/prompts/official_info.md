Search the web for material first-party AI company and platform announcements published within the past 30 days. Sort by date newest first.

Cover OpenAI, Anthropic, Google DeepMind, Meta AI, Microsoft, NVIDIA, Mistral AI, xAI, Cohere, Qwen, DeepSeek, Stability AI, AWS, Google Cloud and Hugging Face. Use the approved company list and domains in skills/official-ai-ecosystem-research/references/official-sources.json.
Use the exact approved company name from official-sources.json in the company field.

<!-- PRIORITY:BEGIN -->
Prioritize product, API, pricing, partnership, availability, safety, policy, company and platform changes that materially affect AI users, developers or enterprises.
<!-- PRIORITY:END -->

<!-- SEARCH_QUERIES:BEGIN -->
Search only official company newsrooms, blogs, documentation, release notes and policy or safety pages. Use a direct dated page for every item.
<!-- SEARCH_QUERIES:END -->

Classification boundary:
- Include API changes, pricing, regional or platform availability, partnerships, investments, safety or policy updates, company announcements and cloud platform listings.
- Exclude a named new model or major model version; those belong to models.
- If several official pages describe one event, create one item and list the additional pages in evidence_urls.

Return at most 20 items. For each item provide:
- title: exact official page title; do not translate or rewrite
- company
- date: official publication date in YYYY-MM-DD
- event_type: product / api / pricing / partnership / availability / safety / policy / company / platform
- summary: 4-6 Traditional Chinese sentences stating what changed and the confirmed scope
- highlights: 3-5 concise Traditional Chinese points
- analysis: Traditional Chinese explanation of who is affected, practical impact and what to watch next; clearly separate inference from fact
- url: direct official article or documentation page
- evidence_urls: other direct official evidence URLs; may be []

Return ONLY:
{"items":[{"title":"Exact official title","company":"...","date":"YYYY-MM-DD","event_type":"api","summary":"...","highlights":["..."],"analysis":"...","url":"https://official.example/article","evidence_urls":[]}]}

Strict evidence rules:
1. url and every evidence_urls entry must use an approved official domain and must be copied from search results, never guessed.
2. title and date must match the official page. A timeless landing page or undated page is not a news item.
3. Never use media, aggregators, social posts or search snippets as the final source.
4. Prefer fewer verified items over filling the quota. Keep proper nouns in their official language and write explanatory prose in Traditional Chinese.

ONLY valid JSON. NO markdown or preamble.
