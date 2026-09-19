import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {createHash,webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const source=fs.readFileSync(fileURLToPath(new URL('../../assets/js/data.js',import.meta.url)),'utf8');
function release(n=1){
  const document={schema_version:2,time:`2026-09-19T${n===1?'09':'10'}:00:00+08:00`,date:'2026-09-19',data:{topnews:[{title:'繁體中文 '+n,url:'https://example.com/'+n}],skills:[]},_update_outcome:{topnews:{attempt:'updated',serving:'current'}}};
  const text=JSON.stringify(document)+'\n',hash=createHash('sha256').update(text).digest('hex');
  const manifest={schema_version:1,data_schema_version:2,release_id:'ahn-release-v1-'+hash,data_sha256:hash,data_path:'data/releases/'+hash+'.json',data_bytes:Buffer.byteLength(text),snapshot_time:document.time,scope:'local_snapshot'};
  return {document,text,manifest};
}
function app(storage=new Map()){
  const calls=[], nodes=new Map();let current=release();
  const context=vm.createContext({TextEncoder,TextDecoder,crypto:webcrypto,DOMException,AbortController,setTimeout,clearTimeout,setInterval:()=>1,console:{error(){},warn(){}},
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    showSkeleton(){},renderAll(){},updateHeader(){},NEWS_SUBS:[],ECOSYSTEM_SUBS:[],
    $:id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',querySelector(){return null;}});return nodes.get(id);},
  });
  const run=s=>vm.runInContext(s,context);
  run('let DATA=null,HEALTH=null,updateTime=null,HIST_VIEWING=null,autoLock=false;');run(source);
  const a={context,run,calls,storage,nodes,get current(){return current;},set current(v){current=v;},override:null};
  context.fetch=async(url,options)=>{
    calls.push(url);
    if(a.override){const response=await a.override(url,options);if(response)return response;}
    if(url.includes('release-manifest'))return {ok:true,json:async()=>structuredClone(current.manifest)};
    if(url===current.manifest.data_path)return {ok:true,arrayBuffer:async()=>new TextEncoder().encode(current.text).buffer};
    if(url.includes('latest.json'))return {ok:true,json:async()=>structuredClone(current.document)};
    return {ok:true,json:async()=>({})};
  };
  return a;
}
const blobs=a=>a.calls.filter(x=>x.startsWith('data/releases/')).length;
const latest=a=>a.calls.filter(x=>x.startsWith('data/latest.json')).length;
const pointer='ainews-release-v1:current';
const cachekey=m=>'ainews-release-v1:'+m.release_id;

test('same release loads large bytes once; every check fetches only manifest',async()=>{
  const a=app();for(let i=0;i<4;i++)assert.equal((await a.run('readLatestRelease()')).status,'verified');
  assert.equal(blobs(a),1);assert.equal(latest(a),0);assert.equal(a.calls.length,5);
});
test('same release survives reload using a versioned cache',async()=>{
  const first=app();await first.run('readLatestRelease()');const second=app(first.storage);
  assert.equal((await second.run('readLatestRelease()')).status,'verified');assert.equal(blobs(second),0);
});
test('manifest field order does not redownload unchanged content',async()=>{
  const a=app();await a.run('readLatestRelease()');a.current.manifest=Object.fromEntries(Object.entries(a.current.manifest).reverse());
  assert.equal((await a.run('readLatestRelease()')).status,'verified');assert.equal(blobs(a),1);
});
test('concurrent homepage/dashboard readers coalesce a single fetch',async()=>{
  const a=app();await Promise.all([a.run('readLatestRelease()'),a.run('readLatestRelease()')]);assert.equal(blobs(a),1);assert.equal(a.calls.length,2);
});
test('version change obtains correct new data and switches bounded cache',async()=>{
  const a=app();const old=a.current.manifest;await a.run('readLatestRelease()');a.current=release(2);
  const result=await a.run('readLatestRelease()');assert.equal(result.document.data.topnews[0].title,'繁體中文 2');assert.equal(blobs(a),2);
  assert.equal(a.storage.get(pointer),a.current.manifest.release_id);assert.equal(a.storage.has(cachekey(old)),false);
});
test('UI mutation cannot corrupt raw cached bytes or bookmarks identity',async()=>{
  const a=app();const first=await a.run('readLatestRelease()');first.document.data.topnews[0].title='mutated';
  const second=await a.run('readLatestRelease()');assert.equal(second.document.data.topnews[0].title,'繁體中文 1');assert.equal(blobs(a),1);
});
test('absent manifest uses visibly unverified legacy protocol',async()=>{
  const a=app();a.override=async url=>url.includes('release-manifest')?{ok:false,status:404}:null;
  const result=await a.run('readLatestRelease()');assert.equal(result.status,'legacy');assert.equal(result.manifest,null);assert.equal(latest(a),1);assert.equal(a.storage.size,0);
});
test('manifest transport failure without cache uses unverified legacy',async()=>{
  const a=app();a.override=async url=>{if(url.includes('release-manifest'))throw Error('offline manifest');};
  assert.equal((await a.run('readLatestRelease()')).status,'legacy');assert.equal(latest(a),1);
});
test('manifest absence or transport failure with cache retains verified prior bytes as stale',async()=>{
  for(const status of [404,503]){
    const a=app();await a.run('readLatestRelease()');a.override=async url=>url.includes('release-manifest')?{ok:false,status}:null;
    const result=await a.run('readLatestRelease()');assert.equal(result.status,'cached');assert.equal(latest(a),0);assert.equal(blobs(a),1);
  }
});
test('malformed/unknown manifest fails closed with no cache',async()=>{
  for(const manifest of [null,[],{}, {...release().manifest,schema_version:2},{...release().manifest,data_path:'../private.json'}, {...release().manifest,scope:'deployed'}]){
    const a=app();a.current.manifest=manifest;await assert.rejects(a.run('readLatestRelease()'));assert.equal(latest(a),0);assert.equal(blobs(a),0);
  }
});
test('bad manifest with cache is stale fallback, never verified success',async()=>{
  const a=app();await a.run('readLatestRelease()');a.current.manifest={};const result=await a.run('readLatestRelease()');
  assert.equal(result.status,'cached');assert.equal(latest(a),0);
});
test('wrong bytes/hash and byte size never reach cache or legacy fallback',async()=>{
  for(const text of ['{}',release(2).text]){
    const a=app();a.current.text=text;await assert.rejects(a.run('readLatestRelease()'));assert.equal(a.storage.size,0);assert.equal(latest(a),0);
  }
});
test('new manifest with old content retains old cached version, retry updates',async()=>{
  const a=app();const old=a.current;await a.run('readLatestRelease()');a.current=release(2);a.current.text=old.text;
  let result=await a.run('readLatestRelease()');assert.equal(result.status,'cached');assert.equal(result.manifest.release_id,old.manifest.release_id);
  assert.equal(a.storage.get(pointer),old.manifest.release_id);a.current=release(2);result=await a.run('readLatestRelease()');assert.equal(result.status,'verified');
});
test('old manifest requesting old URL but receiving new content is rejected',async()=>{
  const a=app();a.current.text=release(2).text;await assert.rejects(a.run('readLatestRelease()'));assert.equal(latest(a),0);
});
test('same hash with inconsistent snapshot metadata cannot be accepted',async()=>{
  const a=app();await a.run('readLatestRelease()');a.current.manifest.snapshot_time=release(2).manifest.snapshot_time;
  assert.equal((await a.run('readLatestRelease()')).status,'cached');assert.equal(blobs(a),1);
});
test('corrupt JSON cache or corrupt payload is redownloaded and repaired',async()=>{
  for(const corrupt of ['broken',JSON.stringify({...release(),text:'{}'})]){
    const a=app();a.storage.set(pointer,a.current.manifest.release_id);a.storage.set(cachekey(a.current.manifest),corrupt);
    assert.equal((await a.run('readLatestRelease()')).status,'verified');assert.equal(blobs(a),1);
  }
});
test('corrupt cache plus content fetch failure fails, never displays corrupt data',async()=>{
  const a=app();a.storage.set(pointer,a.current.manifest.release_id);a.storage.set(cachekey(a.current.manifest),'bad');
  a.override=async url=>url.startsWith('data/releases/')?{ok:false,status:503}:null;
  await assert.rejects(a.run('readLatestRelease()'));assert.equal(latest(a),0);
});
test('storage quota/disabled failure keeps current valid data and in-memory cache',async()=>{
  const a=app();a.context.localStorage.setItem=()=>{throw Error('quota');};
  await a.run('readLatestRelease()');await a.run('readLatestRelease()');assert.equal(blobs(a),1);assert.equal(a.storage.size,0);
});
test('cache pointer write failure leaves old stored pointer intact',async()=>{
  const a=app();await a.run('readLatestRelease()');const old=a.storage.get(pointer);a.current=release(2);
  const set=a.context.localStorage.setItem;a.context.localStorage.setItem=(k,v)=>{if(k===pointer)throw Error('pointer');set(k,v);};
  assert.equal((await a.run('readLatestRelease()')).status,'verified');assert.equal(a.storage.get(pointer),old);
});
test('Web Crypto missing does not claim manifest validation success',async()=>{
  const a=app();a.context.crypto=undefined;await assert.rejects(a.run('readLatestRelease()'));assert.equal(a.storage.size,0);assert.equal(latest(a),0);
});
test('polling same version avoids content; valid update prompts only after hash validation',async()=>{
  const a=app();await a.run('loadData()');await a.run('checkLatestRelease()');assert.equal(blobs(a),1);
  a.current=release(2);a.current.text='bad';await a.run('checkLatestRelease()');assert.doesNotMatch(a.nodes.get('banners').innerHTML,/新資料已到/);
  a.current=release(2);await a.run('checkLatestRelease()');assert.match(a.nodes.get('banners').innerHTML,/新資料已到/);
});
test('historical view does not poll or replace historical DATA',async()=>{
  const a=app();a.run("HIST_VIEWING='2026-09-10';DATA={historical:true};");await a.run('checkLatestRelease()');assert.equal(a.calls.length,0);assert.equal(a.run('DATA.historical'),true);
});
test('raw body timeout covers body stream, not just headers',async()=>{
  const a=app();a.context.fetch=async()=>({ok:true,arrayBuffer:()=>new Promise(()=>{})});
  await assert.rejects(a.run("fetchJSON('fixture',5,{},'text')"),{name:'AbortError'});
});
test('invalid UTF-8 cannot be normalized into a valid release',async()=>{
  const a=app();a.override=async url=>url.startsWith('data/releases/')?{ok:true,arrayBuffer:async()=>new Uint8Array([255]).buffer}:null;
  await assert.rejects(a.run('readLatestRelease()'));assert.equal(a.storage.size,0);
});
test('malformed manifest JSON syntax never bypasses validation via legacy',async()=>{
  const a=app();a.override=async url=>url.includes('release-manifest')?{ok:true,json:async()=>{throw new SyntaxError('bad JSON');}}:null;
  await assert.rejects(a.run('readLatestRelease()'));assert.equal(latest(a),0);
});
test('calendar-invalid or out-of-range manifest timestamps are rejected',async()=>{
  for(const time of ['2026-02-30T09:00:00Z','2026-02-29T09:00:00Z','0000-01-01T09:00:00Z','2026-09-19T24:00:00Z','2026-09-19T10:60:00Z','2026-09-19T09:00:00+24:00']){
    const a=app();a.current.manifest.snapshot_time=time;await assert.rejects(a.run('readLatestRelease()'));assert.equal(latest(a),0);
  }
  const a=app();assert.equal(a.run("validReleaseTime('2024-02-29T09:00:00Z')"),true);
});
