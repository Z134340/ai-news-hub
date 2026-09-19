import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function app(seed={}) {
  const storage = new Map(Object.entries(seed)), nodes = new Map(), users = new Map(), feedback = new Map(), writes=[];
  const node = () => ({style:{},dataset:{},classList:{toggle(){},add(){},remove(){}},setAttribute(){},appendChild(){},addEventListener(){},querySelector(){return {open:false,addEventListener(){}};},contains(){return false;},textContent:'',innerHTML:''});
  const context = vm.createContext({URL,DOMException,AbortController,setTimeout,clearTimeout,console:{error(){},warn(){}},
    document:{getElementById(id){if(!nodes.has(id)) nodes.set(id,node());return nodes.get(id);},querySelectorAll(){return[];},createElement:node,body:node()},
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},
    window:{listeners:{},addEventListener(name,fn){this.listeners[name]=fn;}},fetch:async()=>{throw Error('unexpected network');}});
  const run = source => vm.runInContext(source,context);
  for (const file of ['config','personal-data','firebase','bookmarks','search','render','data','trend-topics','trend-briefing','dashboard','history']) run(fs.readFileSync(`${root}/assets/js/${file}.js`,'utf8'));
  const snap = (collection,id) => ({exists:collection.has(id),data:()=>structuredClone(collection.get(id))});
  const db = {collection(name){const collection=name==='users'?users:feedback;return {
    doc(id){return {name,id};},
    where(_field,_op,uid){return {async get(){if(db.beforeQuery) await db.beforeQuery(uid);return {docs:[...collection].filter(([,x])=>x.uid===uid).map(([id,x])=>({ref:{name,id},data:()=>structuredClone(x)}))};}};}
  };}, async runTransaction(fn){const pending=[];
    const tx={async get(ref){return snap(ref.name==='users'?users:feedback,ref.id);},update:(ref,fields)=>pending.push([ref,fields,true]),set:(ref,fields)=>pending.push([ref,fields,false]),delete:ref=>pending.push([ref,null,false])};
    const result=await fn(tx);
    for(const [ref,fields,merge] of pending){const collection=ref.name==='users'?users:feedback;writes.push([ref.name,ref.id]);if(fields===null)collection.delete(ref.id);else collection.set(ref.id,structuredClone(merge?{...collection.get(ref.id),...fields}:fields));}
    return result;
  }};
  context.testDB=db;run('_fb.ready=true; _fb.db=testDB;');
  const login = uid => {context.testUid=uid;run('_fb.user=testUid?{uid:testUid}:null; switchPersonalAccount(testUid);');};
  return {run,context,storage,nodes,users,feedback,writes,db,login};
}
const saved = {cat:'topnews',catLabel:'test',catColor:'#f59e0b',item:{title:'a',url:'https://example.com/a'},savedAt:'2026-09-17T00:00:00.000Z'};
test('HTML text and attributes escape quotes; links allow only absolute HTTP(S)',()=>{
  const a=app();
  for(const url of ['javascript:alert(1)','data:text/html,test','https://x.test/" onmouseover="test','https://u:p@x.test','https://x.test/\n']) {a.context.testURL=url;assert.equal(a.run('linkOut(testURL)'), '');}
  assert.equal(a.run('esc(`"\'<&>`)'),'&quot;&#39;&lt;&amp;&gt;');
  a.context.testURL='https://例子.test/新聞?a=1&b="quoted"';
  const html=a.run('linkOut(testURL)');assert.match(html,/%22quoted%22/);assert.match(html,/&amp;/);assert.doesNotMatch(html,/href="[^"]*"quoted/);
  assert.equal(a.run('bmBtn("bad\\\'id")'), '');
});
test('malformed/null/array storage cannot crash initialization',()=>{
  for(const value of ['null','[]','"text"','{broken','{"bmx":null}']){const a=app({'ainews-bm':value,'ainews-fb':value});a.run('loadBookmarks();loadFeedback();updateBmTabCount();');assert.equal(a.run('Object.keys(BOOKMARKS).length'),0);}
});
test('legacy bookmarks remain guest-only; signing into B never uploads A',async()=>{
  const a=app({'ainews-bm':JSON.stringify({bma:saved})});a.run('loadBookmarks()');assert.equal(a.run('Object.keys(BOOKMARKS).length'),1);
  a.login('A');a.context.record=saved;a.run('BOOKMARKS.bma=record;persistPersonal()');await a.run('syncPersonalToCloud()');
  a.login(null);a.login('B');await a.run('syncPersonalToCloud()');assert.deepEqual(a.users.get('B').bookmarks,{});
  a.login('A');assert.equal(a.run('BOOKMARKS.bma.item.title'),'a');
});
test('late A response cannot mutate B or write to B',async()=>{
  const a=app();let release;a.db.beforeQuery=uid=>uid==='A'?new Promise(r=>release=r):Promise.resolve();
  a.login('A');a.context.record=saved;a.run('BOOKMARKS.bma=record');const pending=a.run('syncPersonalToCloud()');
  await new Promise(r=>setTimeout(r,0));
  a.login('B');release();await pending;assert.equal(a.writes.length,0);assert.equal(a.run('Object.keys(BOOKMARKS).length'),0);
});
test('bookmark deletion survives cloud merge and stale second-device upload',async()=>{
  const a=app();a.login('A');a.users.set('A',{bookmarks:{bma:saved,bmb:{...saved,item:{title:'b'}}}});
  await a.run('syncPersonalToCloud()');a.run('PERSONAL.deleted.bma=nextPersonalStamp();delete BOOKMARKS.bma');await a.run('syncPersonalToCloud()');
  assert.equal(a.users.get('A').bookmarks.bma,undefined);assert.ok(a.users.get('A').bookmarks.bmb);
  a.context.record=saved;a.run('BOOKMARKS={bma:record};PERSONAL.deleted={}');await a.run('syncPersonalToCloud()');
  assert.equal(a.users.get('A').bookmarks.bma,undefined);assert.ok(a.users.get('A').bookmarks.bmb);
  a.run('BOOKMARKS.bma={...record,savedAt:nextPersonalStamp()}');await a.run('syncPersonalToCloud()');assert.ok(a.users.get('A').bookmarks.bma);
});
test('feedback cancellation and stale cache do not resurrect mirrored rating',async()=>{
  const a=app();a.login('A');a.run("FEEDBACK.bma={rating:'good',ts:nextPersonalStamp()}");await a.run('syncPersonalToCloud()');assert.ok(a.feedback.get('A_bma'));
  a.run('PERSONAL.feedbackDeleted.bma=nextPersonalStamp();delete FEEDBACK.bma');await a.run('syncPersonalToCloud()');assert.equal(a.feedback.has('A_bma'),false);
  a.run("FEEDBACK.bma={rating:'good',ts:'2026-09-17T00:00:00.000Z'};PERSONAL.feedbackDeleted={}");await a.run('syncPersonalToCloud()');assert.equal(a.feedback.has('A_bma'),false);
});
test('storage quota failure preserves interaction and still tries cloud sync',async()=>{
  const a=app();a.login('A');a.context.localStorage.setItem=()=>{throw Error('quota');};
  a.context.record=saved;a.run('BOOKMARKS.bma=record;saveBookmarks()');await a.run('syncPersonalToCloud()');assert.ok(a.users.get('A').bookmarks.bma);assert.match(a.nodes.get('personalStatus').textContent,/儲存/);
});
test('untrusted cached categories/IDs are normalized before rendering',()=>{
  const a=app();a.context.bad={"bm'x":saved,bma:{...saved,catLabel:'<img>',catColor:'red" onclick="bad'}};
  a.run('BOOKMARKS=cleanPersonal(bad,"bookmarks");renderBookmarks()');const html=a.nodes.get('panel-bookmarks').innerHTML;
  assert.doesNotMatch(html,/<img>|onclick="bad/);assert.equal(a.run('Object.keys(BOOKMARKS).length'),1);
});
test('deadline includes response body, not just headers',async()=>{
  const a=app();a.context.fetch=async()=>({ok:true,json:()=>new Promise(()=>{})});await assert.rejects(a.run("fetchJSON('https://example.com',10)"),{name:'AbortError'});
});
test('archive query selects summaries, bounds pages, and uses exclusive cursor',async()=>{
  const a=app();let query;a.context.fetch=async(_url,opt)=>{query=JSON.parse(opt.body).structuredQuery;return {ok:true,json:async()=>Array.from({length:3},(_,i)=>({document:{fields:{date:{stringValue:`2026-09-${17-i}`},item_count:{integerValue:'2'}}}}))};};
  const page=await a.run("archivePage('2026-09-18',2)");assert.equal(page.entries.length,2);assert.equal(page.next,'2026-09-16');assert.equal(query.limit,3);assert.equal(query.startAt.before,false);assert.ok(!query.select.fields.some(x=>x.fieldPath==='payload'));
});
test('cold storage delay does not block dashboard static render',async()=>{
  const a=app();a.run("dashFetch=async()=>null;archiveList=()=>new Promise(()=>{});renderTrendBriefing=()=>{$('trend-briefing').innerHTML='<p>ready</p>'};");
  await a.run('loadDashboard()');assert.match(a.nodes.get('trend-briefing').innerHTML,/ready/);
});
test('history rejects injected date before any request',async()=>{
  const a=app();let called=false;a.context.fetch=async()=>{called=true;throw Error();};await a.run(`loadHistDate("2026-01-01');alert(1);//")`);assert.equal(called,false);
});

test('rapid rating then cancel is serialized and removes the feedback mirror',async()=>{
  const a=app();a.login('A');let release;a.db.beforeQuery=()=>new Promise(r=>release=r);
  a.run("FEEDBACK.bma={rating:'good',ts:nextPersonalStamp()}");const first=a.run('syncPersonalToCloud()');
  await new Promise(r=>setTimeout(r,0));
  a.run('PERSONAL.feedbackDeleted.bma=nextPersonalStamp();delete FEEDBACK.bma');const second=a.run('syncPersonalToCloud()');
  a.db.beforeQuery=null;release();await first;await second;
  assert.equal(a.feedback.has('A_bma'),false);assert.ok(a.users.get('A').feedback_deleted.bma);
});
test('cross-device stale feedback query is refreshed before committing cancellation',async()=>{
  const a=app();a.login('A');let reads=0;
  const rating={rating:'good',ts:'2026-09-17T00:00:00.000Z',uid:'A',item_id:'bma'};
  a.users.set('A',{feedback_v2:true,feedback_state:{bma:rating}});
  a.db.beforeQuery=()=>{if(++reads===2)a.feedback.set('A_bma',rating);};
  a.run('PERSONAL.feedbackDeleted.bma=nextPersonalStamp()');await a.run('syncPersonalToCloud()');
  assert.equal(reads,2);assert.equal(a.feedback.has('A_bma'),false);
});
test('guest storage events persist merged bookmarks for reload',()=>{
  const a=app();a.run('loadBookmarks()');a.context.record=saved;a.run('BOOKMARKS.bma=record;persistPersonal()');
  const newer=JSON.stringify({version:2,bookmarks:{bmb:saved}});a.storage.set('ainews-personal-v2:guest',newer);
  a.context.window.listeners.storage({key:'ainews-personal-v2:guest',newValue:newer});a.run('loadBookmarks()');
  assert.equal(a.run('Object.keys(BOOKMARKS).length'),2);
});
test('latest load failure preserves news tab child containers',async()=>{
  const a=app();a.run("showSkeleton=()=>{};");a.nodes.set('panel-news',{innerHTML:'original subpanels'});
  await a.run('loadData()');assert.equal(a.nodes.get('panel-news').innerHTML,'original subpanels');
  assert.match(a.nodes.get('sub-topnews').innerHTML,/載入失敗/);
});

test('skills render by GitHub stars and escape repository metadata',()=>{
  const a=app();a.context.fixture=[
    {title:'safe/low',summary:'low',url:'https://github.com/safe/low',stars:10,forks:1,date:'2026-09-17',tools:['Claude Code','Codex']},
    {title:'high/repo <img src=x onerror=bad()>',summary:'<script>bad()</script>',url:'https://github.com/safe/high',stars:20,forks:2,date:'2026-09-18',tools:['Claude Code','Codex']}
  ];
  a.run('renderSkills(fixture)');const html=a.nodes.get('panel-skills').innerHTML;
  assert.ok(html.indexOf('high/repo') < html.indexOf('safe/low'));assert.doesNotMatch(html,/<img|<script>/);assert.match(html,/&lt;/);
});

test('skills can be searched by supported agent client',()=>{
  const a=app();a.context.fixture={data:{skills:[{title:'owner/skill',source:'GitHub',summary:'design helpers',url:'https://github.com/owner/skill',tools:['Claude Code','Codex']}]}};
  a.run('DATA=fixture;runSearch("Codex")');const html=a.nodes.get('panel-search').innerHTML;
  assert.match(html,/owner\/skill/);assert.match(a.nodes.get('secCount').textContent,/1/);
});

test('enterprise ecosystem groups official information and models without changing the models data key',()=>{
  const a=app();
  a.context.fixture={data:{
    official_info:[{title:'Official API update',company:'OpenAI',date:'2099-01-01',event_type:'api',summary:'摘要',highlights:['重點'],analysis:'影響',url:'https://openai.com/update',official_source:true}],
    models:[{model_name:'Model A',institution:'Anthropic',release_date:'2099-01-01',domain:'Multimodal',summary:'摘要',url:'https://anthropic.com/news/model-a',official_source:true}]
  }};
  a.run('updateTitle=()=>{}; DATA=fixture; renderAll()');
  assert.equal(a.run("SECS.some(s=>s.id==='ecosystem') && !SECS.some(s=>s.id==='models')"),true);
  assert.match(a.nodes.get('sub-official_info').innerHTML,/Official API update/);
  assert.match(a.nodes.get('sub-models').innerHTML,/Model A/);
  assert.match(a.nodes.get('sub-official_info').innerHTML,/官方來源/);
});

test('dashboard reads its own latest snapshot, independent from historical DATA',async()=>{
  const a=app();a.context.fixture={date:'2026-09-18',data:{topnews:[]}};
  a.run("DATA={date:'2026-09-01',data:{}};dashFetch=async url=>url==='data/latest.json'?fixture:null;renderTrendBriefing=()=>{};archiveList=async()=>[];");
  await a.run('loadDashboard()');assert.equal(a.run('BRIEFING.model.end'),'2026-09-18');assert.equal(a.run('DATA.date'),'2026-09-01');
});
test('superseded dashboard requests cannot overwrite latest news or focus',async()=>{
  const a=app();let resolveFirst;let reads=0;
  a.context.testFetch=async url=>{
    if(url!=='data/latest.json') return null;
    if(++reads===1) return new Promise(r=>resolveFirst=r);
    return {date:'2026-09-18',data:{topnews:[]}};
  };
  a.run('dashFetch=testFetch;renderTrendBriefing=()=>{};archiveList=async()=>[];BRIEFING.selected="keep-selection";');
  const first=a.run('loadDashboard()');await a.run('loadDashboard(true)');resolveFirst({date:'2026-09-17',data:{}});await first;
  assert.equal(a.run('BRIEFING.model.end'),'2026-09-18');assert.equal(a.run('BRIEFING.selected'),'keep-selection');
});
test('archive reads are bounded and wrong-date archives never become observations',async()=>{
  const a=app();let active=0,peak=0;
  a.context.testFetch=async url=>{
    if(url==='data/latest.json')return {date:'2026-09-18',data:{}};
    if(url==='data/index.json')return Array.from({length:20},(_,i)=>({date:`2026-09-${String(i+1).padStart(2,'0')}`}));
    if(/^data\/2026/.test(url)) {active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;return {date:'2026-01-01',data:{}};}
    return null;
  };
  a.run('dashFetch=testFetch;renderTrendBriefing=()=>{};archiveList=async()=>[];');await a.run('loadDashboard()');
  assert.ok(peak<=4);assert.equal(a.run('BRIEFING.model.observed'),1);
});
test('invalid latest data produces a retryable empty model instead of old focus',async()=>{
  const a=app();a.run("dashFetch=async()=>({date:'invalid',data:[]});renderTrendBriefing=()=>{};archiveList=async()=>[];");await a.run('loadDashboard()');
  assert.equal(a.run('BRIEFING.model.end'),null);assert.equal(a.run('BRIEFING.pending'),false);assert.equal(a.run('DASH.loading'),false);
});
test('briefing renders untrusted news as escaped text and safe links',()=>{
  const a=app();a.context.fixture={date:'2026-09-18',data:{topnews:[1,2].map(i=>({title:'Orion protocol <img src=x onerror=alert(1)>',date:'2026-09-18',url:`https://source${i}.example/article`,summary:'<script>bad()</script>'}))}};
  a.run("BRIEFING.model=TrendTopics.build([fixture],fixture.date);renderTrendBriefing();");
  const html=a.nodes.get('trend-briefing').innerHTML;assert.doesNotMatch(html,/<img|<script>/);assert.match(html,/&lt;/);assert.match(html,/noopener noreferrer/);
});

test('v2 display and pending-review status preserve existing bookmark keys',()=>{
  const a=app();
  const old={model_name:'Legacy model',release_date:'2026-09-18',url:'https://example.com/model?utm_source=old',summary:'保留摘要'};
  a.context.old=old;
  const before=a.run('itemKey(old)');
  a.context.migrated={...old,schema_version:2,canonical_url:'https://example.com/model',item_id:'ahn2_future_backend_id',source_title:null,display_title:null,verified:'needs_review'};
  assert.equal(a.run('itemKey(migrated)'),before);
  a.run('renderModels([migrated])');
  assert.match(a.nodes.get('sub-models').innerHTML,/待複核/);
  a.context.sourceOnly={model_name:'Legacy source only',release_date:'2026-09-18',source_url:old.url};
  assert.equal(a.run('itemKey(sourceOnly)'),a.run('itemKey({...sourceOnly,schema_version:2,item_id:"new",canonical_url:"https://example.com/model"})'));
  a.context.news={title:'Original compatibility title',display_title:'繁體中文顯示標題',source_title:'Original source title',url:'https://example.com/news',summary:'摘要',verified:'needs_review'};
  a.run('renderOfficialInfo([news])');
  assert.match(a.nodes.get('sub-official_info').innerHTML,/繁體中文顯示標題/);
  assert.match(a.nodes.get('sub-official_info').innerHTML,/待複核/);
});
