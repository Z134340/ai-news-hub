import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../assets/js/trend-topics.js',import.meta.url),'utf8');
const c=vm.createContext({Intl,URL});vm.runInContext(source,c);
const model=vm.runInContext('TrendTopics',c);
const item=(id,title='Orion protocol security',date='2026-09-18')=>({title,date,url:`https://source${id}.example/article`,summary:'Source summary',verified:true});
const snap=(date,items=[])=>({date,data:{topnews:items}});
test('dynamic groups come from titles and need two distinct links',()=>{
 assert.equal(model.build([snap('2026-09-18',[item(1)])],'2026-09-18').topics.length,0);
 const out=model.build([snap('2026-09-18',[item(1),item(2)])],'2026-09-18');
 assert.equal(out.topics.length,1);assert.equal(out.topics[0].count,2);assert.match(out.topics[0].headline,/Orion/);
 assert.equal(out.topics[0].sources,2);
});
test('URL duplicates across categories, days and tracking parameters count once',()=>{
 const a=item(1), b={...a,url:a.url+'?utm_source=feed#fragment'};
 const out=model.build([snap('2026-09-18',[a,b]),snap('2026-09-17',[a])],'2026-09-18');assert.equal(out.articleCount,1);assert.equal(out.topics.length,0);
});
test('invalid links, dates, future news and old news are excluded',()=>{
 const data=[{...item(1),url:'javascript:alert(1)'},{...item(2),url:'https://user:pw@x.example'},item(3,'Orion protocol','2026-02-30'),item(4,'Orion protocol','2026-09-19'),item(5,'Orion protocol','2026-08-01')];
 assert.equal(model.build([snap('2026-09-18',data)],'2026-09-18').articleCount,0);
});
test('missing days stay null and insufficient history does not claim a new trend',()=>{
 const out=model.build([snap('2026-09-18',[item(1),item(2)])],'2026-09-18');
 assert.equal(out.topics[0].series[12].count,null);assert.equal(out.topics[0].series[13].count,2);assert.equal(out.topics[0].status,'近期焦點');
});
test('complete windows support observed new and declining labels',()=>{
 const snapshots=Array.from({length:14},(_,i)=>snap(model.shift('2026-09-05',i)));
 snapshots[13].data.topnews=[item(1),item(2)];
 assert.equal(model.build(snapshots,'2026-09-18').topics[0].status,'本窗新見');
 snapshots[0].data.topnews=[item(3,'Orion protocol security','2026-09-05'),item(4,'Orion protocol security','2026-09-05'),item(5,'Orion protocol security','2026-09-05')];
 assert.equal(model.build(snapshots,'2026-09-18').topics[0].status,'收錄減少');
});
test('stable IDs do not depend on input order or display casing',()=>{
 const a=item(1,'Orion protocol'),b=item(2,'Orion protocol');
 const first=model.build([snap('2026-09-18',[a,b])],'2026-09-18');
 const second=model.build([snap('2026-09-18',[{...b,title:'ORION PROTOCOL'},a])],'2026-09-18');
 assert.equal(first.topics[0].id,second.topics[0].id);
});
test('past groups remain discoverable without claiming current attention',()=>{
 const out=model.build([snap('2026-09-18'),snap('2026-09-06',[item(1,'Orion protocol','2026-09-06'),item(2,'Orion protocol','2026-09-06')])],'2026-09-18');
 assert.equal(out.topics.length,0);assert.equal(out.past.length,1);assert.equal(out.past[0].count,0);
});
test('malformed categories and items fail safely, non-news weekly material excluded',()=>{
 const out=model.build([null,{date:'bad'},snap('2026-09-18',[null,{},12]),{date:'2026-09-18',data:{topnews:{},tutorials:[item(1),item(2)]}}],'2026-09-18');assert.equal(out.topics.length,0);
 assert.equal(model.build([],null).end,null);
});
test('focus cap is six and highly overlapping groups do not fill the list',()=>{
 const items=Array.from({length:9},(_,i)=>[item(i*2,`Project${i} Protocol${i}`),item(i*2+1,`Project${i} Protocol${i}`)]).flat();
 const out=model.build([snap('2026-09-18',items)],'2026-09-18');assert.equal(out.topics.length,6);
});
