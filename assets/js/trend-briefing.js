/* Research briefing view. All counts and copy are derived from published snapshots. */
const BRIEFING = {model:null, selected:null, expanded:false, pending:false};
function briefingExcerpt(value,limit=145) {
  const s = typeof value === 'string' ? value : '';
  return s.length>limit ? s.slice(0,limit)+'…' : s;
}
function briefingButton(topic,content,cls='') {
  return `<button class="${cls}" data-topic="${esc(topic.id)}">${content}</button>`;
}
function briefingChart(topic) {
  const points = topic.series.slice(-7), max = Math.max(1,...points.map(p=>p.count||0));
  return `<div class="tb-chart" role="img" aria-label="近七天新聞篇數；${esc(points.map(p=>p.date+':'+(p.count===null?'缺少觀測':p.count+'篇')).join('，'))}">${points.map(p=>
    `<div class="tb-day"><span class="tb-value">${p.count===null?'—':p.count}</span><div class="tb-track">${p.count===null?'<span class="tb-missing">缺日</span>':`<span class="tb-bar" style="height:${p.count/max*100}%"></span>`}</div><span>${esc(p.date.slice(5).replace('-','/'))}</span></div>`).join('')}</div>`;
}
function briefingDetail(topic) {
  return `<div class="tb-detail-head"><span class="tb-eyebrow">主題判讀</span><span class="tb-badge">${esc(topic.status)}</span></div>
    <h2 id="tb-detail-title" tabindex="-1">${esc(topic.label)}</h2><p class="tb-detail-lead">${esc(topic.headline)}</p>
    <h3>為什麼列入焦點</h3><p>近七天收錄 ${topic.count} 篇相關新聞，來自 ${topic.sources} 個來源網域。標題共同提及「${esc(topic.label)}」。</p>
    <h3>來源摘要</h3><p>${esc(briefingExcerpt(topic.meaning||topic.summary,240))||'來源未提供摘要，請閱讀原文。'}</p>
    <h3>近期收錄變化 <span>近 7 天 · 篇數</span></h3>${briefingChart(topic)}
    <p class="tb-fine">依新聞發布日計數；缺日以「—」標示。這是本站收錄量，不代表整體市場熱度。</p>
    <div class="tb-evidence-head"><h3>判讀依據</h3><span>${topic.articles.length} 篇 · 近 14 天可取得資料</span></div>
    <ul class="tb-sources">${topic.articles.map(a=>`<li><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.title)} <span aria-hidden="true">↗</span></a><span>${esc(a.source)} · ${esc(a.date)} · ${a.verified?'已通過網站驗證':'待確認'}</span></li>`).join('')}</ul>`;
}
function renderTrendBriefing() {
  const el = $('trend-briefing'); if (!el) return;
  const m = BRIEFING.model;
  const active = el.contains(document.activeElement) ? document.activeElement : null;
  const focused = active?.dataset?.topic, focusClass = active?.className;
  const retryFocused = active?.hasAttribute('data-retry');
  if (!m?.end) {
    el.innerHTML = `<div class="tb-empty" role="status"><h2>${BRIEFING.pending?'正在整理本期焦點':'暫時無法載入本期新聞'}</h2><p>${BRIEFING.pending?'正在讀取已發布的新聞與來源。':'新聞恢復後即可重新整理焦點主題。'}</p>${BRIEFING.pending?'':'<button data-retry class="tb-primary">重新載入</button>'}</div>`;
    return;
  }
  const all = [...m.topics,...m.past];
  const selected = all.find(t=>t.id===BRIEFING.selected)||m.topics[0]||m.past[0];
  const selectedId = selected?.id||null;
  const hero = m.topics[0];
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  el.innerHTML = `<div class="tb-heading"><div><p class="tb-eyebrow">AI INTELLIGENCE</p><h1>趨勢儀表板</h1><p>從每天的新聞，看見值得持續追蹤的變化。</p></div><div class="tb-date">資料截至 ${esc(m.end)}<br><span>焦點視窗 ${esc(m.start.slice(5))} — ${esc(m.end.slice(5))}</span></div></div>
    <div class="tb-notice" role="status"><span>${m.end<today?'資料尚未更新至今日。 ':''}${BRIEFING.pending?'正在補齊近期觀測…':`近 14 天取得 ${m.observed} 天觀測`} · 依新聞標題歸納，隨每日新聞更新。</span><button data-retry aria-label="重新整理趨勢資料">重新整理 ↻</button></div>
    ${hero?`<section class="tb-hero" aria-label="本期重點"><div class="tb-lead"><p class="tb-eyebrow">本期重點${hero.verified?'':' · 來源待確認'}</p><h2>${esc(hero.headline)}</h2><p>${esc(briefingExcerpt(hero.summary,155))}</p>${briefingButton(hero,'深入看這個主題 ↗','tb-primary')}</div><div class="tb-observations"><p class="tb-eyebrow">延伸觀察</p>${m.topics.slice(1,3).map(t=>briefingButton(t,`<strong>${esc(t.headline)}</strong><span>${esc(briefingExcerpt(t.summary,70))}</span>`,'tb-observation')).join('')||'<p class="tb-fine">目前沒有更多符合證據門檻的主題。</p>'}</div></section>`:'<div class="tb-empty"><h2>近期證據仍在累積</h2><p>每個焦點至少需要兩篇不同連結的新聞。目前不強行湊滿六題。</p></div>'}
    <div class="tb-workspace"><section aria-labelledby="tb-topics-title"><div class="tb-section-head"><h2 id="tb-topics-title">本期焦點主題</h2><span>隨時事更新 · 最多六項</span></div><div class="tb-topic-list">${m.topics.map((t,i)=>`<button class="tb-topic${t.id===selectedId?' is-selected':''}" data-topic="${esc(t.id)}" aria-pressed="${t.id===selectedId}" aria-controls="tb-detail"><span class="tb-rank">${String(i+1).padStart(2,'0')}</span><span class="tb-topic-copy"><strong>${esc(t.headline)}</strong><span>${esc(t.label)} · ${t.count} 篇 · ${t.sources} 個來源</span></span><span class="tb-tag">${esc(t.status)}</span></button>`).join('')||'<p class="tb-fine tb-pad">尚無符合門檻的焦點主題。</p>'}</div><p class="tb-fine tb-list-note">有足夠證據才列入；同一組關鍵詞持續追蹤。相關新聞可能重疊。</p></section><aside class="tb-detail" id="tb-detail" aria-labelledby="tb-detail-title">${selected?briefingDetail(selected):'<h2 id="tb-detail-title">等待更多觀測</h2><p>有可追蹤的主題後，這裡會顯示摘要、變化與來源。</p>'}</aside></div>
    <details class="tb-method" ${BRIEFING.expanded?'open':''}><summary>過往主題與觀測說明</summary><div><h3>近 14 天曾出現、近 7 天未再收錄</h3>${m.past.map(t=>briefingButton(t,`${esc(t.headline)} <span>最後收錄 ${esc(t.latest)}</span>`,'tb-past')).join('')||'<p>目前可取得的觀測中，沒有符合條件的過往主題。</p>'}<h3>這份簡報如何產生</h3><p>從本站已發布的論文與新聞標題找出共同關鍵詞，以不同連結篇數、來源網域數與時效排序，排除高度重疊的群組後最多呈現六題。標題與摘要取自群組內最近的來源；自動分組仍可能包含不同事件，請搭配原文判讀。</p><p>本頁固定呈現最新一期，不跟隨歷史新聞切換。使用最新資料與近 14 天可讀取的公開封存，不讀取私人回饋。相同關鍵詞組維持相同主題識別；同義詞、更名或拆分可能形成另一群組，不會冒接歷史。只有前後兩個七日視窗都完整，才標示「本窗新見／持續出現／收錄減少」。</p><p>缺少封存的日期不補零。篇數按文章發布日計算，同一連結去除追蹤參數後只計一次；不同媒體轉載仍可能各計一篇，來源網域數不等同獨立採訪數。摘要保留來源的待確認事項。</p></div></details>`;
  el.querySelector('.tb-method')?.addEventListener('toggle',e=>{BRIEFING.expanded=e.target.open;});
  if (focused) [...el.querySelectorAll('[data-topic]')].find(b=>b.dataset.topic===focused && b.className.replace(' is-selected','')===focusClass.replace(' is-selected',''))?.focus({preventScroll:true});
  if (retryFocused) el.querySelector('[data-retry]')?.focus({preventScroll:true});
}
function bindTrendBriefing() {
  $('trend-briefing').onclick = e => {
    if(e.target.closest('[data-retry]')) { loadDashboard(true); return; }
    const button = e.target.closest('[data-topic]'); if(!button) return;
    BRIEFING.selected = button.dataset.topic; renderTrendBriefing();
    if (window.matchMedia('(max-width: 800px)').matches || button.classList.contains('tb-primary') || button.classList.contains('tb-observation') || button.classList.contains('tb-past')) {
      $('tb-detail-title')?.focus({preventScroll:true});
      $('tb-detail')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
    }
  };
}
