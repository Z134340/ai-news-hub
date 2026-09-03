/* AI News Hub — config.js
   常數、SVG icons、helpers、全域 state、Firebase config。
   所有檔案為 classic script，共用全域作用域，載入順序見 index.html。 */

/* ======== FIREBASE CONFIG (填入你的 Firebase 專案設定後啟用雲端同步) ======== */
/* 取得方式見 FIREBASE-SETUP.md。未填入前（保持 YOUR_API_KEY）網站照常運作，
   書籤僅存於本機 localStorage；填入真實 config 後自動啟用跨裝置雲端同步。 */
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyB9Z56fYHkDBGh-6pHRu5KgeLZFNFj2D8I",
  authDomain:        "ai-news-hub-33c51.firebaseapp.com",
  projectId:         "ai-news-hub-33c51",
  storageBucket:     "ai-news-hub-33c51.firebasestorage.app",
  messagingSenderId: "883782660919",
  appId:             "1:883782660919:web:4a80131ec4b69fbe34a0b2"
};

/* ======== SVG ICONS ======== */
const ICO = {
  check: '<polyline points="20 6 9 17 4 12"/>',
  ext: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M16 10h.01"/><path d="M8 10h.01"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  chart: '<line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/>',
  sparkles: '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>',
  tag: '<path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" x2="22" y1="12" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/>',
  news: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 1 1-4 0V9a2 2 0 0 1 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
};
function svg(name, size=14, color='currentColor') {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0">${ICO[name]||''}</svg>`;
}

/* ======== STATE ======== */
let DATA = null, HEALTH = null, DATA_LATEST = null, HIST_VIEWING = null;
let curSec = 'dashboard', curSub = 'topnews';
const openCards = {};
const REGISTRY = {}; // bmId → {cat, catLabel, catColor, item}
let BOOKMARKS = {};  // bmId → {cat, catLabel, catColor, item, savedAt}
let srchActive = false, srchQuery = '', srchTimer = null;
let updateTime = null, autoLock = false;  // data.js 自動更新偵測狀態（避免讀取未宣告變數丟 ReferenceError）

const $ = id => document.getElementById(id);
const esc = s => { if(!s)return''; const d=document.createElement('div'); d.textContent=s; return d.innerHTML; };

/* ======== SECTION / SUB CONFIG ======== */
const SECS = [
  { id:'dashboard', label:'儀表板', desc:'趨勢時間軸與重點', ico:'chart', grad:'linear-gradient(135deg,#22d3ee,#818cf8)' },
  { id:'papers', label:'論文研討', desc:'頂尖機構最新研究', ico:'file', grad:'linear-gradient(135deg,#6366f1,#818cf8)' },
  { id:'news', label:'AI 新聞', desc:'全球各區熱議焦點', ico:'news', grad:'linear-gradient(135deg,#f59e0b,#fbbf24)' },
  { id:'models', label:'模型快訊', desc:'最新模型與技術突破', ico:'rocket', grad:'linear-gradient(135deg,#8b5cf6,#a78bfa)' },
  { id:'bookmarks', label:'書籤', desc:'我的收藏文章', ico:'bookmark', grad:'linear-gradient(135deg,#818cf8,#a78bfa)' },
  { id:'history', label:'歷史紀錄', desc:'過往每日新聞存檔', ico:'calendar', grad:'linear-gradient(135deg,#64748b,#94a3b8)' },
];
const SUBS = [
  { id:'topnews', label:'全球熱門', ico:'flame', color:'#f59e0b' },
  { id:'taiwan', label:'台灣熱議', ico:'globe', color:'#34d399' },
  { id:'china', label:'中國熱議', ico:'globe', color:'#f87171' },
  { id:'usa', label:'美國熱議', ico:'globe', color:'#60a5fa' },
  { id:'techtrends', label:'技術趨勢', ico:'rocket', color:'#a78bfa' },

  { id:'governance', label:'科技治理', ico:'alert', color:'#f472b6' },
  { id:'tutorials', label:'AI工具教學', ico:'file', color:'#fbbf24' },
  { id:'courses', label:'AI官方課程/證照', ico:'check', color:'#34d399' },
];
const TITLES = { dashboard:'趨勢儀表板', papers:'📄 最新 AI 論文研討', topnews:'🔥 全球熱門 AI 新聞 Top 20', taiwan:'🇹🇼 台灣 AI 熱議 Top 30', china:'🇨🇳 中國 AI 熱議 Top 20', usa:'🇺🇸 美國 AI 熱議 Top 30', techtrends:'📈 技術趨勢 Top 20', governance:'⚖️ 科技治理 Top 18', tutorials:'🛠️ AI 工具教學 Top 10', courses:'🎓 AI 官方課程/證照', models:'🚀 最近模型發布快訊', history:'📅 歷史紀錄' };

/* ======== HELPERS ======== */
function badge(color, inner) { return `<span class="badge" style="background:${color}14;color:${color};border:1px solid ${color}22">${inner}</span>`; }
function rank(n, color) {
  const t3 = n<=3;
  return `<div class="rank ${t3?'top3':'dim'}" style="background:${t3?`linear-gradient(135deg,${color},${color}bb)`:`${color}18`};color:${t3?'#fff':color};${t3?`box-shadow:0 2px 8px ${color}40`:''}">${n}</div>`;
}
function linkOut(url, text='查看原文') { return url ? `<a class="card-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${svg('ext',12)} ${text}</a>` : ''; }
function infoBlock(ico, color, label, text) {
  if(!text) return '';
  const t = Array.isArray(text) ? text.join('；') : text;
  return `<div class="info-block" style="background:${color}0a;border:1px solid ${color}14"><div>${svg(ico,13,color)}</div><div><div class="ib-label" style="color:${color}">${label}</div><p class="ib-text">${esc(t)}</p></div></div>`;
}
function dayName(d){const n=new Date(d).getDay();return isNaN(n)?'':['週日','週一','週二','週三','週四','週五','週六'][n]}
function fmtDate(d){if(!d)return'';const dt=new Date(d);return `${dt.getFullYear()} 年 ${dt.getMonth()+1} 月 ${dt.getDate()} 日 ${dayName(d)}`}
function fmtTime(iso){if(!iso)return'';const d=new Date(iso),h=d.getHours(),m=String(d.getMinutes()).padStart(2,'0');return `${h>=12?'下午':'上午'}${h>12?h-12:h}:${m}`}

/* ======== ITEM KEY (stable bookmark id) ======== */
function itemKey(item) {
  const raw = item.url || (item.title||item.model_name||'') + '|' + (item.date||item.release_date||'');
  let h = 5381;
  for(let i=0;i<raw.length;i++) h = ((h<<5)+h+raw.charCodeAt(i))|0;
  return 'bm' + Math.abs(h).toString(36);
}

/* ======== NEWS LABELS ======== */
const NEWS_LABELS = {topnews:'🔥 全球新聞',taiwan:'🇹🇼 台灣',china:'🇨🇳 中國',usa:'🇺🇸 美國',techtrends:'📈 技術趨勢',governance:'⚖️ 科技治理',tutorials:'🛠️ 工具教學',courses:'🎓 課程'};

/* ======== SEARCH CATS ======== */
const SEARCH_CATS = [
  {key:'papers',    label:'📄 論文',   color:'#6366f1'},
  {key:'topnews',   label:'🔥 全球新聞', color:'#f59e0b'},
  {key:'taiwan',    label:'🇹🇼 台灣',   color:'#34d399'},
  {key:'china',     label:'🇨🇳 中國',   color:'#f87171'},
  {key:'usa',       label:'🇺🇸 美國',   color:'#60a5fa'},
  {key:'techtrends',label:'📈 技術趨勢', color:'#a78bfa'},
  {key:'governance',label:'⚖️ 科技治理', color:'#f472b6'},
  {key:'tutorials', label:'🛠️ 工具教學', color:'#fbbf24'},
  {key:'courses',   label:'🎓 課程',   color:'#34d399'},
  {key:'models',    label:'🚀 模型',   color:'#8b5cf6'},
];

/* ======== WEEKLY SET + fmtCatTime ======== */
const WEEKLY_SET = new Set(['models','tutorials','courses']);

/* ======== PRIORITY KEYWORDS（優先排序關鍵字，資料化；render.js 的 buildPriorityRegex 會編成 RegExp）========
   latin：英文詞，空白會自動轉成 [\s._-] 並加 \b 邊界；cjk：中文字面值（不加邊界）；cjkPatterns：保留原始 regex 片段。
   自動優化（change-evaluator）只允許對這三個陣列做 add-only 修改，不碰 render.js 程式碼。 */
const PRIORITY_KEYWORDS = {
  latin: [
    'llm as a judge','llm eval','model eval','agent eval','agentbench','swe bench',
    'ai agent','agentic','multi agent','context engineering','harness engineering','agent engineering',
    'agent memory','agent orchestration','agent workflow','agent harness','tool use','function calling',
    'langchain','langgraph','crewai','autogen','semantic kernel','llamaindex','llama index','haystack',
    'pydantic ai','dify','openai agents','google adk','microsoft agt','bedrock agents','vertex ai agents',
    'evaluation','benchmark','model release','product launch',
    'cybersecurity','infosec','vulnerability','zero day',
    'openai','anthropic','google deepmind','meta ai','microsoft','nvidia','apple intelligence','aws bedrock',
    'gemini','gpt','claude','llama','mistral','deepseek','qwen','baichuan','glm','cohere','xai','grok'
  ],
  cjk: [
    '資安','漏洞','資安事件','安全漏洞','模型發布','產品發布','新模型','新產品','評測','評估框架',
    '智能體','代理人','多智能體','大型語言模型','大模型','生成式AI','模型更新','模型升級',
    'LLM評估','LLM-as-a-Judge','Agent評估','Agent研究','代理式AI','情境工程','上下文工程',
    'Agent工程','Agent記憶','Agent編排','工具調用','Agent框架','Agent生態'
  ],
  cjkPatterns: ['Agent.*評','代理.*評']
};
function fmtCatTime(isoStr) {
  if(!isoStr) return '';
  try {
    const d = new Date(isoStr);
    if(isNaN(d.getTime())) return '';
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const hh = String(d.getHours()).padStart(2,'0');
    const mi = String(d.getMinutes()).padStart(2,'0');
    return `${mm}/${dd} ${hh}:${mi}`;
  } catch { return ''; }
}
