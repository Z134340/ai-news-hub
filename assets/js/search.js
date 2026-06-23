/* AI News Hub — search.js  全類別搜尋 */

function toggleSearch() {
  srchActive = !srchActive;
  const bar = $('srchBar');
  const btn = $('srchToggleBtn');
  bar.style.display = srchActive ? 'block' : 'none';
  btn.classList.toggle('on', srchActive);
  if(srchActive) {
    $('srchField').focus();
    updateStickyOffsets();
  } else {
    $('srchField').value = '';
    srchQuery = '';
    clearTimeout(srchTimer);
    exitSearchPanel();
    updateStickyOffsets();
  }
}
function exitSearchPanel() {
  document.querySelectorAll('.panel').forEach(p => {
    if(p.id==='panel-search') p.classList.remove('on');
    else p.classList.toggle('on', p.id==='panel-'+curSec);
  });
  $('subTabs').classList.toggle('vis', curSec==='news');
  updateTitle();
}
function onSrchInput(val) {
  clearTimeout(srchTimer);
  srchTimer = setTimeout(() => runSearch(val.trim()), 220);
}
function runSearch(q) {
  srchQuery = q;
  if(q.length < 2) { exitSearchPanel(); return; }
  const lower = q.toLowerCase();
  const results = [];
  SEARCH_CATS.forEach(({key,label,color}) => {
    (DATA?.data?.[key]||[]).forEach(item => {
      const haystack = [
        item.title, item.title_zh, item.summary, item.source, item.institution,
        item.company, item.topic, item.category, item.model_name, item.tool_name,
        item.provider, item.field, item.domain, item.model_area, item.venue,
        Array.isArray(item.authors)?item.authors.join(' '):(item.authors||''),
        ...(item.highlights||[]), ...(item.advantages||[]),
        ...(Array.isArray(item.topics)?item.topics:(item.topics?[item.topics]:[])),
      ].filter(Boolean).join(' ').toLowerCase();
      if(haystack.includes(lower)) results.push({item,label,color,key});
    });
  });
  // Show search panel
  document.querySelectorAll('.panel').forEach(p => {
    p.classList.toggle('on', p.id==='panel-search');
  });
  $('subTabs').classList.remove('vis');
  $('secTitle').textContent = '🔍 搜尋結果';
  $('secCount').textContent = `找到 ${results.length} 筆`;
  $('secUpdated').innerHTML = `關鍵字：${esc(q)}`;
  renderSearchResults(results, lower);
}
function hlText(html, q) {
  if(!q) return html;
  const esc_q = q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return html.replace(new RegExp(`(${esc_q})`, 'gi'), '<mark>$1</mark>');
}
function renderSearchResults(results, lower) {
  const el = $('panel-search');
  if(!results.length) {
    el.innerHTML = `<div class="empty">🔍 找不到相關結果，請換個關鍵字試試</div>`;
    return;
  }
  el.innerHTML = results.map(({item,label,color,key}) => {
    const id = itemKey(item);
    REGISTRY[id] = REGISTRY[id]||{cat:key, catLabel:label, catColor:color, item};
    const title = item.title||item.model_name||'未命名';
    const date = item.date||item.release_date||'';
    return `<div class="card" style="cursor:default">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span class="srch-cat" style="background:${color}18;color:${color};border:1px solid ${color}22">${label}</span>
        ${bmBtn(id)}
      </div>
      <div class="card-title" style="font-size:14px;margin-bottom:6px">${hlText(esc(title),lower)}</div>
      ${item.source||date?`<div style="font-size:11px;color:var(--tx3);margin-bottom:6px">${esc(item.source||'')}${item.source&&date?' · ':''}${esc(date)}</div>`:''}
      ${item.summary?`<p class="summary" style="font-size:13px;color:var(--tx2);line-height:1.8;margin-bottom:8px">${hlText(esc(item.summary),lower)}</p>`:''}
      ${item.url?`<a class="card-link" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${svg('ext',12)} 查看原文</a>`:''}
    </div>`;
  }).join('');
}
