/* AI News Hub — bookmarks.js  書籤邏輯（localStorage offline-first + 可選 Firebase 雲端同步） */

/* ======== BOOKMARK BUTTON ======== */
function bmBtn(id) {
  const saved = !!BOOKMARKS[id];
  return `<button class="bm-btn${saved?' bm-saved':''}" data-bmid="${id}" title="${saved?'移除書籤':'加入書籤'}" onclick="event.stopPropagation();toggleBookmark('${id}')">${svg('bookmark',14,saved?'#818cf8':'var(--tx3)')}</button>`;
}

/* ======== BOOKMARK FUNCTIONS ======== */
function loadBookmarks() {
  try { BOOKMARKS = JSON.parse(localStorage.getItem('ainews-bm')||'{}'); } catch { BOOKMARKS = {}; }
}
function saveBookmarks() {
  localStorage.setItem('ainews-bm', JSON.stringify(BOOKMARKS));
  updateBmTabCount();
  if (typeof syncBookmarksToCloud === 'function') syncBookmarksToCloud(); // 已登入則同步雲端，否則 no-op
}
function toggleBookmark(id) {
  if(BOOKMARKS[id]) {
    delete BOOKMARKS[id];
  } else {
    const r = REGISTRY[id];
    if(!r) return;
    BOOKMARKS[id] = {...r, savedAt: new Date().toISOString()};
  }
  saveBookmarks();
  // Update all visible bookmark buttons for this id
  document.querySelectorAll(`.bm-btn[data-bmid="${id}"]`).forEach(btn => {
    const saved = !!BOOKMARKS[id];
    btn.classList.toggle('bm-saved', saved);
    btn.title = saved ? '移除書籤' : '加入書籤';
    btn.innerHTML = svg('bookmark', 14, saved ? '#818cf8' : 'var(--tx3)');
  });
  if(curSec === 'bookmarks') renderBookmarks();
}
function updateBmTabCount() {
  const cnt = Object.keys(BOOKMARKS).length;
  const el = document.getElementById('bm-tab-cnt');
  if(el) { el.textContent = cnt > 0 ? cnt : ''; el.style.display = cnt > 0 ? 'inline-block' : 'none'; }
}
function renderBookmarks() {
  const el = $('panel-bookmarks');
  const entries = Object.entries(BOOKMARKS).sort((a,b)=>(b[1].savedAt||'').localeCompare(a[1].savedAt||''));
  $('secTitle').textContent = '🔖 我的書籤';
  $('secCount').textContent = entries.length ? `共 ${entries.length} 篇` : '';
  $('secUpdated').innerHTML = '';
  if(!entries.length) {
    el.innerHTML = `<div style="text-align:center;padding:60px 20px"><div style="font-size:36px;margin-bottom:12px">🔖</div><div style="font-size:15px;font-weight:600;margin-bottom:8px">還沒有書籤</div><div style="font-size:13px;color:var(--tx3)">點擊任一卡片右上角的 ${svg('bookmark',13,'var(--ac)')} 圖示即可收藏</div></div>`;
    return;
  }
  el.innerHTML = `<div class="bm-panel-hdr"><span style="font-size:13px;color:var(--tx3)">${entries.length} 篇已收藏</span><button class="bm-exp" onclick="exportBookmarks()">${svg('file',12)} 匯出 Markdown</button></div>` +
    entries.map(([id, bm]) => {
      const item = bm.item || {};
      const title = item.title || item.model_name || '未命名';
      const date = item.date || item.release_date || '';
      return `<div class="card" style="cursor:default">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span class="bm-cat" style="background:${bm.catColor}18;color:${bm.catColor};border:1px solid ${bm.catColor}22">${bm.catLabel}</span>
          <button class="bm-rm" onclick="removeBookmark('${id}')">✕ 移除</button>
        </div>
        <div class="card-title" style="font-size:14px;margin-bottom:6px">${esc(title)}</div>
        ${item.source?`<div style="font-size:11px;color:var(--tx3);margin-bottom:6px">${esc(item.source)}${date?' · '+esc(date):''}</div>`:''}
        ${item.summary?`<p class="summary" style="font-size:13px;color:var(--tx2);line-height:1.8;margin-bottom:8px">${esc(item.summary)}</p>`:''}
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">
          ${item.url?`<a class="card-link" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${svg('ext',12)} 查看原文</a>`:'<span></span>'}
          <span style="font-size:10px;color:var(--tx3)">收藏於 ${fmtCatTime(bm.savedAt)}</span>
        </div>
      </div>`;
    }).join('');
}
function removeBookmark(id) {
  delete BOOKMARKS[id];
  saveBookmarks();
  // Update bookmark buttons still visible on page
  document.querySelectorAll(`.bm-btn[data-bmid="${id}"]`).forEach(btn => {
    btn.classList.remove('bm-saved');
    btn.title = '加入書籤';
    btn.innerHTML = svg('bookmark', 14, 'var(--tx3)');
  });
  renderBookmarks();
}
function exportBookmarks() {
  const entries = Object.entries(BOOKMARKS).sort((a,b)=>(b[1].savedAt||'').localeCompare(a[1].savedAt||''));
  const bycat = {};
  entries.forEach(([id,bm]) => {
    const c = bm.catLabel||'其他';
    if(!bycat[c]) bycat[c]=[];
    bycat[c].push([id,bm]);
  });
  let md = `# AI News Hub 書籤匯出\n匯出時間：${new Date().toLocaleString('zh-TW')}\n共 ${entries.length} 篇\n\n`;
  Object.entries(bycat).forEach(([cat,list]) => {
    md += `## ${cat}\n\n`;
    list.forEach(([id,bm]) => {
      const item = bm.item||{};
      const title = item.title||item.model_name||'未命名';
      md += `### ${title}\n`;
      if(item.source) md += `**來源：** ${item.source}`;
      const d = item.date||item.release_date||'';
      if(d) md += `　**日期：** ${d}`;
      md += '\n\n';
      if(item.summary) md += `${item.summary}\n\n`;
      if(item.url) md += `🔗 [查看原文](${item.url})\n\n`;
      md += '---\n\n';
    });
  });
  const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([md],{type:'text/markdown;charset=utf-8'})),download:`ainews-bookmarks-${new Date().toISOString().slice(0,10)}.md`});
  a.click(); URL.revokeObjectURL(a.href);
}
