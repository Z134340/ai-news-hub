"""AH-02 quality, persistence, and daily seams. All writes use temporary roots."""
import base64
from copy import deepcopy
from datetime import datetime, timezone, timedelta
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from contracts.category_quality import decide, digest, reliable, check_policy
from contracts.data_v2 import CATEGORIES, stable_item_id, canonical_url, prepare_item
from contracts.schema import errors, load_schema
import validate


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


pub = module('category_publication', 'category-publication.py')
extract = module('extract_json_quality', 'extract-json.py')
POLICY = pub.read_json(pub.POLICY)
AT = datetime.now(timezone(timedelta(hours=8))).replace(hour=9, minute=0, second=0, microsecond=0).isoformat()
NEXT = (datetime.fromisoformat(AT) + timedelta(hours=1)).isoformat()
LATER = (datetime.fromisoformat(AT) + timedelta(hours=2)).isoformat()
FIXTURE = pub.read_json(ROOT / 'scripts/tests/fixtures/data-contract/valid-v2.json')
MIXED_FIXTURE = pub.read_json(ROOT / 'scripts/tests/fixtures/category-quality/mixed-batch.json')


def item(cat, suffix='one'):
    row = deepcopy(FIXTURE['data'][cat if cat in FIXTURE['data'] else 'topnews'][0])
    row['url'] = ('https://openai.com/' if cat in ('models', 'official_info') else 'https://example.com/') + cat + '/' + suffix
    row.update(canonical_url=canonical_url(row['url']), item_id=stable_item_id(row['url']),
               verified=True, complete=True, url_status='verified', verified_at=AT, review_reasons=[])
    row['release_date' if cat == 'models' else 'date'] = AT[:10]
    if cat == 'papers': row['authors'] = ['Fixture author']
    if cat == 'skills': row['stars'] = 10
    return row


def candidates():
    return {cat: {'status': 'success', 'items': [item(cat)],
                  'source_location': f'/fixture/{cat}.json', 'original': [item(cat)]} for cat in CATEGORIES}


def old_state():
    return decide(candidates(), {}, AT, POLICY)['last_known_good']


def fake_validate(data, **kwargs):
    """Exercise the real validator with only its network and pacing stubbed."""
    with patch.object(validate, 'check_url_and_title', return_value=(True, 'verified', 1.0)), patch.object(validate.time, 'sleep'):
        return validate.validate_items(data, **kwargs)


class CategoryDecisions(unittest.TestCase):
    def test_all_categories_pass_independently(self):
        result = decide(candidates(), {}, AT, POLICY)
        self.assertEqual(set(result['last_known_good']), set(CATEGORIES))
        self.assertTrue(all(v == {'attempt':'updated','serving':'current'} for v in result['published']['_update_outcome'].values()))
        self.assertEqual(result['quarantine'], [])

    def test_one_failed_category_retains_other_categories_advance(self):
        old = old_state(); incoming = candidates()
        incoming['courses']['status'] = 'fetch_failed'
        incoming['topnews']['items'][0]['summary'] = 'New fixture summary'
        result = decide(incoming, old, NEXT, POLICY)['published']
        self.assertEqual(result['data']['courses'], old['courses']['items'])
        self.assertEqual(result['_updated_at']['courses'], AT)
        self.assertEqual(result['_checked_at']['courses'], NEXT)
        self.assertEqual(result['_update_outcome']['courses'], {'attempt':'fetch_failed','serving':'last_known_good'})
        self.assertEqual(result['_update_outcome']['topnews']['attempt'], 'updated')
        self.assertEqual(result['_updated_at']['topnews'], NEXT)

    def test_mixed_fixture_updates_fails_and_nochanges_independently(self):
        old = old_state()
        incoming = candidates()
        updated = MIXED_FIXTURE['updated']
        failed = MIXED_FIXTURE['failed']
        no_change = MIXED_FIXTURE['no_change']
        incoming[updated['category']]['items'][0]['summary'] = updated['summary']
        incoming[failed['category']] = {
            'status': failed['status'],
            'reasons': [failed['reason']],
            'source_location': f"/fixture/{failed['category']}.json",
            'original': {'transport': 'timeout'},
        }
        incoming[no_change['category']] = {
            'status': no_change['status'],
            'items': no_change['items'],
            'source_location': f"/fixture/{no_change['category']}.json",
            'original': [],
        }

        result = decide(incoming, old, NEXT, POLICY)
        published = result['published']
        self.assertEqual(published['_update_outcome'][updated['category']],
                         {'attempt': 'updated', 'serving': 'current'})
        self.assertEqual(published['_update_outcome'][failed['category']],
                         {'attempt': 'fetch_failed', 'serving': 'last_known_good'})
        self.assertEqual(published['_update_outcome'][no_change['category']],
                         {'attempt': 'no_change', 'serving': 'last_known_good'})
        self.assertEqual(published['data'][failed['category']], old[failed['category']]['items'])
        self.assertEqual(published['data'][no_change['category']], old[no_change['category']]['items'])
        self.assertEqual(published['_updated_at'][failed['category']], AT)
        self.assertEqual(published['_updated_at'][no_change['category']], AT)
        self.assertEqual(published['_updated_at'][updated['category']], NEXT)
        self.assertEqual(result['quarantine'][0]['category'], failed['category'])
        self.assertEqual(result['quarantine'][0]['original'], {'transport': 'timeout'})
        self.assertIn(failed['reason'], result['quarantine'][0]['reasons'])

    def test_all_fail_retains_exact_previous_payloads(self):
        old = old_state(); incoming = candidates()
        for entry in incoming.values(): entry['status'] = 'fetch_failed'
        result = decide(incoming, old, NEXT, POLICY)
        for cat in CATEGORIES:
            self.assertEqual(result['published']['data'][cat], old[cat]['items'])
            self.assertEqual(result['published']['_updated_at'][cat], AT)
        self.assertEqual(len(result['quarantine']), len(CATEGORIES))

    def test_partial_malformed_rows_fail_whole_category_only(self):
        incoming = candidates(); incoming['china']['items'].append(None)
        result = decide(incoming, old_state(), NEXT, POLICY)
        self.assertEqual(result['published']['_update_outcome']['china']['attempt'], 'validation_failed')
        self.assertEqual(len(result['validated']), len(CATEGORIES)-1)
        self.assertEqual(len(result['published']['data']['china']), 1)

    def test_bad_container_isolated(self):
        incoming = candidates(); incoming['models']['items'] = {'wrong': []}
        result = decide(incoming, {}, AT, POLICY)
        self.assertEqual(result['published']['_update_outcome']['models']['serving'], 'no_reliable_data')
        self.assertEqual(len(result['last_known_good']), len(CATEGORIES)-1)

    def test_no_previous_is_explicit_and_does_not_invent_timestamp(self):
        result = decide({}, {}, AT, POLICY)['published']
        self.assertEqual(sum(result['stats'].values()), 0)
        self.assertEqual(result['_updated_at'], {})
        self.assertTrue(all(v['serving']=='no_reliable_data' for v in result['_update_outcome'].values()))

    def test_corrupt_previous_hash_is_not_a_fallback(self):
        old = old_state(); old['courses']['items'][0]['summary'] = 'corrupt'
        result = decide({'courses': {'status':'fetch_failed'}}, old, NEXT, POLICY)
        self.assertEqual(result['published']['data']['courses'], [])
        self.assertIn('lkg_hash_mismatch', result['report']['courses']['previous_errors'])
        self.assertTrue(result['published']['data']['models'])

    def test_previous_needs_review_even_with_matching_hash_is_not_reliable(self):
        old = old_state(); old['courses']['items'][0]['verified'] = 'needs_review'
        old['courses']['sha256'] = digest(old['courses']['items'])
        result = decide({}, old, NEXT, POLICY)
        self.assertEqual(result['published']['data']['courses'], [])

    def test_legacy_cannot_publish_or_bootstrap_reliable(self):
        incoming = candidates(); row = incoming['models']['items'][0]
        row.update(contract_state='legacy', legacy={'from_version':1,'missing_fields':[]})
        result = decide(incoming, {}, AT, POLICY)
        self.assertEqual(result['published']['data']['models'], [])
        old = old_state(); old['models']['items'] = [row]; old['models']['sha256'] = digest([row])
        self.assertIsNone(reliable(old['models'], 'models', POLICY['categories']['models'], NEXT)[0])

    def test_empty_courses_success_and_failure_are_distinct(self):
        nochange = {'courses': {'status':'no_change','items':[]}}
        success = decide(nochange, old_state(), NEXT, POLICY)['published']
        failed = decide({'courses': {'status':'fetch_failed'}}, old_state(), NEXT, POLICY)['published']
        self.assertEqual(success['_update_outcome']['courses']['attempt'], 'no_change')
        self.assertEqual(failed['_update_outcome']['courses']['attempt'], 'fetch_failed')
        self.assertEqual(success['data']['courses'], failed['data']['courses'])
        self.assertEqual(success['_updated_at']['courses'], AT)
        self.assertEqual(success['_checked_at']['courses'], NEXT)

    def test_nochange_without_previous_remains_unavailable(self):
        result = decide({'courses': {'status':'no_change','items':[]}}, {}, AT, POLICY)['published']
        self.assertEqual(result['_update_outcome']['courses'], {'attempt':'no_change','serving':'no_reliable_data'})
        self.assertNotIn('courses', result['_updated_at'])

    def test_same_content_ignores_verification_clock(self):
        incoming = candidates()
        for e in incoming.values(): e['items'][0]['verified_at'] = NEXT
        result = decide(incoming, old_state(), NEXT, POLICY)['published']
        self.assertTrue(all(v['attempt']=='no_change' for v in result['_update_outcome'].values()))
        self.assertTrue(all(v==AT for v in result['_updated_at'].values()))
        self.assertTrue(all(v==NEXT for v in result['_checked_at'].values()))

    def test_not_scheduled_preserves_failed_attempt_checked_time(self):
        result = decide({}, old_state(), NEXT, POLICY)
        incoming = {cat: {'status':'not_scheduled'} for cat in CATEGORIES}
        result = decide(incoming, result['last_known_good'], LATER, POLICY)['published']
        self.assertEqual(result['_checked_at']['courses'], NEXT)
        self.assertEqual(result['_updated_at']['courses'], AT)

    def test_timestamps_invalid_or_future_previous_refused(self):
        for value in ('yesterday', '2026-01-01T00:00:00'):
            with self.assertRaises(ValueError): decide({}, {}, value, POLICY)
        for field, value in [('updated_at', LATER), ('checked_at', LATER), ('last_checked_at', AT[:10])]:
            old = old_state(); old['courses'][field] = value
            self.assertIsNone(reliable(old['courses'], 'courses', POLICY['categories']['courses'], NEXT)[0])

    def test_verified_bool_and_missing_evidence_are_strict(self):
        for change in ({'verified':'needs_review'},{'verified':1},{'complete':False},
                       {'source_title':None},{'url_status':'verified_no_title'}, {'verified_at':LATER}):
            incoming=candidates(); incoming['topnews']['items'][0].update(change)
            result=decide(incoming, {}, AT, POLICY)
            self.assertEqual(result['published']['data']['topnews'], [])

    def test_official_company_pairing_is_absolute(self):
        incoming=candidates();incoming['models']['items'][0]['evidence_urls']=['https://anthropic.com/other']
        result=decide(incoming,{},AT,POLICY)
        self.assertEqual(result['published']['data']['models'], [])

    def test_candidate_date_window_but_stale_reliable_can_be_retained(self):
        incoming=candidates();incoming['topnews']['items'][0]['date']='2000-01-01'
        result=decide(incoming,{},AT,POLICY)
        self.assertEqual(result['published']['data']['topnews'], [])
        old=old_state(); old['topnews']['items'][0]['date']='2000-01-01';old['topnews']['sha256']=digest(old['topnews']['items'])
        result=decide({},old,NEXT,POLICY)['published']
        self.assertEqual(result['_update_outcome']['topnews']['serving'], 'last_known_good')
        self.assertEqual(result['_updated_at']['topnews'], AT)

    def test_policy_explicit_and_cannot_weaken_integrity(self):
        for change in ({'min_items':0},{'min_verified_ratio':0.9},{'max_hard_errors':1},{'reason':''}):
            p=deepcopy(POLICY);p['categories']['courses'].update(change)
            with self.assertRaises(ValueError):check_policy(p)
        p=deepcopy(POLICY);del p['categories']['courses']
        with self.assertRaises(ValueError):check_policy(p)

    def test_metadata_schema_positive_and_negative(self):
        d=decide(candidates(),{},AT,POLICY)['published']
        self.assertEqual(errors(d,load_schema('latest.schema.json')),[])
        for field,value in [('_checked_at',{'courses':'yesterday'}),('_update_outcome',{'courses':{'attempt':'success','serving':'current'}})]:
            bad={**d,field:value}
            self.assertTrue(errors(bad,load_schema('latest.schema.json')))

    def test_quarantine_preserves_original_and_source_without_mutation(self):
        incoming=candidates();incoming['courses']['items'].append(None)
        incoming['courses']['original']={'items':[None,{'private_raw':'fixture'}]}
        before=deepcopy(incoming)
        result=decide(incoming,{},AT,POLICY)
        q=result['quarantine'][0]
        self.assertEqual(q['original'],before['courses']['original'])
        self.assertEqual(q['source_location'],'/fixture/courses.json')
        self.assertEqual(incoming,before)


class StorageAndAdapter(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.store=self.root/'private';self.output=self.root/'selected.json'

    def publish(self, incoming=None, at=AT, validator=fake_validate):
        return pub.publish(incoming if incoming is not None else candidates(),self.store,self.output,at,POLICY,validator)

    def test_real_validator_adapter_all_categories_and_isolated_failure(self):
        self.publish();incoming=candidates();incoming['models']['items'].append(None)
        result=self.publish(incoming,NEXT)
        self.assertEqual(result['published']['_update_outcome']['models']['attempt'],'validation_failed')
        self.assertEqual(len(result['last_known_good']),len(CATEGORIES))
        self.assertEqual(result['quarantine'][0]['original'],incoming['models']['original'])

    def test_write_failure_before_pointer_leaves_previous_bytes(self):
        self.publish();before=(self.store/'current').read_bytes()
        oldgen=self.store/'generations'/before.decode().strip()/'result.json';oldbytes=oldgen.read_bytes()
        actual=pub.atomic_write
        def fail(path,payload):
            if Path(path)==self.store/'current':raise OSError('injected disk failure')
            return actual(path,payload)
        incoming=candidates();incoming['topnews']['items'][0]['summary']='new'
        with patch.object(pub,'atomic_write',side_effect=fail),self.assertRaises(OSError):self.publish(incoming,NEXT)
        self.assertEqual((self.store/'current').read_bytes(),before)
        self.assertEqual(oldgen.read_bytes(),oldbytes)
        result=self.publish(incoming,NEXT)
        self.assertEqual(result['published']['_update_outcome']['topnews']['attempt'],'updated')

    def test_output_failure_does_not_commit_store(self):
        self.publish();before=(self.store/'current').read_bytes()
        writer=pub.atomic_write
        def fail(path,payload):
            if Path(path)==self.output:raise OSError('disk')
            return writer(path,payload)
        with patch.object(pub,'atomic_write',side_effect=fail),self.assertRaises(OSError):self.publish(at=NEXT)
        self.assertEqual((self.store/'current').read_bytes(),before)

    def test_identical_retry_skips_validation_and_keeps_exact_bytes(self):
        a=self.publish();snapshot=self.output.read_bytes()
        with patch.object(pub.validate,'validate_items',side_effect=AssertionError('unexpected network')):
            b=self.publish(validator=lambda *_a,**_k: (_ for _ in ()).throw(AssertionError('must not validate retry')))
        self.assertEqual(a,b);self.assertEqual(self.output.read_bytes(),snapshot)
        self.assertEqual(len(list((self.store/'generations').glob('[!.]*'))),1)

    def test_corrupt_saved_retry_cannot_publish_false_updated_timestamp(self):
        self.publish();key=(self.store/'current').read_text().strip()
        file=self.store/'generations'/key/'result.json'
        document=pub.read_json(file);document['published']['_updated_at']['courses']=NEXT
        file.write_text(json.dumps(document))
        before=self.output.read_bytes()
        with self.assertRaises(ValueError):self.publish()
        self.assertEqual(self.output.read_bytes(),before)

    def test_interrupted_retry_cannot_revert_intervening_category_update(self):
        self.publish();writer=pub.atomic_write
        def fail(path,payload):
            if Path(path)==self.store/'current':raise OSError('fixture pointer failure')
            return writer(path,payload)
        incoming=candidates();incoming['courses']['status']='fetch_failed'
        with patch.object(pub,'atomic_write',side_effect=fail),self.assertRaises(OSError):self.publish(incoming,NEXT)
        middle=candidates();middle['courses']['items'][0]['summary']='intervening reliable update'
        middle_time=(datetime.fromisoformat(AT)+timedelta(minutes=30)).isoformat()
        self.publish(middle,middle_time)
        before=(self.store/'current').read_bytes()
        with self.assertRaisesRegex(ValueError,'changed base'):self.publish(incoming,NEXT)
        self.assertEqual((self.store/'current').read_bytes(),before)
        self.assertEqual(pub.read_json(self.output)['data']['courses'][0]['summary'],'intervening reliable update')

    def test_stale_or_same_clock_different_input_cannot_rollback(self):
        self.publish();self.publish(at=NEXT)
        with self.assertRaises(ValueError):self.publish()
        incoming=candidates();incoming['courses']['status']='fetch_failed'
        with self.assertRaises(ValueError):self.publish(incoming,NEXT)

    def test_corrupt_store_explicit_no_reliable_data(self):
        self.publish();key=(self.store/'current').read_text().strip()
        (self.store/'generations'/key/'result.json').write_text('{broken')
        incoming={c:{'status':'fetch_failed'} for c in CATEGORIES}
        result=self.publish(incoming,NEXT)
        self.assertTrue(result['state_errors'])
        self.assertEqual(result['last_known_good'],{})
        self.assertEqual(sum(result['published']['stats'].values()),0)

    def test_no_lkg_checked_history_survives_not_scheduled(self):
        for status in ('fetch_failed','no_change'):
            with self.subTest(status=status):
                incoming={'courses':{'status':status,'items':[]}}
                self.store=self.root/status
                first=self.publish(incoming)
                self.assertEqual(first['published']['_checked_at']['courses'],AT)
                second=self.publish({'courses':{'status':'not_scheduled'}},NEXT)
                self.assertEqual(second['published']['_checked_at']['courses'],AT)
                self.assertNotIn('courses',second['published']['_updated_at'])
                self.assertEqual(second['published']['_update_outcome']['courses']['attempt'],'not_scheduled')

    def test_needs_review_cannot_become_lkg_via_adapter(self):
        def review(data,**kw):
            with patch.object(validate,'check_url_and_title',return_value=(None,'needs_review',0)),patch.object(validate.time,'sleep'):
                return validate.validate_items(data,**kw)
        result=self.publish(validator=review)
        self.assertEqual(result['last_known_good'],{})
        self.assertTrue(all(x['attempt']=='validation_failed' for x in result['published']['_update_outcome'].values()))

    def test_new_producer_only_explicit_fields_versioned_current(self):
        row=item('models')
        for k in ('schema_version','contract_state','canonical_url','item_id'):row.pop(k)
        current=pub.fresh_item(row,'models')
        self.assertEqual(current['contract_state'],'current')
        self.assertNotIn('verified',current)
        del row['capabilities']
        self.assertEqual(pub.fresh_item(row,'models')['contract_state'],'legacy')

    def test_explicit_legacy_is_never_promoted_and_validator_counts_zero(self):
        row=item('topnews');row.update(contract_state='legacy',legacy={'from_version':1,'missing_fields':[]})
        data={'topnews':[row]};report=fake_validate(data)
        self.assertEqual(report['verified'],0)
        self.assertEqual(data['topnews'][0]['verified'],'needs_review')
        self.assertEqual(pub.fresh_item(row,'topnews')['contract_state'],'legacy')

    def test_url_failure_quarantine_keeps_original_index_after_schema_reject(self):
        raw=[None,item('topnews')];data={'topnews':deepcopy(raw)}
        with patch.object(validate,'check_url_and_title',return_value=(False,'not_found',0)),patch.object(validate.time,'sleep'):
            report=validate.validate_items(data,schema_version=2)
        self.assertEqual(report['quarantine'][1]['index'],1)
        self.assertEqual(report['quarantine'][1]['original'],raw[1])

    def test_collect_preserves_malformed_bytes_and_every_attempt(self):
        source=self.root/'raw';source.mkdir();status=self.root/'status';status.mkdir()
        raw=b'{broken\xff';(source/'courses.json').write_bytes(raw)
        (source/'courses.attempt1.txt').write_text('fixture failure');(status/'courses').write_text('FAIL')
        d=pub.collect(source,status,['courses'])
        self.assertEqual(base64.b64decode(d['courses']['original']['file_base64']),raw)
        self.assertEqual(len(d['courses']['original']['attempts_base64']),1)
        result=self.publish(d)
        self.assertEqual(result['quarantine'][0]['original'],d['courses']['original'])

    def test_collect_empty_ok_is_nochange_but_missing_fail_are_failed(self):
        source=self.root/'raw';source.mkdir();status=self.root/'status';status.mkdir()
        (source/'courses.json').write_text('[]');(status/'courses').write_text('OK')
        self.assertEqual(pub.collect(source,status,['courses'])['courses']['status'],'no_change')
        (status/'courses').write_text('FAIL')
        self.assertEqual(pub.collect(source,status,['courses'])['courses']['status'],'fetch_failed')
        (status/'courses').unlink()
        self.assertEqual(pub.collect(source,status,['courses'])['courses']['status'],'fetch_failed')

    def test_cumulative_uses_only_reliable_history(self):
        first=self.publish();incoming=candidates();incoming['models']['items']=[item('models','two')]
        second=self.publish(incoming,NEXT)
        self.assertEqual(len(second['published']['data']['models']),2)
        self.assertEqual(second['published']['data']['models'][1]['first_seen'],AT)
        self.assertEqual(first['published']['data']['models'][0]['first_seen'],AT)

    def test_paths_refuse_public_store_output_or_evidence_overwrite(self):
        for store,out,src in [(ROOT/'private',self.output,None),(self.store,ROOT/'data/latest.json',None),
                              (self.store,self.store/'current',None),(self.store,self.root/'raw/input',self.root/'raw')]:
            with self.assertRaises(ValueError):pub.guard_paths(store,out,src)

    def test_scalar_entry_fails_its_category_only(self):
        incoming=candidates();incoming['courses']=None
        result=self.publish(incoming)
        self.assertEqual(result['published']['_update_outcome']['courses']['attempt'],'validation_failed')
        self.assertEqual(len(result['last_known_good']),len(CATEGORIES)-1)

    def test_partial_generation_write_preserves_pointer_and_raw_evidence(self):
        self.publish();before=(self.store/'current').read_bytes()
        writer=pub.atomic_write
        def fail(path,payload):
            if Path(path).name=='quarantine.json':raise OSError('fixture write failure')
            return writer(path,payload)
        with patch.object(pub,'atomic_write',side_effect=fail),self.assertRaises(OSError):self.publish(at=NEXT)
        self.assertEqual((self.store/'current').read_bytes(),before)
        self.assertEqual(len(list((self.store/'attempts').glob('*/candidate.json'))),2)
        self.publish(at=NEXT)
        self.assertNotEqual((self.store/'current').read_bytes(),before)

    def test_cli_failed_fetches_offline_returns_explicit_snapshot(self):
        source=self.root/'raw';source.mkdir();status=self.root/'status';status.mkdir()
        result=subprocess.run([sys.executable,'-B',str(ROOT/'scripts/category-publication.py'),
            '--candidate-dir',str(source),'--status-dir',str(status),'--scheduled','courses',
            '--store',str(self.store),'--output',str(self.output),'--checked-at',AT],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        d=pub.read_json(self.output)
        self.assertEqual(d['_update_outcome']['courses'],{'attempt':'fetch_failed','serving':'no_reliable_data'})

    def test_daily_install_archives_selected_data_and_counts_gate_failures(self):
        # Run the actual shell install/index seam with the actual store + validator
        # adapter, stubbing only network source responses inside the subprocess.
        daily=(ROOT/'scripts/run-daily.sh').read_text()
        # Exercise the real incoming/store path layout, including the isolation
        # guard; replacing only the deployment root keeps all writes temporary.
        setup=daily[daily.index('QUALITY_STORE='):daily.index('CATEGORIES_OK=0')]
        setup=setup.replace('$HOME/.ai-news-hub/publication/category-quality',str(self.store))
        initialized=subprocess.run(['bash','-c',setup+'\nprintf "%s" "$CANDIDATE_DIR"'],
            env={**os.environ,'TODAY':AT[:10]},capture_output=True,text=True,check=True)
        source=Path(initialized.stdout);status=source/'status';status.mkdir()
        for cat in ('topnews','courses'):
            (source/(cat+'.json')).write_text(json.dumps([item(cat)]))
            (status/cat).write_text('OK' if cat=='topnews' else 'FAIL')
        scripts=self.root/'scripts';scripts.mkdir();data=self.root/'data';data.mkdir()
        (data/'courses.json').write_text('legacy category must remain unchanged')
        (data/'latest.json').write_text('{"data":{}}')
        wrapper = """import sys, importlib.util
from unittest.mock import patch
sys.path.insert(0, ROOT_SCRIPTS)
spec=importlib.util.spec_from_file_location('qp', REAL_SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with patch.object(m.validate,'check_url_and_title',return_value=(True,'verified',1.0)),patch.object(m.validate.time,'sleep'):
    raise SystemExit(m.main())
""".replace('ROOT_SCRIPTS',repr(str(ROOT/'scripts'))).replace('REAL_SCRIPT',repr(str(ROOT/'scripts/category-publication.py')))
        (scripts/'category-publication.py').write_text(wrapper)
        daily=(ROOT/'scripts/run-daily.sh').read_text()
        flow=daily[daily.index('# ── 合併 latest.json'):daily.index('# ── 冷封存：')]
        shell=self.root/'flow.sh'
        shell.write_text('set -uo pipefail\nlog(){ :; }\nupdate_health_json(){ :; }\nCATEGORIES=(topnews courses)\n'+flow+'\nprintf "%s %s" "$CATEGORIES_OK" "$CATEGORIES_FAILED" > counts\n')
        env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','DATA_DIR':str(data),'SCRIPTS_DIR':str(scripts),
             'CANDIDATE_DIR':str(source),'STATUS_DIR':str(status),'QUALITY_STORE':str(self.store),
             'LATEST_CANDIDATE':str(self.output),'TODAY':AT[:10]}
        result=subprocess.run(['bash',str(shell)],cwd=self.root,env=env,capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual((self.root/'counts').read_text(),'1 1')
        d=pub.read_json(data/'latest.json')
        self.assertTrue(d['data']['topnews']);self.assertEqual(d['data']['courses'],[])
        self.assertEqual((data/'latest.json').read_bytes(),(data/(AT[:10]+'.json')).read_bytes())
        self.assertEqual((data/'courses.json').read_text(),'legacy category must remain unchanged')
        self.assertEqual(len(pub.read_json(data/'index.json')),1)

    def test_strict_parser_empty_nonempty_and_failed_cases(self):
        for raw in ('{"items": []}','[]','```json\n{"items":[]}\n```'):
            self.assertEqual(extract.strict_items(raw),[])
        self.assertEqual(extract.strict_items('preface {"items":[{"title":"fixture"}]}'),[{'title':'fixture'}])
        for raw in ('','no news found','quota exhausted','{"items":null}','{"items":[}', 'null'):
            with self.assertRaises(ValueError):extract.strict_items(raw)

    def test_parser_cli_signals_failure_not_empty_success(self):
        for raw,code in [('bad JSON',1),('{"items":[]}',0)]:
            result=subprocess.run([sys.executable,'-B',str(ROOT/'scripts/extract-json.py'),'--strict'],input=raw,text=True,capture_output=True)
            self.assertEqual(result.returncode,code)


if __name__=='__main__':unittest.main()
