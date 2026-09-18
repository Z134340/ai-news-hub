"""Offline behavioral regressions. Git remotes are temporary local directories only."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from datetime import datetime, timedelta, timezone

ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True

def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod

validate = module('validate', 'validate.py')
publisher = module('publisher', 'publish-daily.py')

class ValidationTests(unittest.TestCase):
    def item(self, days=0, **extra):
        today = datetime.now(timezone(timedelta(hours=8))).date()
        return {'title':'A real research release', 'source':'example', 'summary':'Useful technical details', 'date':(today-timedelta(days=days)).isoformat(), 'url':'https://example.com/a', **extra}

    def run_validation(self, items, response=(True,'ok',1.0)):
        data = {'topnews':items}
        with patch.object(validate,'check_url_and_title',return_value=response) as check:
            result = validate.validate_items(data)
        return data, result, check

    def test_missing_fields_and_old_date_cannot_be_overwritten_by_url_success(self):
        items = [self.item(summary=None), self.item(source=''), self.item(days=3), self.item(url=['x']), None]
        data,result,check = self.run_validation(items)
        self.assertEqual(data['topnews'],[]); self.assertEqual(result['verified'],0)
        self.assertEqual(result['removed'],5); check.assert_not_called()

    def test_mixed_batch_isolated(self):
        data,result,_ = self.run_validation([None,self.item()])
        self.assertEqual(len(data['topnews']),1); self.assertEqual(result['verified'],1)
        self.assertEqual(result['total_items'],2)

    def test_calendar_boundaries(self):
        for days, expected in [(0,1),(1,1),(2,0),(-1,0)]:
            with self.subTest(days=days):
                _,result,_=self.run_validation([self.item(days)])
                self.assertEqual(result['verified'],expected)
        self.assertTrue(validate.validate_date(self.item(-10)['date'],allow_future=True)[0])
        self.assertFalse(validate.validate_date('2026-9-1')[0])

    def test_needs_review_is_not_verified(self):
        data,result,_=self.run_validation([self.item()],(None,'blocked_403',0.0))
        self.assertEqual(result['verified'],0);self.assertEqual(result['needs_review'],1)
        self.assertEqual(data['topnews'][0]['verified'],'needs_review')

    def test_bad_category_container_is_explicit_failure(self):
        for value in [None,[],{'topnews':None},{'unknown':[]}]:
            with self.assertRaises(ValueError): validate.validate_items(value)

    def test_authors_array_is_valid(self):
        item=self.item();item['authors']=['Author A','Author B']
        self.assertTrue(validate.validate_required_fields(item,'papers')[0])

    def test_malformed_optional_model_titles_are_isolated(self):
        valid = {'model_name':'Model Alpha','version':'1','institution':'OpenAI',
                 'release_date':self.item()['date'],'release_status':'ga','domain':'general',
                 'modalities':['text'],'summary':'details','advantages':['fast'],
                 'capabilities':['reasoning'],'access_channels':['API'],'context_window':None,
                 'pricing':None,'license':None,'benchmarks':[],'highlights':['released'],
                 'limitations':['official limits'],'analysis':'impact',
                 'url':'https://openai.com/model','evidence_urls':[]}
        for title in [['bad'],{'bad':True},42]:
            data={'models':[valid.copy(),{**valid,'model_name':'Model Beta','title':title,'url':'https://openai.com/beta'}]}
            with patch.object(validate,'check_url_and_title',return_value=(True,'ok',1.0)):
                result=validate.validate_items(data)
            self.assertEqual(len(data['models']),1);self.assertEqual(result['removed'],1)

    def test_enterprise_ecosystem_requires_official_sources_and_valid_enums(self):
        date=self.item()['date']
        good={'title':'Official update','company':'OpenAI','date':date,'event_type':'api',
              'summary':'details','highlights':['confirmed change'],'analysis':'impact',
              'url':'https://openai.com/index/update','evidence_urls':[]}
        data={'official_info':[good,{**good,'title':'Media copy','url':'https://example.com/copy'}]}
        with patch.object(validate,'check_url_and_title',return_value=(True,'ok',1.0)):
            result=validate.validate_items(data)
        self.assertEqual(len(data['official_info']),1)
        self.assertEqual(result['removed'],1)
        self.assertTrue(validate.check_official_ai_domain('https://platform.openai.com/docs/models')[0])

    def test_enterprise_ecosystem_rejects_company_domain_mismatch(self):
        date=self.item()['date']
        item={'title':'Claimed Anthropic update','company':'Anthropic','date':date,
              'event_type':'product','summary':'details','highlights':['confirmed'],
              'analysis':'impact','url':'https://openai.com/news/other','evidence_urls':[]}
        data={'official_info':[item]}
        with patch.object(validate,'check_url_and_title',return_value=(True,'ok',1.0)):
            result=validate.validate_items(data)
        self.assertEqual(data['official_info'],[])
        self.assertEqual(result['removed'],1)

    def test_input_failure_and_dry_run_preserve_files(self):
        with tempfile.TemporaryDirectory() as td:
            source=Path(td)/'candidate.json';source.write_text(json.dumps({'data':{'topnews':[self.item()]}}))
            original=source.read_bytes()
            with patch.object(sys,'argv',['validate','--input',str(source),'--dry-run']), patch.object(validate,'check_url_and_title',return_value=(True,'ok',1.0)), patch.object(validate,'write_validation_report') as report:
                self.assertEqual(validate.main(),0);report.assert_not_called()
            self.assertEqual(source.read_bytes(),original)
            source.write_text('null')
            with patch.object(sys,'argv',['validate','--input',str(source)]): self.assertEqual(validate.main(),1)

class PublishTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.base=Path(self.tmp.name);self.remote=self.base/'origin.git';self.local=self.base/'local';self.other=self.base/'other'
        self.git(self.base,'init','--bare',str(self.remote))
        self.git(self.base,'clone',str(self.remote),str(self.local))
        self.git(self.local,'checkout','-b','main');self.identity(self.local)
        (self.local/'data').mkdir();(self.local/'data/latest.json').write_text('old news\n')
        (self.local/'app.js').write_text('old code\n');(self.local/'data/old.json').write_text('archive\n')
        self.git(self.local,'add','.');self.git(self.local,'commit','-m','base');self.git(self.local,'push','origin','main')
        self.git(self.base,'clone','-b','main',str(self.remote),str(self.other));self.identity(self.other)
        self.start=self.git(self.local,'rev-parse','HEAD').stdout.strip()

    def git(self, root, *args):
        p=subprocess.run(['git','-C',str(root),*args],text=True,capture_output=True)
        if p.returncode: raise AssertionError(p.stderr)
        return p

    def identity(self,root):
        self.git(root,'config','user.name','Offline test');self.git(root,'config','user.email','test@example.invalid')

    def commit_other(self):
        self.git(self.other,'add','-A');self.git(self.other,'commit','-m','concurrent');self.git(self.other,'push','origin','main')

    def publish(self):return publisher.publish(self.local,self.start,'daily fixture')

    def test_remote_code_and_file_deletions_preserved_with_daily_archive_changes(self):
        (self.other/'app.js').write_text('fixed code\n');(self.other/'new.js').write_text('new code\n');self.commit_other()
        (self.local/'data/latest.json').write_text('new news\n');(self.local/'data/new.json').write_text('new archive\n');(self.local/'data/old.json').unlink()
        result=self.publish();self.assertEqual(result['status'],'pushed')
        self.assertEqual((self.local/'app.js').read_text(),'fixed code\n');self.assertTrue((self.local/'new.js').exists())
        self.assertFalse((self.local/'data/old.json').exists());self.assertTrue((self.local/'data/new.json').exists())
        self.assertEqual(self.git(self.local,'status','--porcelain').stdout,'')

    def test_conflict_preserves_both_commits(self):
        (self.other/'data/latest.json').write_text('remote news\n');self.commit_other()
        (self.local/'data/latest.json').write_text('local news\n')
        with self.assertRaisesRegex(publisher.PublishError,'conflict'):self.publish()
        self.assertEqual((self.local/'data/latest.json').read_text(),'local news\n')
        self.assertEqual(self.git(self.local,'show','origin/main:data/latest.json').stdout,'remote news\n')

    def test_existing_index_untouched(self):
        (self.local/'app.js').write_text('developer work\n');self.git(self.local,'add','app.js')
        before=self.git(self.local,'diff','--cached').stdout
        with self.assertRaisesRegex(publisher.PublishError,'index'):self.publish()
        self.assertEqual(self.git(self.local,'diff','--cached').stdout,before)

    def test_detached_refused(self):
        self.git(self.local,'checkout','--detach')
        with self.assertRaisesRegex(publisher.PublishError,'requires main'):self.publish()
        self.assertEqual(self.git(self.local,'rev-parse','HEAD').stdout.strip(),self.start)

    def test_manifest_cannot_stage_unapproved_path(self):
        preview=self.local/'data/agent/.preview';preview.mkdir(parents=True)
        (preview/'apply-change-staged.txt').write_text('scripts/run-daily.sh\n')
        with self.assertRaisesRegex(publisher.PublishError,'allowlist'):self.publish()
        self.assertEqual(self.git(self.local,'diff','--cached').stdout,'')

    def test_push_failure_returns_error_preserves_candidate(self):
        hook=self.remote/'hooks/pre-receive';hook.write_text('#!/bin/sh\nexit 1\n');hook.chmod(0o755)
        (self.local/'data/latest.json').write_text('new news\n')
        with self.assertRaisesRegex(publisher.PublishError,'push failed'):self.publish()
        self.assertNotEqual(self.git(self.local,'rev-parse','HEAD').stdout.strip(),self.start)
        self.assertEqual(self.git(self.other,'rev-parse','HEAD').stdout.strip(),self.start)

    def test_failed_push_receipt_allows_safe_second_run(self):
        hook=self.remote/'hooks/pre-receive';hook.write_text('#!/bin/sh\nexit 1\n');hook.chmod(0o755)
        (self.local/'data/latest.json').write_text('new news\n')
        try:
            self.publish()
            self.fail('push should fail')
        except publisher.PublishError as error:
            receipt={'status':'failed','candidate':error.candidate,'retryable':error.retryable}
        self.assertTrue(receipt['retryable']);hook.unlink()
        (self.other/'app.js').write_text('fix during outage\n');self.commit_other()
        result=publisher.retry_pending(self.local,receipt)
        self.assertEqual(result['status'],'pushed')
        self.assertEqual((self.local/'app.js').read_text(),'fix during outage\n')
        self.assertEqual(self.git(self.local,'status','--porcelain').stdout,'')

    def test_retry_refuses_unrelated_changes(self):
        (self.local/'app.js').write_text('unrelated\n')
        with self.assertRaisesRegex(publisher.PublishError,'review required'):
            publisher.retry_pending(self.local,{'status':'failed','candidate':self.start,'retryable':True})

    def test_commit_failure_is_not_success(self):
        hook=self.local/'.git/hooks/pre-commit';hook.write_text('#!/bin/sh\nexit 1\n');hook.chmod(0o755)
        (self.local/'data/latest.json').write_text('new news\n')
        with self.assertRaisesRegex(publisher.PublishError,'commit'):self.publish()

    def test_fetch_failure_is_not_success(self):
        self.git(self.local,'remote','set-url','origin',str(self.base/'absent'))
        with self.assertRaisesRegex(publisher.PublishError,'fetch'):self.publish()

    def test_noop_synchronizes_remote_without_reverse_diff(self):
        (self.other/'app.js').unlink();self.commit_other()
        self.assertEqual(self.publish()['status'],'unchanged');self.assertFalse((self.local/'app.js').exists())

    def test_push_race_retries_three_way_integration(self):
        real_git=publisher.git;first=True
        def racing_git(root,*args,**kwargs):
            nonlocal first
            if args[0]=='push' and first:
                first=False;(self.other/'app.js').write_text('concurrent fix\n');self.commit_other()
            return real_git(root,*args,**kwargs)
        (self.local/'data/latest.json').write_text('new news\n')
        with patch.object(publisher,'git',side_effect=racing_git):self.publish()
        self.assertEqual((self.local/'app.js').read_text(),'concurrent fix\n')

class LockTests(unittest.TestCase):
    def test_stubborn_main_child_is_killed_after_signal(self):
        with tempfile.TemporaryDirectory() as td:
            lock=Path(td)/'daily.lock';ready=Path(td)/'ready'
            command=[sys.executable,str(ROOT/'scripts/run-locked.py'),str(lock)]
            source=f"import signal,time;from pathlib import Path;signal.signal(signal.SIGTERM,signal.SIG_IGN);Path({str(ready)!r}).touch();time.sleep(30)"
            first=subprocess.Popen([*command,sys.executable,'-c',source])
            try:
                deadline=time.monotonic()+5
                while not ready.exists() and time.monotonic()<deadline:time.sleep(.02)
                self.assertTrue(ready.exists())
                first.terminate()
                self.assertEqual(first.wait(timeout=5),143)
                self.assertEqual(subprocess.run([*command,sys.executable,'-c','pass']).returncode,0)
            finally:
                if first.poll() is None:first.kill();first.wait()

    def test_stubborn_worker_stops_before_next_run(self):
        with tempfile.TemporaryDirectory() as td:
            lock=Path(td)/'daily.lock';marker=Path(td)/'ticks';ready=Path(td)/'ready'
            worker=Path(td)/'worker.py'
            worker.write_text("import signal,time\nfrom pathlib import Path\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\nPath("+repr(str(ready))+").touch()\nwhile True:\n with open("+repr(str(marker))+",'a') as f:f.write('x')\n time.sleep(.02)\n")
            launcher=Path(td)/'launcher.py'
            launcher.write_text("import subprocess,sys,time\nfrom pathlib import Path\nsubprocess.Popen([sys.executable,"+repr(str(worker))+"])\nwhile not Path("+repr(str(ready))+").exists():time.sleep(.01)\n")
            command=[sys.executable,str(ROOT/'scripts/run-locked.py'),str(lock)]
            first=subprocess.Popen([*command,sys.executable,str(launcher)])
            self.addCleanup(lambda: first.poll() is None and first.kill())
            deadline=time.monotonic()+5
            while not ready.exists() and time.monotonic()<deadline:time.sleep(.02)
            self.assertTrue(ready.exists())
            self.assertEqual(subprocess.run([*command,sys.executable,'-c','pass']).returncode,75)
            self.assertEqual(first.wait(timeout=5),0)
            size=marker.stat().st_size;time.sleep(.15);self.assertEqual(marker.stat().st_size,size)
            self.assertEqual(subprocess.run([*command,sys.executable,'-c','pass']).returncode,0)

    def test_concurrency_signal_cleanup_and_reacquire(self):
        with tempfile.TemporaryDirectory() as td:
            lock=Path(td)/'daily.lock';ready=Path(td)/'ready'
            command=[sys.executable,str(ROOT/'scripts/run-locked.py'),str(lock)]
            child=subprocess.Popen([*command,sys.executable,'-c',f"from pathlib import Path;import time;Path({str(ready)!r}).touch();time.sleep(30)"])
            try:
                deadline=time.monotonic()+5
                while not ready.exists() and time.monotonic()<deadline:time.sleep(.02)
                self.assertTrue(ready.exists())
                second=subprocess.run([*command,sys.executable,'-c','pass'])
                self.assertEqual(second.returncode,75)
                child.send_signal(signal.SIGTERM);self.assertEqual(child.wait(timeout=5),143)
                self.assertEqual(lock.read_text(),'')
                self.assertEqual(subprocess.run([*command,sys.executable,'-c','raise SystemExit(7)']).returncode,7)
                self.assertEqual(lock.read_text(),'')
            finally:
                if child.poll() is None:child.kill();child.wait()

class DailyFlowTests(unittest.TestCase):
    def test_failed_validator_preserves_latest_and_stops_before_archive(self):
        source=(ROOT/'scripts/run-daily.sh').read_text()
        flow=source[source.index('# ── 合併 latest.json'):source.index('# ── 冷封存：')]
        with tempfile.TemporaryDirectory() as td:
            base=Path(td);data=base/'data';data.mkdir();scripts=base/'scripts';scripts.mkdir()
            old=json.dumps({'data':{'models':[]},'_updated_at':{}})
            (data/'latest.json').write_text(old)
            (scripts/'validate.py').write_text('raise SystemExit(1)')
            script=base/'flow.sh'
            script.write_text('set -uo pipefail\nlog(){ :; }\nupdate_health_json(){ :; }\n'+flow+'\ntouch reached_end\n')
            result=subprocess.run(['bash',str(script)],cwd=base,env={**os.environ,'DATA_DIR':str(data),'SCRIPTS_DIR':str(scripts),'TODAY':'2026-09-18','LATEST_CANDIDATE':str(base/'candidate.json')},capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertEqual((data/'latest.json').read_text(),old)
            self.assertFalse((data/'2026-09-18.json').exists());self.assertFalse((base/'reached_end').exists())

    def test_preflight_failure_writes_only_off_repo_state(self):
        source=(ROOT/'scripts/run-daily.sh').read_text()
        function=source[source.index('update_health_json()'):source.index('# ── 啟動 ──')]
        with tempfile.TemporaryDirectory() as td:
            base=Path(td);data=base/'data';data.mkdir();(data/'health.json').write_text('original')
            # Redirect only the off-repo output location; do not change the process HOME.
            function=function.replace('$HOME/.ai-news-hub/publication','$TEST_STATE')
            script=base/'health.sh';script.write_text(function+'\nupdate_health_json failed offline\n')
            result=subprocess.run(['bash',str(script)],cwd=base,env={**os.environ,'DATA_DIR':str(data),'TEST_STATE':str(base/'state')},capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual((data/'health.json').read_text(),'original')
            self.assertEqual(json.loads((base/'state/local-health.json').read_text())['status'],'failed')

if __name__ == '__main__':unittest.main()
