/* Dynamic topics from published news only. Pure, deterministic, no storage or model calls. */
const TrendTopics = (() => {
  const DAY = 86400000;
  const CATEGORIES = ['papers','topnews','taiwan','china','usa','techtrends','governance'];
  const STOP = new Set(('ai llm llms agent agents agentic the a an of to in on for and or with from by as is are how why what new more its at into this that can could will has have do does we our you your it not unveils announces launch launches release introduces using via first top says may say call calls back next help helps make makes get gets us about than against over after before still report reports beyond show shows turn turns build building now just much their his her who all up out at least billion million world news september october november december january february march april june july august today roundup weekly daily ' +
    '人工智慧 生成式 模型 大模型 智能 智能體 代理人 新聞 發布 推出 宣布 首個 首次 全新 最新 正式 如何 為何 什麼 我們 你們 透過 進行 以及 成為 打造 帶來 支援 開放 提供 企業 技術 應用 發展 全球 升級 系統 工具 能力 研究 顯示 報告 表示 指出 可能 已經 開始 今年 明年 最大 不再 一個 推動 實現 重要 全面 全國 中國 美國 台灣 呼籲 表達 強調 中心 資料 相關 問題 持續 下一步 公司 今天 大幅 大會 挑戰 時代 未來 加速 擴大').split(/\s+/));
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh-Hant',{granularity:'word'}) : null;
  const text = value => typeof value === 'string' ? value.trim() : '';
  function day(value) {
    const s = text(value).slice(0,10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s ? s : null;
  }
  const shift = (date,n) => new Date(Date.parse(date) + n*DAY).toISOString().slice(0,10);
  function canonicalURL(value) {
    try {
      if (typeof value !== 'string' || /[\s<>"']/.test(value)) return null;
      const u = new URL(value);
      if (!['https:','http:'].includes(u.protocol) || u.username || u.password) return null;
      u.hash = ''; for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(k)) u.searchParams.delete(k);
      u.searchParams.sort(); u.hostname = u.hostname.replace(/^www\./,'');
      u.pathname = u.pathname.replace(/\/$/,'') || '/';
      return u.href;
    } catch { return null; }
  }
  function terms(value) {
    const input = text(value).slice(0,500).normalize('NFKC');
    const words = segmenter ? [...segmenter.segment(input)].filter(x=>x.isWordLike).map(x=>x.segment) : (input.match(/[a-zA-Z][a-zA-Z0-9-]{1,30}/g)||[]);
    const result = new Map();
    for (const raw of words) {
      const key = raw.toLocaleLowerCase('en');
      if (raw.length < 2 || raw.length > 32 || STOP.has(raw.toLowerCase()) || STOP.has(key) || /^\d/.test(raw)) continue;
      result.set(key, raw);
    }
    return result;
  }
  function validSnapshot(s) { return s && day(s.date) === s.date && s.data && typeof s.data === 'object' && !Array.isArray(s.data); }
  function build(snapshots, end) {
    if (!end || day(end) !== end) return {end:null,topics:[],past:[],dates:[],observed:0,articleCount:0};
    const start = shift(end,-6), historyStart = shift(end,-13);
    const valid = snapshots.filter(validSnapshot).filter(s=>s.date>=historyStart&&s.date<=end).sort((a,b)=>b.date.localeCompare(a.date));
    const coverage = new Set(valid.map(s=>s.date));
    const articles = new Map();
    for (const snapshot of valid) for (const category of CATEGORIES) {
      for (const item of (Array.isArray(snapshot.data[category]) ? snapshot.data[category] : []).slice(0,250)) {
        if (!item || typeof item !== 'object') continue;
        const url = canonicalURL(item.url), date = day(item.date), title = text(item.title_zh)||text(item.title);
        if (!url || !date || date<historyStart || date>end || !title || articles.has(url)) continue;
        const tokens = terms(title);
        articles.set(url, {url,date,title,summary:text(item.summary),meaning:text(item.relevance)||text(item.impact),
          domain:new URL(url).hostname,source:text(item.source)||text(item.venue)||new URL(url).hostname,
          verified:item.verified===true, tokens});
      }
    }
    const sorted = [...articles.values()].sort((a,b)=>b.date.localeCompare(a.date)||a.url.localeCompare(b.url));
    const pairs = new Map();
    for (const article of sorted) {
      const keys = [...article.tokens.keys()].sort().slice(0,36);
      for (let i=0;i<keys.length;i++) for(let j=i+1;j<keys.length;j++) {
        const key = JSON.stringify([keys[i],keys[j]]);
        if (!pairs.has(key)) pairs.set(key,{key,terms:[keys[i],keys[j]],articles:[]});
        pairs.get(key).articles.push(article);
      }
    }
    const dates = Array.from({length:14},(_,i)=>shift(historyStart,i));
    const candidates = [];
    for (const p of pairs.values()) {
      const recent = p.articles.filter(a=>a.date>=start), previous = p.articles.filter(a=>a.date<start);
      if (p.articles.length<2) continue;
      const sources = new Set(recent.map(a=>a.domain)).size;
      const beforeComplete = dates.slice(0,7).every(d=>coverage.has(d));
      const nowComplete = dates.slice(7).every(d=>coverage.has(d));
      const status = beforeComplete && nowComplete ? (previous.length===0?'本窗新見':recent.length<previous.length?'收錄減少':'持續出現') : '近期焦點';
      const representative = recent[0]||p.articles[0];
      const labels = p.terms.map(k=>representative.tokens.get(k)||k);
      candidates.push({id:'topic:'+p.key,label:labels.join(' · '),terms:p.terms,articles:p.articles,recent,previous,
        verified:representative.verified,headline:representative.title,summary:representative.summary,meaning:representative.meaning,
        sources,count:recent.length,status,latest:representative.date,
        series:dates.map(date=>({date,count:coverage.has(date)?p.articles.filter(a=>a.date===date).length:null})),
        score:recent.length + sources*1.5 + (recent.some(a=>a.date>=shift(end,-1))?2:0)});
    }
    // Avoid six near-identical groups; topics can overlap, but majority overlap is redundant.
    const select = (list,limit) => {
      const result=[];
      const remaining = [...list];
      while (remaining.length) {
        const used = new Set(result.flatMap(x=>x.terms));
        remaining.sort((a,b)=>(b.score/(1+b.terms.filter(t=>used.has(t)).length*2))-(a.score/(1+a.terms.filter(t=>used.has(t)).length*2)) || a.id.localeCompare(b.id));
        const p = remaining.shift();
        const urls = new Set(p.articles.map(a=>a.url));
        if (result.some(x=>x.articles.filter(a=>urls.has(a.url)).length / Math.min(x.articles.length,p.articles.length) >= .65)) continue;
        result.push(p); if(result.length===limit) break;
      }
      return result;
    };
    candidates.sort((a,b)=>b.score-a.score || b.latest.localeCompare(a.latest) || a.id.localeCompare(b.id));
    const topics = select(candidates.filter(p=>p.count>=2),6);
    const past = select(candidates.filter(p=>p.count===0).sort((a,b)=>b.latest.localeCompare(a.latest)||a.id.localeCompare(b.id)),6);
    return {end,start,dates,topics,past,observed:dates.filter(d=>coverage.has(d)).length,
      articleCount:sorted.filter(a=>a.date>=start).length};
  }
  return {build,terms,day,shift,canonicalURL,validSnapshot};
})();
