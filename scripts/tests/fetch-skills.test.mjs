import test from 'node:test';
import assert from 'node:assert/strict';
import {collectSkills} from '../fetch-skills.mjs';
import {itemsOf} from '../agent/lib/corpus.mjs';

test('GitHub skill repositories are validated and ranked by stars', async()=>{
  const registryPath = new URL('fixtures/skills-registry.json', import.meta.url).pathname;
  const rows = {
    'alpha/skills': {full_name:'alpha/skills',html_url:'https://github.com/alpha/skills',description:'Alpha',pushed_at:'2026-09-18T00:00:00Z',stargazers_count:20,forks_count:2,license:{spdx_id:'MIT'},archived:false,fork:false},
    'beta/skill': {full_name:'beta/skill',html_url:'https://github.com/beta/skill',description:'Beta',pushed_at:'2026-09-17T00:00:00Z',stargazers_count:40,forks_count:4,license:null,archived:false,fork:false}
  };
  const fetchImpl = async url => ({ok:true,json:async()=>rows[url.split('/repos/')[1]]});
  const result = await collectSkills({fetchImpl,registryPath,now:new Date('2026-09-18T12:00:00Z')});
  assert.deepEqual(result.items.map(x=>x.title),['beta/skill','alpha/skills']);
  assert.equal(result.items[0].license,'逐項確認');
  assert.equal(result.items[1].stars,20);
});

test('an archived repository rejects the complete refresh', async()=>{
  const registryPath = new URL('fixtures/skills-registry-one.json', import.meta.url).pathname;
  const fetchImpl = async()=>({ok:true,json:async()=>({full_name:'alpha/skills',html_url:'https://github.com/alpha/skills',description:'x',pushed_at:'2026-09-18T00:00:00Z',stargazers_count:1,archived:true,fork:false})});
  await assert.rejects(()=>collectSkills({fetchImpl,registryPath}),/ineligible/);
});

test('skills stay outside the editorial learning corpus',()=>{
  const rows=itemsOf({date:'2026-09-18',data:{
    topnews:[{title:'news',url:'https://example.com/news'}],
    skills:[{title:'owner/skill',url:'https://github.com/owner/skill'}]
  }});
  assert.deepEqual(rows.map(x=>x.title),['news']);
});
