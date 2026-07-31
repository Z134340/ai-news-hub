/* AI News Hub — dashboard.js
   首頁儀表板。版面由上而下＝結論在前、佐證在後、維運墊底：
     A 名次遷移（近四個月，哪個主題正在爬升）  dashBumpBlock()
     B 主題矩陣（六叢集 × 90 天走勢 × 判讀）    dashMatrixBlock() → dashDrawer()
     C 主題趨勢卡（單輪叢集詳情）               dashTrendBlock()
     D 重點整理                                 dashBriefBlock()
     E 管線健康度（預設收合，維運才展開）        dashOpsBlock()

   資料源與降級策略（全部缺檔即降級，不丟例外、不留空白）：
     A/B  data/agent/timeline.json（TrendMetrics，118 天日曆軸 × 6 叢集）
          + data/agent/trend-assessment.json（TrendAnalyst，選配）
          + data/agent/roadmap.json（TechRoadmap，選配）
     C    data/agent/trends.json（版控內，NewsCurator 叢集）
     D    data/agent/brief-latest.json（BriefWriter，選配）
     E    熱層 data/index.json（近 8 天）
          + 冷層 archiveList()（Firestore，僅 item_count/pass_rate）

   刻意不讀 data/agent/.preview/：那層被 .gitignore 擋掉，線上 GitHub Pages 抓不到，
   讀了只會讓線上永遠是空的。晉升到 data/agent/ 是人工動作（四份 manifest 的
   publish: manual_only）——晉升前 A/B 兩區會顯示空狀態，那是正確行為不是故障。 */

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
/* 階段徽章的三重冗餘編碼：明度階（bg alpha）＋ 邊框線型 ＋ 圖示。
   灰化後 #22d3ee 與 #34d399 的 Rec.709 相對亮度是 0.687 對 0.679，幾乎同一階灰，
   色相因此絕對不能是唯一線索；能過 grayscale(1) 就能過色盲。 */
const DASH_STAGE_ENC = {
  emerging:     { ico:'sparkles', line:'solid',  a:'30' },
  accelerating: { ico:'rocket',   line:'double', a:'24' },
  plateau:      { ico:'chart',    line:'dashed', a:'18' },
  declining:    { ico:'alert',    line:'dotted', a:'0c' },
};
/* trajectory / horizon 的權威值域在 agents/tech-roadmap/ROADMAP_RUBRIC.md。
   舊版寫成 diverging / accelerating，那兩個值沒有任何產生者；而實際出現的
   capability_deepening、layer_shift、commoditizing 反而落在值域外被印成英文原字，
   horizon 也漏了 unforecastable 專用的 none。與 DASH_CONF 是同一種錯法。 */
const DASH_TRAJ = {
  layer_shift:'技術層位移', capability_deepening:'能力深化', commoditizing:'商品化',
  consolidating:'整併中', stalling:'停滯中', unforecastable:'無法預測',
};
const DASH_HORIZON = { near:'近程', mid:'中程', far:'遠程', none:'不適用' };
const DASH_SYND = { organic:'真實擴散', mixed:'混合', syndicated:'轉載撐量' };
/* 叢集標題在 timeline.json 裡是英文（上游 rubric 以英文定義叢集），中文介面照印會突兀。 */
const DASH_CLUSTER_ZH = {
  llm_evaluation_governance:  '評估、安全與治理',
  developer_tooling_rag:      '開發工具與 RAG',
  model_release_and_inference:'模型發布與推論',
  agent_engineering:          'Agent 工程',
  ai_security_and_privacy:    'AI 安全與隱私',
  ai_learning_and_enablement: '學習與人才養成',
};
/* 落地約束代碼表，與 curator/TECH_RUBRIC.md 的 blocker_candidates 逐字一致。
   roadmap.json 只給 B4 / B6 這種裸代碼，前端查表翻成白話，
   不動上游 prompt——換掉輸出契約的代價遠大於一張查表。 */
const DASH_BLOCKER = {
  B1:{ label:'算力',               desc:'需要的 GPU 規模是否超出自建機房可負擔範圍' },
  B2:{ label:'資料權',             desc:'訓練或檢索用資料的授權、個資法與著作權風險' },
  B3:{ label:'延遲',               desc:'是否滿足交易、風控、客服的即時性要求' },
  B4:{ label:'成本',               desc:'每次呼叫成本是否讓大量場景不成立' },
  B5:{ label:'可解釋性',           desc:'監理機關要求說明決策依據時能否交代' },
  B6:{ label:'資料落地與供應商鎖定', desc:'資料是否須留境內、換供應商的移轉成本' },
};
/* 六叢集在圖上的色票＋線型。線型是灰化後唯一還能分辨六條折線的線索。 */
const DASH_CLUSTER_STYLE = [
  { color:'#818cf8', dash:'' },
  { color:'#34d399', dash:'6 3' },
  { color:'#fbbf24', dash:'2 3' },
  { color:'#f472b6', dash:'10 3 2 3' },
  { color:'#22d3ee', dash:'1 4' },
  { color:'#f87171', dash:'8 4' },
];
/* 信心三級必須與 newshub_brief.py 的 CONFIDENCE_ORDER 逐字一致（unverified /
   snippet_inference / verified）。舊版寫成 likely / speculative，那兩個值沒有任何
   產生者，而實際佔多數的 snippet_inference 反而落在值域外被印成英文原字。 */
const DASH_CONF = { verified:'已驗證', snippet_inference:'snippet 推論', unverified:'未能驗證' };
const DASH_CONF_COLOR = { verified:'#34d399', snippet_inference:'#fbbf24', unverified:'#f87171' };

const DASH = {
  loaded:false, days:[], trends:null, assessment:null, roadmap:null, brief:null,
  timeline:null,
  bumpMode:'avg',   // 'avg' 日均 ／ 'sum' 月總。預設日均：四個月的觀測日數是 16/21/12/23，
                    // 直接比月總會把「那個月剛好多跑了幾天」讀成「那個主題在成長」。
};

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

  // 六個取檔互相獨立：任何一個 404 只讓它自己的區塊走空狀態，其餘照常渲染。
  const [hot, timeline, trends, assessment, roadmap, brief] = await Promise.all([
    dashFetch('data/index.json'),
    dashFetch('data/agent/timeline.json'),
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
  DASH.timeline = timeline;
  DASH.trends = trends;
  DASH.assessment = assessment;
  DASH.roadmap = roadmap;
  DASH.brief = brief;
  DASH.loaded = true;

  el.innerHTML =
    dashBumpBlock() +
    dashMatrixBlock() +
    dashTrendBlock() +
    dashBriefBlock() +
    dashOpsBlock();
}

/* ======== timeline.json 共用取值層 ========
   移動平均的定義與上游 trend_metrics 逐字相同：取序列尾端 n 個「日曆日」，
   丟掉缺口日的 null，對剩下的觀測值求平均。分母是觀測日數不是 n，
   所以缺口不會把平均稀釋掉。前端自己算得出來，不必要求上游多發一個欄位。 */
function dashMA(series, n) {
  if (!Array.isArray(series)) return null;
  const v = series.slice(-n).filter(x => typeof x === 'number');
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
/* 語料層自身的基準：全站 ma30/ma90。語料在這個視窗本身就縮了，
   不除掉這個共同因子，六個叢集會一起看起來像在退燒。 */
function dashCorpusBase() {
  const s = DASH.timeline?.totals?.series;
  const m30 = dashMA(s, 30), m90 = dashMA(s, 90);
  return (m30 !== null && m90) ? m30 / m90 : null;
}
function dashClusterZh(c) {
  return DASH_CLUSTER_ZH[c?.cluster_id] || c?.title || c?.cluster_id || '';
}
function dashAssessMap() {
  const m = {};
  (DASH.assessment?.assessments || []).forEach(a => { if (a.cluster_id) m[a.cluster_id] = a; });
  return m;
}
function dashRoadmapMap() {
  const m = {};
  (DASH.roadmap?.roadmaps || []).forEach(r => { if (r.cluster_id) m[r.cluster_id] = r; });
  return m;
}
/* timeline.json 缺席時 A/B 兩區的統一空狀態。晉升前線上必然走這條，
   所以文案要講清楚「檔案在哪、為什麼沒上線、誰能讓它上線」。 */
function dashNoTimeline(ico, color, title) {
  return dashSection(ico, color, title, '尚未晉升',
    `<div class="empty">找不到 <code>data/agent/timeline.json</code>。<br>
     TrendMetrics 的輸出落在 <code>data/agent/.preview/</code>（被 .gitignore 擋住、不會上線），
     晉升到 <code>data/agent/</code> 需人工核可（manifest 的 <code>publish: manual_only</code>）。</div>`);
}

/* ======== A 名次遷移（bump chart） ========
   問題是「這三個月哪個主題正在爬升」，答案是名次的相對變化，不是絕對量。
   絕對量在語料本身縮水 13% 的視窗裡會讓六個主題一起看起來在退燒。 */
function dashBumpBlock() {
  const tl = DASH.timeline;
  if (!tl || !Array.isArray(tl.clusters) || !tl.clusters.length || !tl.axis?.dates?.length) {
    return dashNoTimeline('trophy', '#fbbf24', '名次遷移');
  }
  const b = dashBumpData();
  if (!b || b.months.length < 2) {
    return dashSection('trophy', '#fbbf24', '名次遷移', '資料不足',
      '<div class="empty">可用月份不足兩個月，名次遷移沒有意義。</div>');
  }
  const sub = `${b.months[0].label} → ${b.months[b.months.length - 1].label}　${b.months.length} 個月桶`;
  return dashSection('trophy', '#fbbf24', '名次遷移', sub,
    `<div id="dashBumpBody">${dashBumpBody()}</div>`);
}

/* 月桶：以日曆月切 axis.dates，觀測日數以 axis.observed 為準（缺口日不算分母）。
   四個桶的觀測日數是 16 / 21 / 12 / 23，落差近兩倍——這就是預設看日均的理由。 */
function dashBumpData() {
  if (DASH._bump) return DASH._bump;
  const tl = DASH.timeline;
  const dates = tl.axis.dates || [], obs = tl.axis.observed || [];

  const order = [], byMonth = {};
  dates.forEach((d, i) => {
    const m = String(d).slice(0, 7);
    if (!byMonth[m]) { byMonth[m] = []; order.push(m); }
    byMonth[m].push(i);
  });
  const months = order.map(m => ({
    key: m,
    label: m.replace('-', '/'),
    idx: byMonth[m],
    obs: byMonth[m].filter(i => obs[i]).length,
  })).filter(m => m.obs > 0);

  const rows = tl.clusters.map((c, i) => {
    const s = c.series?.occurrences || [];
    const cells = months.map(m => {
      let sum = 0;
      m.idx.forEach(k => { const v = s[k]; if (typeof v === 'number') sum += v; });
      return { sum, obs: m.obs, avg: m.obs ? sum / m.obs : null };
    });
    return {
      cluster_id: c.cluster_id,
      title: dashClusterZh(c),
      style: DASH_CLUSTER_STYLE[i % DASH_CLUSTER_STYLE.length],
      cells,
      ranks: [],
    };
  });

  // 每個月各自排名。同一個月裡日均與月總只差一個共同分母（該月觀測日數），
  // 名次因此完全相同——切換模式只換讀數，不會換折線走向，這點要對使用者講明。
  months.forEach((m, j) => {
    rows.slice()
      .sort((a, b) => (b.cells[j].sum - a.cells[j].sum) || a.title.localeCompare(b.title))
      .forEach((r, k) => { r.ranks[j] = k + 1; });
  });

  DASH._bump = { months, rows };
  return DASH._bump;
}

function dashSetBump(m) {
  if (DASH.bumpMode === m) return;
  DASH.bumpMode = m;
  const n = $('dashBumpBody');
  if (n) n.innerHTML = dashBumpBody();   // 只換這一塊，不重畫整頁
}

function dashBumpBody() {
  const b = dashBumpData();
  const mode = DASH.bumpMode;
  const val = c => mode === 'avg'
    ? (c.avg === null ? '—' : (Math.round(c.avg * 10) / 10).toFixed(1))
    : String(c.sum);

  const N = b.months.length, R = b.rows.length;
  const PL = 30, PR = 196, PT = 40, PB = 20, RS = 30;
  const W = 760, ih = (R - 1) * RS, H = PT + ih + PB;
  const iw = W - PL - PR;
  const x = j => PL + (N > 1 ? iw * j / (N - 1) : iw / 2);
  const y = r => PT + (r - 1) * RS;

  const grid = b.rows.map((_, k) =>
    `<line x1="${PL}" x2="${W - PR + 4}" y1="${y(k + 1)}" y2="${y(k + 1)}" stroke="rgba(148,163,184,0.08)" stroke-width="1"/>
     <text x="${PL - 9}" y="${y(k + 1) + 3.5}" text-anchor="end" font-size="10" fill="#64748b">${k + 1}</text>`
  ).join('');

  const heads = b.months.map((m, j) =>
    `<text x="${x(j).toFixed(1)}" y="16" text-anchor="middle" font-size="11" fill="#94a3b8">${m.label}</text>
     <text x="${x(j).toFixed(1)}" y="28" text-anchor="middle" font-size="9" fill="#64748b">${m.obs} 觀測日</text>`
  ).join('');

  const lines = b.rows.map(r => {
    const pts = r.ranks.map((rk, j) => `${x(j).toFixed(1)},${y(rk)}`).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${r.style.color}" stroke-width="2.2"
              stroke-linecap="round" stroke-linejoin="round" opacity="0.85"
              ${r.style.dash ? `stroke-dasharray="${r.style.dash}"` : ''}/>`;
  }).join('');

  const nodes = b.rows.map(r => r.ranks.map((rk, j) => {
    const c = r.cells[j];
    const tip = `${r.title}　${b.months[j].label}　第 ${rk} 名　日均 ${c.avg === null ? '—' : (Math.round(c.avg * 10) / 10).toFixed(1)}　月總 ${c.sum}（${c.obs} 觀測日）`;
    return `<circle cx="${x(j).toFixed(1)}" cy="${y(rk)}" r="4.5" fill="${r.style.color}" stroke="#0d1117" stroke-width="1.5"><title>${esc(tip)}</title></circle>
            <text x="${x(j).toFixed(1)}" y="${y(rk) - 9}" text-anchor="middle" font-size="9.5" fill="#94a3b8">${val(c)}</text>`;
  }).join('')).join('');

  // Δ 名次＝首月名次 − 末月名次，正值代表往上爬。六個名次是同一組排列的置換，
  // 所有 Δ 相加恆為 0，可以拿來當這張圖的自我檢查。
  const labels = b.rows.map(r => {
    const lastRank = r.ranks[N - 1], d = r.ranks[0] - lastRank;
    const ly = y(lastRank);
    const tri = d === 0
      ? `<line x1="${W - PR + 8}" x2="${W - PR + 16}" y1="${ly}" y2="${ly}" stroke="#64748b" stroke-width="1.6"/>`
      : (d > 0
        ? `<path d="M${W - PR + 8} ${ly + 4} L${W - PR + 12} ${ly - 3} L${W - PR + 16} ${ly + 4} Z" fill="#34d399"/>`
        : `<path d="M${W - PR + 8} ${ly - 4} L${W - PR + 12} ${ly + 3} L${W - PR + 16} ${ly - 4} Z" fill="#f87171"/>`);
    return `${tri}
      <text x="${W - PR + 21}" y="${ly + 3.5}" font-size="10.5" fill="#e2e8f0">${esc(r.title)}</text>
      <text x="${W - 4}" y="${ly + 3.5}" text-anchor="end" font-size="10" fill="${d > 0 ? '#34d399' : (d < 0 ? '#f87171' : '#64748b')}">${d === 0 ? '持平' : (d > 0 ? '+' : '') + d}</text>`;
  }).join('');

  const toggle = `<div class="dash-toggle" role="group" aria-label="數值模式">
    <button type="button" class="${mode === 'avg' ? 'on' : ''}" onclick="dashSetBump('avg')">日均</button>
    <button type="button" class="${mode === 'sum' ? 'on' : ''}" onclick="dashSetBump('sum')">月總</button>
  </div>`;

  const note = `<div class="dash-note">
    月桶的觀測日數不相等（${b.months.map(m => `${m.label} ${m.obs} 天`).join('、')}），
    所以預設讀日均。切成月總只換節點上的讀數，名次與折線不會變——
    同一個月裡日均與月總只差一個共同分母。右側數字是首月到末月的名次變化，總和恆為 0。
  </div>`;

  return `${toggle}
    <div class="dash-scroll"><svg class="dash-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="六個主題近四個月的名次遷移">
      ${grid}${heads}${lines}${nodes}${labels}
    </svg></div>
    ${note}`;
}

/* ======== B 主題矩陣 ========
   一列一個叢集，把「走勢、階段、量能、相對語料、來源結構、轉載」壓在同一橫排，
   讓六個主題可以互相比較；細節全部收進抽屜，避免首屏被判讀文字灌爆。 */
function dashNum(v, d) { return typeof v === 'number' ? v.toFixed(d) : '—'; }
function dashSigned(v, d) { return typeof v === 'number' ? (v > 0 ? '+' : '') + v.toFixed(d) : '—'; }

/* 階段徽章：明度階 × 邊框線型 × 圖示 × 中文字，四重冗餘，任一條線索單獨都夠用。 */
function dashStageBadge(stage) {
  const color = DASH_STAGE_COLOR[stage] || '#64748b';
  const zh = DASH_STAGE[stage] || String(stage || '—');
  const enc = DASH_STAGE_ENC[stage];
  if (!enc) return `<span class="dm-stage" style="border-color:${color}55;background:${color}14;color:${color}">${esc(zh)}</span>`;
  return `<span class="dm-stage" style="border-style:${enc.line};border-width:${enc.line === 'double' ? '3px' : '2px'};border-color:${color}66;background:${color}${enc.a};color:${color}">${svg(enc.ico, 11, color)}${zh}</span>`;
}

/* 90 天走勢：缺口日在 timeline.json 裡是 null，折線必須斷開不可內插
   （axis.gap_warning 的原話）。斷開處鋪紅色網點底紋，明示「這裡沒有資料」，
   而不是讓人誤讀成「這裡是 0」。 */
function dashSpark(series, color) {
  const N = 90;
  const s = (Array.isArray(series) ? series : []).slice(-N);
  const nums = s.filter(v => typeof v === 'number');
  if (!nums.length) return '<span class="dm-dim">無資料</span>';
  const W = 150, H = 34, P = 3;
  const max = Math.max(1, ...nums);
  const X = i => P + (W - 2 * P) * (s.length > 1 ? i / (s.length - 1) : 0.5);
  const Y = v => H - P - (v / max) * (H - 2 * P);

  const segs = []; let cur = [];
  s.forEach((v, i) => {
    if (typeof v === 'number') cur.push([X(i), Y(v)]);
    else { if (cur.length) segs.push(cur); cur = []; }
  });
  if (cur.length) segs.push(cur);
  const line = segs.map(g => g.length === 1
    ? `<circle cx="${g[0][0].toFixed(1)}" cy="${g[0][1].toFixed(1)}" r="1.7" fill="${color}"/>`
    : `<polyline points="${g.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>`
  ).join('');

  const gaps = []; let g0 = -1;
  s.forEach((v, i) => {
    const miss = typeof v !== 'number';
    if (miss && g0 < 0) g0 = i;
    if (!miss && g0 >= 0) { gaps.push([g0, i - 1]); g0 = -1; }
  });
  if (g0 >= 0) gaps.push([g0, s.length - 1]);
  const band = gaps.map(([a, z]) => {
    const x0 = X(Math.max(0, a - 0.5)), x1 = X(Math.min(s.length - 1, z + 0.5));
    return `<rect x="${x0.toFixed(1)}" y="0" width="${Math.max(1, x1 - x0).toFixed(1)}" height="${H}" fill="url(#dashGap)"/>`;
  }).join('');

  return `<svg class="dm-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="近 90 天走勢，缺日不內插">${band}${line}</svg>`;
}

function dashClusterRatio(c) {
  const ma = c.moving_average || {};
  const m30 = typeof ma.ma30?.value === 'number' ? ma.ma30.value : dashMA(c.series?.occurrences, 30);
  const m90 = typeof ma.ma90?.value === 'number' ? ma.ma90.value : dashMA(c.series?.occurrences, 90);
  return (m30 !== null && m90) ? m30 / m90 : null;
}

function dashMatrixBlock() {
  const tl = DASH.timeline;
  if (!tl || !Array.isArray(tl.clusters) || !tl.clusters.length) {
    return dashNoTimeline('cpu', '#818cf8', '主題矩陣');
  }
  const assess = dashAssessMap();
  const base = dashCorpusBase();
  const w = tl.window || {};

  // W-7 相對語料基準：叢集的 ma30/ma90 再除以語料層的 ma30/ma90。
  // 語料本身在這個視窗縮了（base < 1），不除掉這個共同因子，
  // 六條線會一起看起來在退燒，實際上有主題是逆勢在漲。
  const rows = tl.clusters.map((c, i) => {
    const ratio = dashClusterRatio(c);
    return { c, a: assess[c.cluster_id], style: DASH_CLUSTER_STYLE[i % DASH_CLUSTER_STYLE.length],
             ratio, rel: (base && ratio !== null) ? ratio / base - 1 : null };
  }).sort((x, y) => (y.rel ?? -9) - (x.rel ?? -9));

  const head = `<div class="dm-row dm-head">
    <span>主題</span><span>近 90 天走勢</span><span>階段</span>
    <span class="dm-r">30 日均</span><span class="dm-r">相對語料</span>
    <span class="dm-r">等效來源</span><span class="dm-r">轉載率</span>
  </div>`;

  const body = rows.map(r => {
    const c = r.c, sc = c.source_concentration || {}, sy = c.syndication_evidence || {};
    const ma30 = c.moving_average?.ma30 || {};
    const relColor = r.rel === null ? '#64748b' : (r.rel > 0.02 ? '#34d399' : (r.rel < -0.02 ? '#f87171' : '#94a3b8'));
    const dup = typeof sy.duplicate_title_ratio === 'number' ? sy.duplicate_title_ratio : null;
    const dupColor = dup === null ? '#64748b' : (dup >= 0.5 ? '#f87171' : (dup >= 0.3 ? '#fbbf24' : '#94a3b8'));
    return `<button type="button" class="dm-row dm-click" onclick="dashOpenDrawer('${esc(c.cluster_id)}')" aria-label="展開 ${esc(dashClusterZh(c))} 的完整判讀">
      <span class="dm-name"><i class="dm-dot" style="background:${r.style.color}"></i>
        <b>${esc(dashClusterZh(c))}</b><em>${esc(c.cluster_id)}</em></span>
      <span class="dm-sparkwrap">${dashSpark(c.series?.occurrences, r.style.color)}</span>
      <span class="dm-stagewrap">${dashStageBadge(r.a?.stage)}</span>
      <span class="dm-r dm-num"><i class="dm-lab">30 日均</i>${dashNum(ma30.value, 1)}<em>${ma30.sufficient === false ? '樣本不足' : `${ma30.observed_days ?? '—'} 觀測日`}</em></span>
      <span class="dm-r dm-num" style="color:${relColor}"><i class="dm-lab">相對語料</i><b>${r.rel === null ? '—' : dashSigned(r.rel * 100, 1) + '%'}</b><em>對語料基準</em></span>
      <span class="dm-r dm-num"><i class="dm-lab">等效來源</i>${dashNum(sc.effective_sources, 1)}<em>共 ${sc.distinct_sources ?? '—'} 家</em></span>
      <span class="dm-r dm-num" style="color:${dupColor}"><i class="dm-lab">轉載率</i>${dup === null ? '—' : dashPct(dup * 100) + '%'}<em>重覆標題</em></span>
    </button>`;
  }).join('');

  const meta = `<div class="dash-meta">
    ${badge('#818cf8', `${w.observed_days ?? '—'} / ${w.calendar_days ?? '—'} 觀測日`)}
    ${badge('#fbbf24', `連續性 ${dashNum(w.continuity, 4)}`)}
    ${badge('#f87171', `缺 ${(w.missing_dates || []).length} 天`)}
    ${base ? badge('#64748b', `語料基準 ${base.toFixed(4)}`) : ''}
    ${tl.mode ? badge('#64748b', `模式 ${esc(String(tl.mode))}`) : ''}
    ${tl.advisory ? badge('#a78bfa', '僅供參考，不進生產寫入') : ''}
  </div>`;

  const note = `<div class="dash-note">
    「相對語料」＝該主題的 30 日均 ÷ 90 日均，再除以全站語料的同一比值
    （${base ? base.toFixed(4) : '—'}）。語料層自己在這個視窗就縮了
    ${base ? dashPct((1 - base) * 100) + '%' : ''}，只看絕對斜率會把六個主題一起讀成退燒。
    ${tl.totals?.exclusive === false ? '一則新聞可同時命中多個叢集，六個主題的量不可相加、不可畫成百分比堆疊。' : ''}
    點任一列展開完整判讀。
  </div>`;

  const defs = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <pattern id="dashGap" width="4" height="4" patternUnits="userSpaceOnUse">
      <rect width="4" height="4" fill="rgba(248,113,113,0.045)"/>
      <circle cx="1" cy="1" r="0.75" fill="rgba(248,113,113,0.42)"/>
    </pattern></defs></svg>`;

  return dashSection('cpu', '#818cf8', '主題矩陣', `${rows.length} 個叢集 × 90 天`,
    meta + defs + `<div class="dash-matrix">${head}${body}</div>` + note);
}

/* ======== B-抽屜：單一叢集的完整判讀 ========
   直接掛在 document.body、沿用既有 .ov 遮罩，index.html 不必改。 */
function dashOpenDrawer(cid) {
  const c = (DASH.timeline?.clusters || []).find(x => x.cluster_id === cid);
  if (!c) return;
  let ov = $('dashOv'), dw = $('dashDrawer');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'dashOv'; ov.className = 'ov';
    ov.addEventListener('click', dashCloseDrawer);
    document.body.appendChild(ov);
  }
  if (!dw) {
    dw = document.createElement('div');
    dw.id = 'dashDrawer'; dw.className = 'dash-drawer';
    dw.setAttribute('role', 'dialog'); dw.setAttribute('aria-modal', 'true');
    document.body.appendChild(dw);
  }
  dw.innerHTML = dashDrawerBody(c);
  ov.style.display = 'block';
  dw.classList.add('open');
  dw.scrollTop = 0;
  document.addEventListener('keydown', dashDrawerKey);
}
function dashDrawerKey(e) { if (e.key === 'Escape') dashCloseDrawer(); }
function dashCloseDrawer() {
  const ov = $('dashOv'), dw = $('dashDrawer');
  if (ov) ov.style.display = 'none';
  if (dw) dw.classList.remove('open');
  document.removeEventListener('keydown', dashDrawerKey);
}

function dwCard(ico, color, title, body) {
  return `<div class="dw-card">
    <div class="dw-card-head">${svg(ico, 13, color)}<span style="color:${color}">${title}</span></div>
    ${body}
  </div>`;
}
function dwKv(k, v, sub) {
  return `<div class="dw-kv"><span class="dw-k">${k}</span><span class="dw-v">${v}${sub ? `<em>${sub}</em>` : ''}</span></div>`;
}
/* sufficient=false 是上游明講「這個數字樣本不夠、別當結論用」，不能默默照印。 */
function dwSuff(o) { return o && o.sufficient === false ? badge('#fbbf24', '樣本不足') : ''; }

function dashDrawerBody(c) {
  const a = dashAssessMap()[c.cluster_id];
  const r = dashRoadmapMap()[c.cluster_id];
  const ma = c.moving_average || {}, sl = c.slope || {}, dl = c.delta || {};
  const sc = c.source_concentration || {}, sy = c.syndication_evidence || {}, tt = c.totals || {};
  const base = dashCorpusBase(), ratio = dashClusterRatio(c);
  const rel = (base && ratio !== null) ? ratio / base - 1 : null;

  const head = `<div class="dw-head">
    <div>
      <div class="dw-title">${esc(dashClusterZh(c))}</div>
      <div class="dw-sub">${esc(c.title || '')}　·　<code>${esc(c.cluster_id)}</code></div>
    </div>
    <button type="button" class="dw-x" onclick="dashCloseDrawer()" aria-label="關閉">✕</button>
  </div>`;

  /* ① 階段判讀 */
  const c1 = dwCard('flame', '#fbbf24', '階段判讀', a ? `
    <div class="dw-badges">${dashStageBadge(a.stage)}
      ${a.syndication_call ? badge('#64748b', DASH_SYND[a.syndication_call] || esc(String(a.syndication_call))) : ''}
      ${typeof a.confidence === 'number' ? badge('#818cf8', `信心 ${a.confidence.toFixed(2)}`) : ''}
      ${a.security_flag ? badge('#f87171', '安全旗標') : ''}</div>
    ${a.headline_zh ? `<p class="dw-p">${esc(a.headline_zh)}</p>` : ''}
    ${a.scores ? `<div class="da-metrics">${Object.entries(a.scores).map(([k, v]) =>
      `<span class="da-metric">${esc(k)} <b>${typeof v === 'number' ? v.toFixed(2) : esc(String(v))}</b></span>`).join('')}</div>` : ''}
    ${(a.rationale || []).length ? `<ul class="dw-ul">${a.rationale.map(x => `<li>${esc(String(x))}</li>`).join('')}</ul>` : ''}
    ${(a.rubric_hits || []).length ? `<div class="dw-tags">${a.rubric_hits.map(x => badge('#64748b', esc(String(x)))).join('')}</div>` : ''}
    ${(a.gate_notes || []).length ? `<div class="dash-note">閘門註記：${esc(a.gate_notes.join('；'))}</div>` : ''}
  ` : '<div class="empty">此叢集沒有 TrendAnalyst 判讀。</div>');

  /* ② 路線預測 */
  const c2 = dwCard('rocket', '#22d3ee', '路線預測', r ? `
    <div class="dw-badges">${badge('#22d3ee', DASH_TRAJ[r.trajectory] || esc(String(r.trajectory || '—')))}
      ${r.horizon ? badge('#64748b', DASH_HORIZON[r.horizon] || esc(String(r.horizon))) : ''}
      ${typeof r.confidence === 'number' ? badge('#818cf8', `信心 ${r.confidence.toFixed(2)}`) : ''}</div>
    ${r.next_milestone ? `<p class="dw-p"><b>下一個里程碑　</b>${esc(r.next_milestone)}</p>` : ''}
    ${r.falsifier ? `<p class="dw-p dw-dim"><b>可證偽條件　</b>${esc(r.falsifier)}</p>` : ''}
    ${r.adoption_note ? `<p class="dw-p dw-dim"><b>導入註記　</b>${esc(r.adoption_note)}</p>` : ''}
    ${(r.watch_signals || []).length ? `<div class="dw-sub-title">觀察訊號</div>
      <ul class="dw-ul">${r.watch_signals.map(s => `<li>${esc(s.signal || String(s))}${s.where ? `<em>　來源：${esc(s.where)}</em>` : ''}</li>`).join('')}</ul>` : ''}
    ${(r.gate_notes || []).length ? `<div class="dash-note">閘門註記：${esc(r.gate_notes.join('；'))}</div>` : ''}
  ` : '<div class="empty">此叢集沒有 TechRoadmap 預測。</div>');

  /* ③ 量能指標 */
  const c3 = dwCard('chart', '#818cf8', '量能指標', `
    ${dwKv('7 日均', dashNum(ma.ma7?.value, 2) + ' ' + dwSuff(ma.ma7), `${ma.ma7?.observed_days ?? '—'} 觀測日`)}
    ${dwKv('30 日均', dashNum(ma.ma30?.value, 2) + ' ' + dwSuff(ma.ma30), `涵蓋 ${dashNum(ma.ma30?.coverage, 4)}`)}
    ${dwKv('90 日均', dashNum(ma.ma90?.value, 2) + ' ' + dwSuff(ma.ma90), ma.ma90?.truncated_by_corpus_start ? '受語料起點截斷' : `涵蓋 ${dashNum(ma.ma90?.coverage, 4)}`)}
    ${dwKv('30/90 比值', dashNum(ratio, 4), '＞1 為升溫')}
    ${dwKv('相對語料基準', rel === null ? '—' : dashSigned(rel * 100, 1) + '%', `語料基準 ${base ? base.toFixed(4) : '—'}`)}
    ${dwKv('30 日斜率', dashNum(sl.value_per_day, 3) + ' ' + dwSuff(sl), `每日筆數；R² ${dashNum(sl.r2, 3)}、${sl.observed_points ?? '—'} 點`)}
    ${dwKv(`近 ${dl.window_days ?? 7} 日增減`, dashSigned(dl.change, 0) + ' ' + dwSuff(dl), `${dl.previous_sum ?? '—'} → ${dl.recent_sum ?? '—'}　${typeof dl.change_rate === 'number' ? dashSigned(dl.change_rate * 100, 1) + '%' : ''}`)}
    ${dwKv('視窗總量', `${tt.occurrences ?? '—'} 次`, `${tt.unique_items ?? '—'} 則獨立、活躍 ${tt.active_days ?? '—'} 天（${dashNum(tt.active_day_rate, 3)}）`)}
  `);

  /* ④ 來源結構 */
  const bars = (sc.top_sources || []).map(s => `
    <div class="dbd-row"><span class="dbd-k">${esc(String(s.source || ''))}</span>
      <span class="dbd-track"><span class="dbd-fill" style="width:${((s.share || 0) * 100).toFixed(1)}%;background:${(s.share || 0) >= 0.25 ? '#f87171' : '#818cf8'}"></span></span>
      <span class="dbd-v">${dashPct((s.share || 0) * 100)}%</span></div>`).join('');
  const c4 = dwCard('globe', '#34d399', '來源結構', `
    ${dwKv('不重複來源', `${sc.distinct_sources ?? '—'} 家`, '')}
    ${dwKv('等效來源數', dashNum(sc.effective_sources, 2), `HHI ${dashNum(sc.hhi, 4)}；越接近 1 表示越集中在單一家`)}
    ${bars ? `<div class="dw-sub-title">前 ${(sc.top_sources || []).length} 大來源占比</div><div class="dash-breakdown">${bars}</div>` : ''}
  `);

  /* ⑤ 轉載證據 */
  const reps = (sy.top_repeats || []).slice(0, 3).map(t => `
    <li>${esc(String(t.title || ''))}
      <em>　${t.count ?? '—'} 次 · ${t.distinct_sources ?? '—'} 家來源${(t.sources || []).length ? `：${esc(t.sources.slice(0, 4).join('、'))}` : ''}</em></li>`).join('');
  const c5 = dwCard('users', '#f472b6', '轉載證據', `
    ${dwKv('重覆標題比', typeof sy.duplicate_title_ratio === 'number' ? dashPct(sy.duplicate_title_ratio * 100) + '%' : '—', `${sy.unique_titles ?? '—'} 個標題 / ${sy.occurrences ?? '—'} 次出現`)}
    ${dwKv('重覆標題組', `${sy.repeated_title_groups ?? '—'} 組`, `其中跨來源 ${sy.cross_source_repeat_groups ?? '—'} 組`)}
    ${dwKv('單一標題最高重覆', `${sy.max_title_repeat ?? '—'} 次`, '')}
    ${reps ? `<div class="dw-sub-title">重覆最多的標題</div><ul class="dw-ul">${reps}</ul>` : ''}
  `);

  /* ⑥ 落地約束：roadmap 只給 B4 / B6 這種裸代碼，這裡查表翻白話。 */
  const bl = (r?.blockers_ranked || []).map((code, i) => {
    const k = String(code).toUpperCase();
    const d = DASH_BLOCKER[k];
    return `<li><b>${i + 1}. ${esc(k)}${d ? `　${d.label}` : ''}</b>${d ? `<em>　${d.desc}</em>` : '<em>　代碼不在 TECH_RUBRIC 值域，原樣顯示</em>'}</li>`;
  }).join('');
  const c6 = dwCard('shield', '#a78bfa', '落地約束', `
    ${bl ? `<ul class="dw-ul dw-bl">${bl}</ul>` : '<div class="empty">此叢集沒有列出落地約束（RM-6 允許空集合，不是漏填）。</div>'}
    ${(r?.rubric_hits || []).length ? `<div class="dw-tags">${r.rubric_hits.map(x => badge('#64748b', esc(String(x)))).join('')}</div>` : ''}
    ${r?.security_flag ? `<div class="dash-note dash-warn">此叢集帶安全旗標。</div>` : ''}
  `);

  return head + `<div class="dw-body">${c1}${c2}${c3}${c4}${c5}${c6}</div>`;
}

/* ======== E 管線健康度 ========
   維運資訊全部收進預設收合的 <details>：它回答的是「管線有沒有在跑」，
   不是「哪個主題在漲」，不該佔掉首屏最貴的四格。 */
function dashOpsBlock() {
  const k = dashKpis(), t = dashTimelineBlock();
  if (!k && !t) return '';
  return `<details class="dash-ops">
    <summary><span class="dop-l">${svg('shield', 14, '#64748b')}管線健康度</span>
      <span class="dop-r">存檔涵蓋、驗證率、每日產出與缺日</span></summary>
    <div class="dop-body">${k}${t}</div>
  </details>`;
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

  return dashSection('calendar', '#818cf8', '時間軸', `${axis.length} 天區間、${days.length} 天有資料`, chart);
}

/* 舊的「分類組成堆疊圖」（dashStackedBlock）在改版時整支移除：
   它只吃熱層 index.json 的 stats 欄位，冷封存沒有這個欄位，畫得出來的長度
   永遠被熱層保留天數卡在 8 天左右——用一張三個月的儀表板去看 8 天的組成，
   讀者會誤以為那就是全部。同樣的資訊由 B 區主題矩陣以 90 天尺度取代。 */

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
