/* AI News Hub — dashboard.js  首頁儀表板：①時間軸 ②主題趨勢 ③重點整理
   classic script，共用全域作用域；載入順序須在 config.js 之後、main.js 之前。

   資料源與降級策略（全部缺檔即降級，不丟例外、不留空白）：
     ① 時間軸   熱層 data/index.json（近 8 天，含 stats 分類組成）
                + 冷層 archiveList()（Firestore，僅 item_count/pass_rate，無 stats）
     ② 主題趨勢 data/agent/trends.json（版控內，NewsCurator 叢集）
                + data/agent/trend-assessment.json（TrendAnalyst，選配）
                + data/agent/roadmap.json（TechRoadmap，選配）
     ③ 重點整理 data/agent/brief-latest.json（BriefWriter，選配）

   刻意不讀 data/agent/.preview/：那層被 .gitignore 擋掉，線上 GitHub Pages 抓不到，
   讀了只會讓線上永遠是空的。晉升到 data/agent/ 是人工動作（三份 manifest 的
   publish: manual_only）。 */

/* ======== 分類色票（與 SUBS/SEARCH_CATS 同色，但標籤不帶 emoji 供圖表圖例使用） ======== */
const DASH_CATS = [
  { key:'papers',     label:'論文',     color:'#6366f1' },
  { key:'topnews',    label:'全球熱門', color:'#f59e0b' },
  { key:'taiwan',     label:'台灣',     color:'#34d399' },
  { key:'china',      label:'中國',     color:'#f87171' },
  { key:'usa',        label:'美國',     color:'#60a5fa' },
  { key:'techtrends', label:'技術趨勢', color:'#a78bfa' },
  { key:'governance', label:'科技治理', color:'#f472b6' },
  { key:'tutorials',  label:'工具教學', color:'#fbbf24' },
  { key:'courses',    label:'課程證照', color:'#2dd4bf' },
  { key:'models',     label:'模型快訊', color:'#8b5cf6' },
];

/* 上游代理人的列舉值 → 中文。值域外的一律原樣顯示，不猜。 */
const DASH_STAGE = { emerging:'萌芽', accelerating:'加速', plateau:'高原', declining:'衰退' };
const DASH_STAGE_COLOR = { emerging:'#22d3ee', accelerating:'#34d399', plateau:'#fbbf24', declining:'#f87171' };
const DASH_TRAJ = { consolidating:'整併中', diverging:'發散中', accelerating:'加速中', stalling:'停滯中', unforecastable:'無法預測' };
const DASH_HORIZON = { near:'近程', mid:'中程', far:'遠程' };
const DASH_SYND = { organic:'真實擴散', mixed:'混合', syndicated:'轉載撐量' };
/* 信心三級必須與 newshub_brief.py 的 CONFIDENCE_ORDER 逐字一致（unverified /
   snippet_inference / verified）。舊版寫成 likely / speculative，那兩個值沒有任何
   產生者，而實際佔多數的 snippet_inference 反而落在值域外被印成英文原字。 */
const DASH_CONF = { verified:'已驗證', snippet_inference:'snippet 推論', unverified:'未能驗證' };
const DASH_CONF_COLOR = { verified:'#34d399', snippet_inference:'#fbbf24', unverified:'#f87171' };

const DASH = { loaded:false, days:[], trends:null, assessment:null, roadmap:null, brief:null };

/* ======== 取檔：任何失敗都回 null，讓上層走降級分支 ======== */
async function dashFetch(url) {
  try {
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'v=' + Date.now());
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function dashDayCount(e) {
  if (typeof e.item_count === 'number' && e.item_count > 0) return e.item_count;
  if (e.stats) return Object.values(e.stats).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
  return 0;
}
function dashPassRate(e) {
  const v = e.validation_pass_rate ?? e.pass_rate ?? e.validation?.pass_rate;
  return typeof v === 'number' ? v : null;
}
/* 連續日期軸：缺的那幾天要在圖上看得見，不能把它們擠掉當作沒發生過。 */
function dashDateRange(first, last) {
  const out = [];
  const d = new Date(first + 'T00:00:00Z'), end = new Date(last + 'T00:00:00Z');
  if (isNaN(d) || isNaN(end)) return out;
  let guard = 0;
  while (d <= end && guard++ < 1000) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
function dashMd(iso) { return iso ? iso.slice(5).replace('-', '/') : ''; }
function dashPct(n) { return (Math.round(n * 10) / 10).toFixed(1); }

/* ======== 主載入 ======== */
async function loadDashboard(force) {
  const el = $('panel-dashboard');
  if (!el) return;
  if (DASH.loaded && !force) return;
  el.innerHTML = '<div class="sk"><div class="sk-line h18 w40"></div><div class="sk-line w70"></div><div class="sk-line w40"></div></div>'.repeat(3);

  const [hot, trends, assessment, roadmap, brief] = await Promise.all([
    dashFetch('data/index.json'),
    dashFetch('data/agent/trends.json'),
    dashFetch('data/agent/trend-assessment.json'),
    dashFetch('data/agent/roadmap.json'),
    dashFetch('data/agent/brief-latest.json'),
  ]);

  // 冷層：未啟用 Firebase 或抓不到時回 []，自動退成只有熱層的 8 天。
  let cold = [];
  if (typeof archiveList === 'function') {
    try { cold = (await archiveList()) || []; } catch { cold = []; }
  }

  const byDate = {};
  cold.forEach(e => { if (e && e.date) byDate[e.date] = { ...e, _cold:true }; });
  (Array.isArray(hot) ? hot : []).forEach(e => { if (e && e.date) byDate[e.date] = { ...e, _cold:false }; });

  DASH.days = Object.values(byDate).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  DASH.trends = trends;
  DASH.assessment = assessment;
  DASH.roadmap = roadmap;
  DASH.brief = brief;
  DASH.loaded = true;

  el.innerHTML =
    dashKpis() +
    dashTimelineBlock() +
    dashTrendBlock() +
    dashBriefBlock();
}

/* ======== KPI 列 ======== */
function dashKpis() {
  const days = DASH.days;
  if (!days.length) return '';
  const first = days[0].date, last = days[days.length - 1].date;
  const span = dashDateRange(first, last).length;
  const covered = days.length;
  const counts = days.map(dashDayCount);
  const total = counts.reduce((a, b) => a + b, 0);
  const avg = covered ? Math.round(total / covered) : 0;
  const prs = days.map(dashPassRate).filter(v => v !== null);
  const pr = prs.length ? dashPct(prs.reduce((a, b) => a + b, 0) / prs.length) : null;
  const latest = days[days.length - 1];

  const cell = (color, ico, label, value, sub) => `
    <div class="dash-kpi">
      <div class="dk-top">${svg(ico, 13, color)}<span class="dk-label">${label}</span></div>
      <div class="dk-value" style="color:${color}">${value}</div>
      <div class="dk-sub">${sub}</div>
    </div>`;

  return `<div class="dash-kpis">
    ${cell('#818cf8','calendar','存檔涵蓋', covered + ' 天', `${first} → ${last}（區間 ${span} 天，覆蓋 ${dashPct(covered / span * 100)}%）`)}
    ${cell('#34d399','news','最新一日', dashDayCount(latest) + ' 筆', `${latest.date}${latest._cold ? '（冷封存）' : '（熱層）'}`)}
    ${cell('#fbbf24','chart','日均筆數', avg + ' 筆', `累計 ${total} 筆`)}
    ${cell('#f472b6','shield','平均驗證', pr === null ? '—' : pr + '%', prs.length ? `${prs.length} 天有驗證紀錄` : '無驗證紀錄')}
  </div>`;
}

/* ======== ① 時間軸 ======== */
function dashTimelineBlock() {
  const days = DASH.days;
  if (!days.length) {
    return dashSection('calendar', '#818cf8', '時間軸', '每日產出量與缺日',
      '<div class="empty">尚無存檔資料。熱層 data/index.json 與 Firestore 冷封存都讀不到。</div>');
  }

  const byDate = {};
  days.forEach(e => { byDate[e.date] = e; });
  const axis = dashDateRange(days[0].date, days[days.length - 1].date);
  const counts = axis.map(d => (byDate[d] ? dashDayCount(byDate[d]) : 0));
  const max = Math.max(1, ...counts);
  const missing = axis.filter(d => !byDate[d]);

  const W = 720, H = 150, PL = 30, PR = 8, PT = 12, PB = 22;
  const iw = W - PL - PR, ih = H - PT - PB;
  const slot = iw / axis.length;
  const bw = Math.max(1.5, Math.min(14, slot - 1.2));

  const bars = axis.map((d, i) => {
    const x = PL + slot * i + (slot - bw) / 2;
    const e = byDate[d];
    if (!e) {
      // 缺日：畫在基線上的細紅條。把它畫出來，是因為 46 個缺日是真的沒有資料，
      // 不是圖表偷懶——冷熱兩層都查過，那幾天永久遺失。
      return `<rect x="${x.toFixed(2)}" y="${(PT + ih - 3).toFixed(2)}" width="${bw.toFixed(2)}" height="3" rx="1" fill="#f87171" opacity="0.45"><title>${d}　無資料</title></rect>`;
    }
    const c = dashDayCount(e);
    const h = Math.max(2, (c / max) * ih);
    const y = PT + ih - h;
    const fill = e._cold ? '#a78bfa' : '#818cf8';
    const pr = dashPassRate(e);
    return `<rect class="dash-bar" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${bw.toFixed(2)}" height="${h.toFixed(2)}" rx="${Math.min(2, bw / 2).toFixed(1)}" fill="${fill}"><title>${d}　${c} 筆${pr === null ? '' : `　驗證 ${pr}%`}${e._cold ? '　(冷封存)' : ''}</title></rect>`;
  }).join('');

  const grid = [0, 0.5, 1].map(t => {
    const y = PT + ih - t * ih;
    return `<line x1="${PL}" x2="${W - PR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(148,163,184,0.10)" stroke-width="1"/>
            <text x="${PL - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#64748b">${Math.round(max * t)}</text>`;
  }).join('');

  const ticks = [0, Math.floor(axis.length / 2), axis.length - 1]
    .filter((v, i, a) => a.indexOf(v) === i)
    .map(i => `<text x="${(PL + slot * i + slot / 2).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : (i === axis.length - 1 ? 'end' : 'middle')}" font-size="9" fill="#64748b">${dashMd(axis[i])}</text>`)
    .join('');

  const legend = `<div class="dash-legend">
    <span class="dl-item"><i style="background:#818cf8"></i>熱層（repo）</span>
    <span class="dl-item"><i style="background:#a78bfa"></i>冷封存（Firestore）</span>
    <span class="dl-item"><i style="background:#f87171;opacity:.45"></i>缺日 ${missing.length} 天</span>
  </div>`;

  const chart = `<div class="dash-chart">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="每日新聞產出量時間軸">
      ${grid}${bars}${ticks}
    </svg>
  </div>${legend}`;

  return dashSection('calendar', '#818cf8', '時間軸', `${axis.length} 天區間、${days.length} 天有資料`,
    chart + dashStackedBlock());
}

/* 分類組成堆疊圖：只有熱層的 index.json 帶 stats，冷封存沒有這個欄位，
   所以這張圖的長度天然被熱層保留天數限制住（目前 8 天）。 */
function dashStackedBlock() {
  const withStats = DASH.days.filter(e => e.stats && Object.keys(e.stats).length);
  if (!withStats.length) {
    return `<div class="dash-note">分類組成需要 index.json 的 <code>stats</code> 欄位，冷封存不含此欄位，目前無可繪資料。</div>`;
  }
  const max = Math.max(1, ...withStats.map(e => DASH_CATS.reduce((a, c) => a + (e.stats[c.key] || 0), 0)));
  const rows = withStats.map(e => {
    const segs = DASH_CATS.map(c => {
      const v = e.stats[c.key] || 0;
      if (!v) return '';
      return `<span class="ds-seg" style="width:${(v / max * 100).toFixed(2)}%;background:${c.color}" title="${e.date}　${c.label} ${v} 筆"></span>`;
    }).join('');
    const tot = DASH_CATS.reduce((a, c) => a + (e.stats[c.key] || 0), 0);
    return `<div class="ds-row"><span class="ds-date">${dashMd(e.date)}</span><span class="ds-track">${segs}</span><span class="ds-tot">${tot}</span></div>`;
  }).join('');
  const legend = DASH_CATS.map(c => `<span class="dl-item"><i style="background:${c.color}"></i>${c.label}</span>`).join('');
  return `<div class="dash-sub-title">分類組成（近 ${withStats.length} 天）</div>
    <div class="dash-stack">${rows}</div>
    <div class="dash-legend">${legend}</div>`;
}

/* ======== ② 主題趨勢 ======== */
function dashTrendBlock() {
  const t = DASH.trends;
  if (!t || !Array.isArray(t.clusters) || !t.clusters.length) {
    return dashSection('chart', '#a78bfa', '主題趨勢', '尚未產出',
      `<div class="empty">找不到 <code>data/agent/trends.json</code>。<br>
       代理人輸出預設落在 <code>data/agent/.preview/</code>（被 .gitignore 擋住、不會上線），
       晉升到 <code>data/agent/</code> 是人工動作。</div>`);
  }

  const assess = {};
  (DASH.assessment?.assessments || []).forEach(a => { if (a.cluster_id) assess[a.cluster_id] = a; });
  const rmap = {};
  (DASH.roadmap?.roadmaps || []).forEach(r => { if (r.cluster_id) rmap[r.cluster_id] = r; });

  const srcDate = t.source_latest_date || '';
  const today = DATA?.date || new Date().toISOString().slice(0, 10);
  const staleDays = srcDate ? Math.round((new Date(today) - new Date(srcDate)) / 86400000) : null;
  const staleBadge = (staleDays !== null && staleDays > 1)
    ? badge('#fbbf24', `語料日 ${srcDate}，落後今日 ${staleDays} 天`)
    : badge('#34d399', `語料日 ${srcDate || '—'}`);

  const meta = `<div class="dash-meta">
    ${staleBadge}
    ${badge('#818cf8', `${t.clusters.length} 個叢集`)}
    ${t.mode ? badge('#64748b', `模式 ${esc(t.mode)}`) : ''}
    ${t.advisory ? badge('#a78bfa', '僅供參考，不進生產寫入') : ''}
    ${DASH.assessment ? badge('#34d399', '含階段判讀') : badge('#64748b', '無階段判讀')}
    ${DASH.roadmap ? badge('#34d399', '含路線預測') : badge('#64748b', '無路線預測')}
  </div>`;

  const maxScore = Math.max(...t.clusters.map(c => c.score || 0), 0.0001);
  const cards = t.clusters
    .slice()
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .map((c, i) => dashTrendCard(c, i + 1, maxScore, assess[c.cluster_id], rmap[c.cluster_id]))
    .join('');

  return dashSection('chart', '#a78bfa', '主題趨勢', `依綜合分數排序`, meta + cards);
}

function dashTrendCard(c, idx, maxScore, a, r) {
  const score = c.score || 0;
  const w = (score / maxScore * 100).toFixed(1);
  const stage = a?.stage;
  const stageColor = DASH_STAGE_COLOR[stage] || '#64748b';

  const breakdown = c.score_breakdown ? Object.entries(c.score_breakdown).map(([k, v]) => {
    const pv = typeof v === 'number' ? v : 0;
    return `<div class="dbd-row"><span class="dbd-k">${esc(k)}</span>
      <span class="dbd-track"><span class="dbd-fill" style="width:${(pv * 100).toFixed(1)}%;background:${pv >= 0.8 ? '#34d399' : (pv >= 0.5 ? '#fbbf24' : '#f87171')}"></span></span>
      <span class="dbd-v">${pv.toFixed(2)}</span></div>`;
  }).join('') : '';

  const cats = (c.categories || []).slice(0, 8).map(x => {
    const key = typeof x === 'string' ? x : (x.category || x.key || '');
    const cat = DASH_CATS.find(d => d.key === key);
    return cat ? badge(cat.color, cat.label) : badge('#64748b', esc(String(key)));
  }).join('');

  const scores = a?.scores ? Object.entries(a.scores).map(([k, v]) =>
    `<span class="da-metric">${esc(k)} <b>${typeof v === 'number' ? v.toFixed(2) : esc(String(v))}</b></span>`).join('') : '';

  const stageRow = a ? `<div class="dash-agent-row" style="border-color:${stageColor}22;background:${stageColor}0a">
      <div class="dar-head">${svg('flame', 12, stageColor)}<span style="color:${stageColor}">階段判讀：${DASH_STAGE[stage] || esc(String(stage || '—'))}</span>
        ${a.syndication_call ? badge('#64748b', DASH_SYND[a.syndication_call] || esc(String(a.syndication_call))) : ''}
        ${typeof a.confidence === 'number' ? badge('#818cf8', `信心 ${a.confidence.toFixed(2)}`) : ''}</div>
      ${a.headline_zh ? `<p class="dar-text">${esc(a.headline_zh)}</p>` : ''}
      ${scores ? `<div class="da-metrics">${scores}</div>` : ''}
    </div>` : '';

  const rmRow = r ? `<div class="dash-agent-row" style="border-color:#22d3ee22;background:#22d3ee0a">
      <div class="dar-head">${svg('rocket', 12, '#22d3ee')}<span style="color:#22d3ee">路線預測：${DASH_TRAJ[r.trajectory] || esc(String(r.trajectory || '—'))}</span>
        ${r.horizon ? badge('#64748b', DASH_HORIZON[r.horizon] || esc(String(r.horizon))) : ''}
        ${typeof r.confidence === 'number' ? badge('#818cf8', `信心 ${r.confidence.toFixed(2)}`) : ''}</div>
      ${r.next_milestone ? `<p class="dar-text"><b>下一個里程碑：</b>${esc(r.next_milestone)}</p>` : ''}
      ${r.falsifier ? `<p class="dar-text dar-dim"><b>可證偽條件：</b>${esc(r.falsifier)}</p>` : ''}
    </div>` : '';

  return `<div class="dash-trend">
    <div class="card-row">
      ${rank(idx, '#a78bfa')}
      <div class="card-body">
        <div class="dt-title">${esc(c.title || c.cluster_id || '')}</div>
        <div class="dt-score">
          <span class="dt-track"><span class="dt-fill" style="width:${w}%"></span></span>
          <span class="dt-num">${score.toFixed(2)}</span>
        </div>
        <div class="card-badges">
          ${badge('#818cf8', `證據 ${c.evidence_count || (c.evidence || []).length} 則`)}
          ${(c.sources && c.sources.length) ? badge('#64748b', `${c.sources.length} 個來源`) : ''}
          ${cats}
        </div>
        ${breakdown ? `<div class="dash-breakdown">${breakdown}</div>` : ''}
        ${c.why_now ? infoBlock('flame', '#f59e0b', '為何是現在', c.why_now) : ''}
        ${c.financial_implication ? infoBlock('building', '#34d399', '金融業意涵', c.financial_implication) : ''}
        ${stageRow}${rmRow}
      </div>
    </div>
  </div>`;
}

/* ======== ③ 重點整理 ======== */
function dashBriefBlock() {
  const b = DASH.brief;
  if (!b || !Array.isArray(b.highlights)) {
    return dashSection('file', '#34d399', '重點整理', '尚未產出',
      `<div class="empty">找不到 <code>data/agent/brief-latest.json</code>。<br>
       BriefWriter 的輸出落在 <code>data/agent/.preview/brief-latest.json</code>，
       晉升到 <code>data/agent/</code> 需人工核可（manifest 的 <code>publish: manual_only</code>）。</div>`);
  }
  if (!b.highlights.length) {
    // 「0 條是合法答案」——BriefWriter principles 第 2 條。這裡不能顯示成故障。
    return dashSection('file', '#34d399', '重點整理', '本輪 0 條',
      `<div class="empty">本輪沒有達到門檻的重點。<br>0 條是合法輸出，不是故障。
       ${b.omitted_note_zh ? '<br><br>' + esc(b.omitted_note_zh) : ''}</div>`);
  }

  const g = b.gate || {};
  // security_notice 恆為物件 {detected, scope, note_zh}，本身永遠 truthy。
  // 要看的是 detected，否則沒偵測到也會亮紅燈。舊契約的純字串形式一併相容。
  const sn = b.security_notice;
  const snOn = typeof sn === 'string' ? !!sn : !!(sn && sn.detected);
  const snText = typeof sn === 'string' ? sn : ((sn && sn.note_zh) || '偵測到疑似提示注入，內容已依閘門處置。');
  // source 只有 model / fail_open 兩個值，fail_open 是模型失敗後的降級放行，
  // 不能畫成跟正常產出同色的中性徽章。
  const srcOn = b.source === 'fail_open';

  const meta = `<div class="dash-meta">
    ${badge('#818cf8', `${b.highlights.length} 條重點`)}
    ${b.window_days ? badge('#64748b', `視窗 ${b.window_days} 天`) : ''}
    ${/* 不要讀 b.generated_at——newshub_brief.py 的 reconcile() 尾段只把
          duration_ms / attempts / model / session_id / note 複製進輸出，
          generated_at 停在輸入側的 meta，這顆 badge 永遠不會亮。*/''}
    ${b.model ? badge('#64748b', `模型 ${esc(String(b.model))}`) : ''}
    ${b.duration_ms ? badge('#64748b', `耗時 ${Math.round(b.duration_ms / 1000)} 秒`) : ''}
    ${srcOn ? badge('#f87171', '降級輸出（模型失敗）') : badge('#a78bfa', '模型產出')}
    ${g.dropped_dup ? badge('#fbbf24', `去重丟棄 ${g.dropped_dup}`) : ''}
    ${snOn ? badge('#f87171', '有安全註記') : ''}
  </div>`;

  const items = b.highlights.map((h, i) => {
    const conf = h.confidence || '';
    const cc = DASH_CONF_COLOR[conf] || '#64748b';
    return `<div class="dash-brief-item">
      <div class="card-row">
        ${rank(i + 1, '#34d399')}
        <div class="card-body">
          <div class="dt-title">${esc(h.headline_zh || '')}</div>
          ${h.body_zh ? `<p class="db-body">${esc(h.body_zh)}</p>` : ''}
          ${h.why_it_matters_zh ? infoBlock('alert', '#f59e0b', '為何重要', h.why_it_matters_zh) : ''}
          <div class="card-badges">
            ${badge(cc, `信心 ${DASH_CONF[conf] || esc(String(conf))}`)}
            ${(h.confidence_ceiling && h.confidence_ceiling !== conf) ? badge('#fbbf24', `封頂 ${DASH_CONF[h.confidence_ceiling] || esc(String(h.confidence_ceiling))}`) : ''}
            ${badge('#818cf8', `引用 ${(h.evidence_ids || []).length} 則證據`)}
            ${h.cluster_id ? badge('#64748b', esc(String(h.cluster_id))) : ''}
          </div>
          ${(h.gate_notes && h.gate_notes.length) ? `<div class="dash-note">閘門註記：${esc(h.gate_notes.join('；'))}</div>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  const tail = b.omitted_note_zh ? `<div class="dash-note">${esc(b.omitted_note_zh)}</div>` : '';
  const snScope = (sn && Array.isArray(sn.scope) && sn.scope.length)
    ? `（波及 ${esc(sn.scope.join('、'))}）` : '';
  const sec = snOn ? `<div class="dash-note dash-warn">安全註記：${esc(snText)}${snScope}</div>` : '';

  return dashSection('file', '#34d399', '重點整理', 'BriefWriter 每日精選', meta + items + tail + sec);
}

/* ======== 區塊外框 ======== */
function dashSection(ico, color, title, sub, body) {
  return `<section class="dash-sec">
    <div class="dash-sec-head">
      <div class="dsh-left">${svg(ico, 15, color)}<h3 class="dsh-title">${title}</h3></div>
      <span class="dsh-sub">${sub}</span>
    </div>
    ${body}
  </section>`;
}
