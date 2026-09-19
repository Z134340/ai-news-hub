"""AH-03: all public installs/builds are isolated fixtures; no real source requests."""
from copy import deepcopy
from hashlib import sha256
import json
import functools
import http.server
import threading
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from test_category_quality import module, pub, POLICY, AT, NEXT, candidates, fake_validate, ROOT
from contracts.schema import errors

release = module('release_manifest_tests', 'release-manifest.py')


class ReleaseManifest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.store = self.root / 'store'
        self.candidate = self.root / 'selected.json'
        self.data = self.root / 'site/data'
        self.result = pub.publish(candidates(), self.store, self.candidate, AT, POLICY, fake_validate)

    def install(self):
        return release.install(self.store, self.candidate, self.data)

    def next(self):
        incoming = candidates()
        incoming['topnews']['items'][0]['summary'] = 'second release'
        pub.publish(incoming, self.store, self.candidate, NEXT, POLICY, fake_validate)

    def test_schema_positive_and_negative(self):
        manifest = self.install()
        self.assertEqual(errors(manifest, release.SCHEMA), [])
        for field in manifest:
            bad = deepcopy(manifest); del bad[field]
            with self.subTest(missing=field):
                self.assertTrue(errors(bad, release.SCHEMA))
        for key, value in [('schema_version', True), ('schema_version', 2), ('data_schema_version', 1),
                           ('scope', 'deployed'), ('data_bytes', 0), ('data_bytes', True),
                           ('snapshot_time', 'yesterday'), ('snapshot_time', '2026-02-30T10:00:00Z'),
                           ('data_sha256', 'A'*64), ('release_id', 'other'),
                           ('data_path', '../private/raw.json'), ('extra', True)]:
            bad = {**manifest, key:value}
            with self.subTest(key=key, value=value): self.assertTrue(errors(bad, release.SCHEMA))

    def test_precise_bytes_binding_and_metadata(self):
        m = self.install(); payload = self.candidate.read_bytes()
        self.assertEqual(m['data_sha256'], sha256(payload).hexdigest())
        self.assertEqual(m['data_bytes'], len(payload))
        release.verify_payload(m, payload)
        for modified in [payload+b' ', payload.replace(b'local', b'xxxxx')]:
            with self.assertRaises(ValueError): release.verify_payload(m, modified)
        for key,value in [('release_id','ahn-release-v1-'+'0'*64), ('data_path','data/releases/'+'0'*64+'.json'), ('snapshot_time',NEXT)]:
            with self.assertRaises(ValueError): release.verify_payload({**m,key:value},payload)

    def test_deterministic_repeat_does_not_change_identity_or_snapshot(self):
        m = self.install(); before = {p.relative_to(self.data):p.read_bytes() for p in self.data.rglob('*.json')}
        self.assertEqual(self.install(), m)
        self.assertEqual(before, {p.relative_to(self.data):p.read_bytes() for p in self.data.rglob('*.json')})
        self.assertEqual(len(list((self.data/'releases').iterdir())), 1)

    def test_changed_content_gets_new_identity_retains_previous_bytes(self):
        old = self.install(); payload = self.candidate.read_bytes()
        self.next(); new = self.install()
        self.assertNotEqual(old['release_id'], new['release_id'])
        self.assertEqual((self.data.parent/old['data_path']).read_bytes(),payload)
        self.assertEqual(release.verify_site(self.data),new)

    def test_failure_at_each_write_keeps_previous_manifest_and_can_retry(self):
        for fail_step in (1,2,3):
            with self.subTest(write=fail_step):
                self.data=self.root/f'site{fail_step}/data'
                self.store=self.root/f'store{fail_step}'
                self.candidate=self.root/f'selected{fail_step}.json'
                pub.publish(candidates(),self.store,self.candidate,AT,POLICY,fake_validate)
                old=self.install(); old_bytes=(self.data/'release-manifest.json').read_bytes()
                self.next()
                real=release.quality.atomic_write; count=0
                def fail(path,payload):
                    nonlocal count
                    count+=1
                    if count==fail_step: raise OSError('injected disk failure')
                    return real(path,payload)
                with patch.object(release.quality,'atomic_write',side_effect=fail):
                    with self.assertRaises(OSError):self.install()
                self.assertEqual((self.data/'release-manifest.json').read_bytes(),old_bytes)
                self.install();release.verify_site(self.data)

    def test_manifest_switch_failure_old_release_remains_readable(self):
        old=self.install(); old_content=(self.data.parent/old['data_path']).read_bytes()
        self.next();real=release.quality.atomic_write
        def fail(path,payload):
            if Path(path).name=='release-manifest.json':raise OSError('manifest rename failed')
            return real(path,payload)
        with patch.object(release.quality,'atomic_write',side_effect=fail):
            with self.assertRaises(OSError):self.install()
        self.assertEqual(json.loads((self.data/'release-manifest.json').read_bytes()),old)
        release.verify_payload(old,old_content)
        with self.assertRaises(ValueError):release.verify_site(self.data)
        self.install();release.verify_site(self.data)

    def test_atomic_rename_failure_retains_existing_pointer(self):
        self.install();before=(self.data/'release-manifest.json').read_bytes()
        with patch.object(release.quality.os,'replace',side_effect=OSError('rename failed')):
            with self.assertRaises(OSError):release.quality.atomic_write(self.data/'release-manifest.json',b'bad')
        self.assertEqual((self.data/'release-manifest.json').read_bytes(),before)

    def test_stale_candidate_cannot_roll_back_current_selection(self):
        self.install();old=self.candidate.read_bytes();self.next();self.candidate.write_bytes(old)
        with self.assertRaises(ValueError):self.install()

    def test_modified_candidate_or_generation_rejected(self):
        before=self.candidate.read_bytes()
        self.candidate.write_bytes(before+b' ')
        with self.assertRaises(ValueError):self.install()
        self.candidate.write_bytes(before)
        key=(self.store/'current').read_text().strip()
        path=self.store/'generations'/key/'result.json'
        result=json.loads(path.read_bytes());result['last_known_good']['topnews']['items'][0]['verified']='needs_review'
        path.write_bytes(pub.encode(result))
        with self.assertRaises(ValueError):self.install()

    def test_legacy_snapshot_cannot_mint_manifest(self):
        with self.assertRaises(ValueError):release.manifest_for(b'{"data":{}}')
        self.candidate.write_bytes(b'{"data":{}}')
        with self.assertRaises(ValueError):self.install()

    def test_missing_and_malformed_manifest_build_contract(self):
        self.data.mkdir(parents=True)
        self.assertIsNone(release.verify_site(self.data))
        (self.data/'release-manifest.json').write_text('{bad')
        with self.assertRaises(ValueError):release.verify_site(self.data)

    def test_corrupt_blob_is_never_overwritten_or_accepted(self):
        m=self.install();blob=self.data.parent/m['data_path'];blob.write_bytes(b'corrupt')
        with self.assertRaises(ValueError):self.install()
        with self.assertRaises(ValueError):release.verify_site(self.data)
        self.assertEqual(blob.read_bytes(),b'corrupt')

    def test_wrong_latest_and_wrong_manifest_rejected(self):
        old=self.install();self.next();new=self.install()
        (self.data/'release-manifest.json').write_bytes(pub.encode(old))
        with self.assertRaises(ValueError):release.verify_site(self.data)
        (self.data/'release-manifest.json').write_bytes(pub.encode(new))
        (self.data/'latest.json').write_bytes(b'{}')
        with self.assertRaises(ValueError):release.verify_site(self.data)

    def test_symlink_and_path_traversal_rejected(self):
        m=self.install();blob=self.data.parent/m['data_path'];blob.unlink();blob.symlink_to(self.candidate)
        with self.assertRaises(ValueError):self.install()
        with self.assertRaises(ValueError):release.verify_site(self.data)
        bad={**m,'data_path':'data/releases/../../store/current'}
        with self.assertRaises(ValueError):release.validate_manifest(bad)

    def test_quality_metadata_and_keys_preserved_byte_for_byte(self):
        self.install()
        self.assertEqual((self.data/'latest.json').read_bytes(),self.candidate.read_bytes())
        self.assertEqual(json.loads(self.candidate.read_bytes()),self.result['published'])

    def test_allowlist_build_for_release_and_legacy_and_mixed_failure(self):
        self.install();site=self.data.parent
        for name in ('scripts','schemas','assets','cloudflare'):
            shutil.copytree(ROOT/name,site/name,ignore=shutil.ignore_patterns('__pycache__','tests'))
        shutil.copyfile(ROOT/'index.html',site/'index.html')
        for name,doc in [('health',{}),('index',[]),('skills',{'items':[]})]:
            (self.data/(name+'.json')).write_text(json.dumps(doc))
        (self.data/'private-quarantine.json').write_text('{"private":true}')
        def build():return subprocess.run(['node','scripts/build-site.mjs'],cwd=site,capture_output=True,text=True)
        result=build();self.assertEqual(result.returncode,0,result.stderr)
        release.verify_site(site/'dist/data')
        for name in ('scripts','docs','schemas','.git','data/private-quarantine.json'):
            self.assertFalse((site/'dist'/name).exists())
        (self.data/'latest.json').write_text('{}')
        self.assertNotEqual(build().returncode,0)
        (self.data/'release-manifest.json').unlink()
        self.assertEqual(build().returncode,0)
        self.assertFalse((site/'dist/data/releases').exists())

    def test_http_python_release_is_verified_by_real_js_bytes(self):
        self.install();site=self.data.parent
        (site/'assets/js').mkdir(parents=True)
        shutil.copyfile(ROOT/'assets/js/data.js',site/'assets/js/data.js')
        shutil.copyfile(ROOT/'index.html',site/'index.html')
        class QuietHandler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *args): pass
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(site)))
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        js="""
const vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto').webcrypto;
const base=process.argv[1],calls=[],storage=new Map();
(async()=>{
for(const p of ['index.html','data/latest.json'])assert.equal((await fetch(base+p)).status,200);
const script=await (await fetch(base+'assets/js/data.js')).text();
const c=vm.createContext({crypto,TextEncoder,TextDecoder,DOMException,AbortController,setTimeout,clearTimeout,console,
 localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
 fetch:async(url,opts)=>{calls.push(url);return fetch(base+url,opts);}});
vm.runInContext(script,c);
const first=await vm.runInContext('readLatestRelease()',c),second=await vm.runInContext('readLatestRelease()',c);
assert.equal(first.status,'verified');assert.equal(second.manifest.release_id,first.manifest.release_id);
assert.equal(calls.filter(p=>p.startsWith('data/releases/')).length,1);
assert.equal(calls.filter(p=>p.startsWith('data/release-manifest')).length,2);
assert.equal(calls.filter(p=>p.startsWith('data/latest.json')).length,0);
})().catch(e=>{console.error(e);process.exitCode=1;});
"""
        try:
            result=subprocess.run(['node','-e',js,f'http://127.0.0.1:{server.server_port}/'],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        finally:
            server.shutdown();server.server_close();thread.join()

    def test_node_release_suite_in_existing_ci_discovery(self):
        result=subprocess.run(['node','--test','scripts/tests/release-data.test.mjs'],cwd=ROOT,capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)


if __name__=='__main__':unittest.main()
