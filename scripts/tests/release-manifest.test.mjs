import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {
  buildReleaseManifest, validateReleaseManifest, writeReleaseManifest,
} from '../build-release-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const releaseSource = fs.readFileSync(path.join(root, 'assets/js/release.js'), 'utf8');

function fixtureRoot(overrides={}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anh-release-'));
  const payloads = {
    'data/latest.json': {schema_version:2,date:'2026-09-20',time:'2026-09-20T10:00:00+08:00',data:{topnews:[]}},
    'data/health.json': {last_run:'2026-09-20T10:01:00+08:00',status:'ok'},
    'data/index.json': [{date:'2026-09-20',time:'2026-09-20T10:00:00+08:00'}],
    'data/skills.json': {items:[],_updated_at:'2026-09-20T02:00:00Z'},
    ...overrides,
  };
  for (const [relative, value] of Object.entries(payloads)) {
    const target = path.join(dir, relative);
    fs.mkdirSync(path.dirname(target), {recursive:true});
    fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  }
  return {dir, payloads};
}

function browserServer(manifest, dir, seed={}) {
  const storage = new Map(Object.entries(seed));
  const requests = [];
  let currentManifest = manifest;
  let corrupt = {};
  let missing = new Set();
  const context = vm.createContext({
    AbortController, TextEncoder, crypto:webcrypto, setTimeout, clearTimeout, Date,
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
    fetch:async url=>{
      const pathname=String(url).split('?')[0]; requests.push(pathname);
      if(pathname==='data/release-manifest.json') {
        if(currentManifest===null) return {ok:false,status:404,text:async()=>''};
        return {ok:true,status:200,text:async()=>typeof currentManifest==='string'?currentManifest:JSON.stringify(currentManifest)};
      }
      if(missing.has(pathname)) return {ok:false,status:404,text:async()=>''};
      const raw=Object.prototype.hasOwnProperty.call(corrupt,pathname)?corrupt[pathname]:fs.readFileSync(path.join(dir,pathname),'utf8');
      return {ok:true,status:200,text:async()=>raw};
    },
  });
  vm.runInContext(releaseSource, context);
  return {
    context, storage, requests,
    run:source=>vm.runInContext(source,context),
    setManifest:value=>{currentManifest=value;},
    setCorrupt:value=>{corrupt=value;},
    setMissing:value=>{missing=new Set(value);},
  };
}

test('builder is deterministic and refuses an incomplete release',()=>{
  const {dir}=fixtureRoot();
  try {
    const first=buildReleaseManifest(dir), second=buildReleaseManifest(dir);
    assert.deepEqual(second,first);
    assert.match(first.release_id,/^ahr1_[a-f0-9]{64}$/);
    assert.deepEqual(validateReleaseManifest(first),[]);
    writeReleaseManifest(dir);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'data/release-manifest.json'))),first);
    fs.rmSync(path.join(dir,'data/health.json'));
    assert.throws(()=>buildReleaseManifest(dir),/health\.json/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('unchanged manifest polls only the small manifest and reuses verified assets',async()=>{
  const {dir}=fixtureRoot();
  try {
    const app=browserServer(buildReleaseManifest(dir),dir);
    const first=await app.run('loadReleaseBundle()');
    assert.equal(first.state.verified,true);
    await app.run('loadReleaseBundle()');
    assert.equal(app.requests.filter(x=>x==='data/release-manifest.json').length,2);
    for(const asset of first.manifest.assets) assert.equal(app.requests.filter(x=>x===asset.path).length,1);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('a changed release fetches only the changed asset once and switches after verification',async()=>{
  const {dir}=fixtureRoot();
  try {
    const firstManifest=buildReleaseManifest(dir), app=browserServer(firstManifest,dir);
    await app.run('loadReleaseBundle()');
    fs.writeFileSync(path.join(dir,'data/health.json'),JSON.stringify({last_run:'2026-09-20T10:02:00+08:00',status:'partial'})+'\n');
    const secondManifest=buildReleaseManifest(dir);app.setManifest(secondManifest);
    const second=await app.run('loadReleaseBundle()');
    assert.notEqual(second.manifest.release_id,firstManifest.release_id);
    assert.equal(second.assets['data/health.json'].status,'partial');
    assert.equal(app.requests.filter(x=>x==='data/health.json').length,2);
    for(const pathName of ['data/latest.json','data/index.json','data/skills.json']) assert.equal(app.requests.filter(x=>x===pathName).length,1);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('hash mismatch, invalid manifest, and missing asset retain the prior verified release',async()=>{
  const {dir}=fixtureRoot();
  try {
    const firstManifest=buildReleaseManifest(dir), app=browserServer(firstManifest,dir);
    await app.run('loadReleaseBundle()');
    fs.writeFileSync(path.join(dir,'data/health.json'),JSON.stringify({last_run:'2026-09-20T10:03:00+08:00',status:'failed'})+'\n');
    const secondManifest=buildReleaseManifest(dir);app.setManifest(secondManifest);
    app.setCorrupt({'data/health.json':'{"status":"tampered"}\n'});
    let result=await app.run('loadReleaseBundle()');
    assert.equal(result.state.degraded,true);assert.equal(result.manifest.release_id,firstManifest.release_id);
    assert.equal(result.assets['data/health.json'].status,'ok');
    app.setCorrupt({});app.setManifest('{"schema_version":99}');
    result=await app.run('loadReleaseBundle()');
    assert.equal(result.state.degraded,true);assert.equal(result.manifest.release_id,firstManifest.release_id);
    app.setManifest(secondManifest);app.setMissing(['data/health.json']);
    result=await app.run('loadReleaseBundle()');
    assert.equal(result.state.degraded,true);assert.equal(result.manifest.release_id,firstManifest.release_id);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('invalid new release without prior verified content fails explicitly',async()=>{
  const {dir}=fixtureRoot();
  try {
    const manifest=buildReleaseManifest(dir), app=browserServer(manifest,dir);
    app.setCorrupt({'data/latest.json':'{}\n'});
    await assert.rejects(app.run('loadReleaseBundle()'),/asset_(size|hash)_mismatch/);
    assert.equal(app.run('RELEASE_STATE.verified'),false);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('legacy snapshot without a manifest remains readable but is never called verified',async()=>{
  const {dir}=fixtureRoot();
  try {
    const app=browserServer(null,dir);
    const result=await app.run('loadReleaseBundle()');
    assert.equal(result.mode,'legacy');
    assert.equal(result.state.verified,false);
    assert.equal(result.state.mode,'legacy_unverified');
    assert.equal(app.storage.has('ainews-release-cache-v1'),false);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('a missing manifest after activation retains the prior verified release',async()=>{
  const {dir}=fixtureRoot();
  try {
    const manifest=buildReleaseManifest(dir), app=browserServer(manifest,dir);
    await app.run('loadReleaseBundle()');
    app.setManifest(null);
    const result=await app.run('loadReleaseBundle()');
    assert.equal(result.mode,'manifest');
    assert.equal(result.state.verified,true);
    assert.equal(result.state.degraded,true);
    assert.equal(result.state.error,'release_not_found');
    assert.equal(result.manifest.release_id,manifest.release_id);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('unknown schema and tampered release identity are rejected',async()=>{
  const {dir}=fixtureRoot();
  try {
    const manifest=buildReleaseManifest(dir), app=browserServer({...manifest,schema_version:2},dir);
    await assert.rejects(app.run('loadReleaseBundle()'),/manifest_schema_invalid/);
    app.setManifest({...manifest,release_id:'ahr1_'+'0'.repeat(64)});
    await assert.rejects(app.run('loadReleaseBundle()'),/manifest_release_id_mismatch/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
