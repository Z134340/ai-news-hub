"""AH-01 offline contract/migration regressions. All I/O is in temporary directories."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime, timezone, timedelta

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from contracts.data_v2 import (canonical_url, stable_item_id, prepare_item, migrate_document,
                               encoded, MODEL_FIELDS, envelope_errors, source_url)
from contracts.schema import errors, load_schema, check_schema
import validate

FIXTURES = Path(__file__).parent / 'fixtures' / 'data-contract'
def fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding='utf-8'))

def today_item(item):
    item = copy.deepcopy(item)
    item['release_date' if 'model_name' in item else 'date'] = datetime.now(timezone(timedelta(hours=8))).date().isoformat()
    return item

class SchemaTests(unittest.TestCase):
    def test_positive_current_and_offline_schemas(self):
        doc=fixture('valid-v2.json')
        self.assertEqual(errors(doc,load_schema('latest.schema.json')),[])
        for category,rows in doc['data'].items():
            self.assertEqual(prepare_item(rows[0],category)[1],[])
        for file in (ROOT/'schemas/data/v2').glob('*.json'):
            check_schema(load_schema(file.name))

    def test_negative_fixtures(self):
        for case in fixture('invalid-cases.json'):
            with self.subTest(case=case['name']):
                category=case['category'];item=fixture('valid-v2.json')['data'][category][0]
                if 'remove' in case: del item[case['remove']]
                item.update(case.get('set',{}))
                self.assertTrue(prepare_item(item,category)[1])

    def test_root_version_and_containers(self):
        for doc in [None,[],{'data':[]},{'data':{'unknown':[]}},{'data':{'models':{}}},
                    *({'schema_version':v,'data':{'models':[]}} for v in [None,True,'2',3])]:
            with self.subTest(doc=doc):
                with self.assertRaises(ValueError): migrate_document(doc)

    def test_v2_cannot_silently_migrate_unversioned_item(self):
        doc=fixture('valid-v2.json');del doc['data']['models'][0]['schema_version']
        out,report=migrate_document(doc)
        self.assertEqual(len(report['schema_errors']),1)
        self.assertEqual(out['data']['models'],[])

    def test_required_source_or_authors_and_stars_types(self):
        item=fixture('valid-v2.json')['data']['topnews'][0]
        del item['source']
        self.assertTrue(prepare_item(item,'topnews')[1])
        item['authors']=['Author'];self.assertEqual(prepare_item(item,'papers')[1],[])
        item['source']='repo';item['stars']=True
        self.assertTrue(prepare_item(item,'skills')[1])
        item['stars']=0;self.assertEqual(prepare_item(item,'skills')[1],[])

    def test_schema_evaluator_fails_closed(self):
        for schema in [{'unsupported':True},{'$ref':'https://example.com/schema'}, {'$ref':'../outside.json'}]:
            with self.assertRaises(ValueError):check_schema(schema)
        with self.assertRaises(ValueError):load_schema('../outside.json')

    def test_bad_optional_and_identity_fields(self):
        original=fixture('valid-v2.json')['data']['models'][0]
        for extra in [{'title':[]},{'item_id':'ahn2_'+'0'*64},{'canonical_url':'https://example.com/'},
                      {'schema_version':True},{'legacy':{}},{'url':'https://u:p@example.com/'}]:
            with self.subTest(extra=extra):self.assertTrue(prepare_item({**original,**extra},'models')[1])

class MigrationTests(unittest.TestCase):
    def test_legacy_models_keep_missing_claims_absent(self):
        doc=fixture('legacy-v1.json');before=copy.deepcopy(doc)
        out,report=migrate_document(doc)
        self.assertEqual(doc,before)
        self.assertEqual(len(out['data']['models']),3)
        self.assertEqual(report['quarantine'],[])
        self.assertEqual(len(report['legacy_compatible']),4)
        self.assertEqual(len(report['needs_review']),4)
        for original,item in zip(doc['data']['models'],out['data']['models']):
            self.assertEqual(item['contract_state'],'legacy')
            self.assertEqual(item['verified'],'needs_review')
            self.assertIsNone(item['source_title']);self.assertIsNone(item['display_title'])
            for field in MODEL_FIELDS:
                if field not in original:self.assertNotIn(field,item)
                else:self.assertEqual(original[field],item[field])
            for field in ('url','source_url','title','title_zh','model_name','release_date'):
                self.assertEqual((field in original,original.get(field)),(field in item,item.get(field)))
        self.assertFalse(out['data']['models'][1]['official_source'])
        self.assertEqual(errors(out,load_schema('latest.schema.json')),[])

    def test_idempotency_same_input_and_migrated_output(self):
        doc=fixture('legacy-v1.json');a,ra=migrate_document(doc);b,rb=migrate_document(doc)
        self.assertEqual(encoded(a),encoded(b));self.assertEqual(encoded(ra),encoded(rb))
        c,rc=migrate_document(a)
        self.assertEqual(encoded(a),encoded(c));self.assertEqual(encoded(ra),encoded(rc))

    def test_malformed_legacy_goes_to_lossless_sidecar(self):
        doc=fixture('legacy-v1.json');bad={**doc['data']['models'][0],'advantages':'incorrect type'}
        doc['data']['models'].extend([bad,None])
        out,report=migrate_document(doc)
        self.assertEqual(len(out['data']['models']),3)
        self.assertEqual([q['original'] for q in report['quarantine']],[bad,None])
        self.assertEqual(len(report['schema_errors']),2)

    def test_unknown_legacy_version_and_reserved_fields_not_overwritten(self):
        old=fixture('legacy-v1.json')['data']['models'][0]
        for extra in [{'schema_version':3},{'schema_version':'1'},{'item_id':'old-id'},{'canonical_url':'x'}]:
            with self.subTest(extra=extra):
                item={**old,**extra};out,issues=prepare_item(item,'models')
                self.assertTrue(issues);self.assertEqual(out,item)

    def test_explicit_titles_preserved_without_translation_or_copying(self):
        old=fixture('legacy-v1.json')['data']['topnews'][0]
        out,_=prepare_item({**old,'source_title':'Original title','title_zh':'既有翻譯'},'topnews')
        self.assertEqual(out['source_title'],'Original title');self.assertEqual(out['display_title'],'既有翻譯')
        self.assertEqual(out['title'],old['title'])

    def test_validation_summary_is_recomputed_and_history_preserved(self):
        doc=fixture('legacy-v1.json')
        doc['validation']={'total':4,'verified':4,'needs_review':0,'pass_rate':100}
        out,_=migrate_document(doc)
        self.assertEqual(out['legacy_validation'],doc['validation'])
        self.assertEqual(out['validation']['verified'],0)
        self.assertEqual(out['validation']['needs_review'],4)
        self.assertEqual(out['validation']['pass_rate'],0)
        self.assertEqual(migrate_document(out)[0],out)

    def test_real_frontend_bookmark_keys_survive_migration(self):
        doc=fixture('legacy-v1.json');out,_=migrate_document(doc)
        pairs=[(a,b) for cat in doc['data'] for a,b in zip(doc['data'][cat],out['data'][cat])]
        program="""const fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({URL});
vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),context);
const pairs=JSON.parse(fs.readFileSync(0,'utf8'));
for (const [a,b] of pairs) {context.a=a;context.b=b;
 if(vm.runInContext('itemKey(a) !== itemKey(b)',context))process.exit(1);}
"""
        result=subprocess.run(['node','-e',program,str(ROOT/'assets/js/config.js')],input=json.dumps(pairs),text=True,capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_current_company_mismatch_quarantines_without_schema_error(self):
        doc=fixture('valid-v2.json');item=doc['data']['models'][0];item['institution']='Anthropic'
        out,r=migrate_document(doc)
        self.assertEqual(r['schema_errors'],[]);self.assertEqual(out['data']['models'],[])
        self.assertEqual(r['quarantine'][0]['original'],item)

    def test_cli_never_overwrites_input_output_or_data(self):
        with tempfile.TemporaryDirectory() as td:
            td=Path(td);source=td/'input.json';source.write_text(encoded(fixture('legacy-v1.json')))
            output=td/'out.json';report=td/'report.json';before=source.read_bytes()
            args=[sys.executable,'-B',str(ROOT/'scripts/migrate-data-v2.py'),'--input',str(source),'--output',str(output),'--report',str(report)]
            self.assertEqual(subprocess.run(args,capture_output=True).returncode,0)
            out_bytes=output.read_bytes();self.assertEqual(subprocess.run(args,capture_output=True).returncode,1)
            self.assertEqual(output.read_bytes(),out_bytes);self.assertEqual(source.read_bytes(),before)
            args[args.index('--output')+1]=str(ROOT/'data/ah01-must-not-exist.json')
            self.assertEqual(subprocess.run(args,capture_output=True).returncode,1)
            self.assertFalse((ROOT/'data/ah01-must-not-exist.json').exists())

    def test_cli_quarantine_returns_nonzero_and_preserves_original(self):
        with tempfile.TemporaryDirectory() as td:
            td=Path(td);source=td/'input.json';doc=fixture('legacy-v1.json');doc['data']['models'].append(None)
            source.write_text(encoded(doc))
            result=subprocess.run([sys.executable,'-B',str(ROOT/'scripts/migrate-data-v2.py'),'--input',str(source),'--output',str(td/'out'),'--report',str(td/'report')],capture_output=True)
            self.assertEqual(result.returncode,2)
            self.assertIsNone(json.loads((td/'report').read_text())['quarantine'][0]['original'])

class IdentityTests(unittest.TestCase):
    def test_order_tracking_fragment_and_default_port(self):
        a='HTTPS://Example.COM:443/path?b=2&utm_source=x&a=1#fragment'
        b='https://example.com/path?a=1&b=2&gclid=test'
        self.assertEqual(canonical_url(a),canonical_url(b))
        self.assertEqual(stable_item_id(a),stable_item_id(b))
        self.assertEqual(canonical_url(a),'https://example.com/path?a=1&b=2')
        self.assertEqual(stable_item_id(a),'ahn2_fdb2fc473d67cc74cc0800976465f0fb2a5a873bdd1129c1240ccec6f25346d4')

    def test_semantic_query_path_scheme_not_collapsed(self):
        urls=['https://example.com/path','https://example.com/path/','http://example.com/path',
              'https://example.com/path?ref=1','https://example.com/path?source=1',
              'https://example.com/path?v=1','https://example.com/path?v=2']
        self.assertEqual(len({stable_item_id(url) for url in urls}),len(urls))
        self.assertEqual(canonical_url('https://example.com?a=&a=2'), 'https://example.com/?a=&a=2')

    def test_invalid_urls_never_get_an_id(self):
        for url in [None,[], '', '/relative','javascript:alert(1)','https://u:p@example.com',
                    'https://example.com:bad','https://example.com:99999','https://example.com/\n',
                    'https://example.com/\\evil','https://example.com/%xx']:
            with self.subTest(url=url):
                self.assertEqual(canonical_url(url),'')
                with self.assertRaises(ValueError):stable_item_id(url)

    def test_list_category_title_date_order_does_not_affect_id(self):
        doc=fixture('legacy-v1.json');a,_=migrate_document(doc)
        doc['data']['models'].reverse();doc['data']=dict(reversed(list(doc['data'].items())))
        b,_=migrate_document(doc)
        key=lambda x:{source_url(i):i['item_id'] for rows in x['data'].values() for i in rows}
        self.assertEqual(key(a),key(b))
        item=doc['data']['topnews'][0];item.update(title='改名',date='2001-01-01')
        item['authors']='author'
        self.assertEqual(prepare_item(item,'topnews')[0]['item_id'],prepare_item(item,'papers')[0]['item_id'])

    def test_merge_and_validator_share_canonical_dedupe(self):
        spec=importlib.util.spec_from_file_location('merge_stack',ROOT/'scripts/merge-stack.py')
        merge=importlib.util.module_from_spec(spec);spec.loader.exec_module(merge)
        self.assertIs(merge.canonical_url,canonical_url);self.assertIs(validate.canonical_url,canonical_url)
        a={'title':'One','url':'https://example.com/x?a=1&b=2'}
        b={'title':'Completely different','url':'https://example.com/x?b=2&utm_medium=x&a=1'}
        self.assertEqual(validate.remove_duplicates([a,b],'topnews'),([a],1))
        self.assertEqual(merge.item_key(a,('title',)),merge.item_key(b,('title',)))

class ValidatorTests(unittest.TestCase):
    def test_four_diagnostic_classes_and_no_false_verification(self):
        old=today_item(fixture('legacy-v1.json')['data']['models'][0])
        good=today_item(fixture('valid-v2.json')['data']['models'][0]);good['institution']='Anthropic'
        data={'models':[old,{**old,'advantages':7},good]}
        with patch.object(validate,'check_url_and_title',return_value=(True,'ok',1.0)):
            report=validate.validate_items(data)
        self.assertEqual(len(data['models']),1)
        self.assertEqual(data['models'][0]['verified'],'needs_review')
        self.assertEqual(report['verified'],0)
        self.assertEqual(len(report['schema_errors']),1)
        self.assertEqual(len(report['legacy_compatible']),1)
        self.assertEqual(len(report['evidence_needs_review']),1)
        self.assertEqual(len(report['quarantine']),2)

    def test_source_title_used_instead_of_translation_or_model_name(self):
        for cat in ('models','topnews','official_info'):
            data={cat:[today_item(fixture('valid-v2.json')['data'][cat][0])]}
            with patch.object(validate,'check_url_and_title',return_value=(True,'ok',1)) as check:
                report=validate.validate_items(data)
            self.assertEqual(check.call_args.args[1],data[cat][0]['source_title'])
            self.assertEqual(report['verified'],1)

    def test_missing_title_evidence_does_not_become_verified(self):
        data={'topnews':[today_item(fixture('legacy-v1.json')['data']['topnews'][0])]}
        with patch.object(validate,'check_url_and_title',return_value=(True,'ok',1)) as check:
            result=validate.validate_items(data)
        self.assertEqual(check.call_args.args[1],'')
        self.assertEqual(result['verified'],0);self.assertEqual(result['needs_review'],1)

    def test_legacy_media_retained_pending_official_review(self):
        data={'models':[today_item(fixture('legacy-v1.json')['data']['models'][1])]}
        with patch.object(validate,'check_url_and_title',return_value=(True,'ok',1)):
            result=validate.validate_items(data)
        self.assertEqual(result['removed'],0);self.assertFalse(data['models'][0]['official_source'])
        self.assertEqual(result['needs_review'],1)

    def test_mismatched_legacy_evidence_has_no_official_badge(self):
        old=today_item(fixture('legacy-v1.json')['data']['models'][0])
        old['evidence_urls']=['https://example.com/unconfirmed']
        doc={'data':{'models':[old]}};out,_=migrate_document(doc)
        with patch.object(validate,'check_url_and_title',return_value=(True,'ok',1)):
            result=validate.validate_items(doc['data'])
        self.assertEqual(result['removed'],0)
        self.assertFalse(doc['data']['models'][0]['official_source'])
        self.assertEqual(doc['data']['models'][0]['official_source'],out['data']['models'][0]['official_source'])

    def test_generated_prompt_title_contract_matches_canonical_prompts(self):
        setup=(ROOT/'scripts/setup-prompts.sh').read_text()
        for cat in ('papers','topnews','taiwan','china','usa','techtrends','governance','tutorials','courses'):
            lines=(ROOT/f'scripts/prompts/{cat}.md').read_text().splitlines()
            contract=next(line for line in lines if line.startswith('AH-01 title contract:'))
            self.assertIn(contract,setup)
        for cat in ('models','official_info'):
            text=(ROOT/f'scripts/prompts/{cat}.md').read_text()
            self.assertIn('source_title',text);self.assertIn('display_title',text)

    def test_offline_history_has_no_network_writes_or_freshness_rejection(self):
        doc=fixture('legacy-v1.json');doc['data']['models'][0]['release_date']='2001-01-01'
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'history.json';path.write_text(encoded(doc));before=path.read_bytes()
            with patch.object(sys,'argv',['validate','--input',str(path),'--offline']), patch.object(validate,'check_url_and_title') as check, patch.object(validate,'save_latest_json') as save, patch.object(validate,'write_validation_report') as report:
                self.assertEqual(validate.main(),0)
                check.assert_not_called();save.assert_not_called();report.assert_not_called()
            self.assertEqual(path.read_bytes(),before)

    def test_offline_empty_and_all_invalid_still_report(self):
        from contextlib import redirect_stdout
        import io
        for rows,expected in [([],0),([None],1)]:
            with tempfile.TemporaryDirectory() as td:
                path=Path(td)/'input.json';path.write_text(encoded({'data':{'models':rows}}))
                capture=io.StringIO()
                with patch.object(sys,'argv',['validate','--input',str(path),'--offline']),redirect_stdout(capture):
                    self.assertEqual(validate.main(),expected)
                report=json.loads(capture.getvalue())
                self.assertEqual(len(report['schema_errors']),len(rows))

    def test_root_unknown_version_fails_before_network(self):
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'bad.json';path.write_text(encoded({'schema_version':99,'data':{'models':[]}}))
            with patch.object(sys,'argv',['validate','--input',str(path),'--dry-run']),patch.object(validate,'check_url_and_title') as check:
                self.assertEqual(validate.main(),1);check.assert_not_called()

if __name__=='__main__':unittest.main()
