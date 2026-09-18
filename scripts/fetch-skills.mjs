#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = path.join(ROOT, 'scripts', 'skills-repositories.json');
const OUTPUT = path.join(ROOT, 'data', 'skills.json');

const nonEmpty = value => typeof value === 'string' && value.trim();

export async function collectSkills({fetchImpl=globalThis.fetch, registryPath=REGISTRY, now=new Date()}={}) {
  const registry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
  if (registry.schema !== 'skills-repositories-v1' || !Array.isArray(registry.repositories)) throw new Error('invalid skills registry');
  const token = process.env.GITHUB_TOKEN || '';
  const headers = {'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'ai-news-hub-skills'};
  if (token) headers.Authorization = `Bearer ${token}`;
  const items = await Promise.all(registry.repositories.map(async entry => {
    if (!nonEmpty(entry.repo) || !Array.isArray(entry.tools) || entry.tools.length < 2) throw new Error(`invalid registry entry: ${entry.repo || '?'}`);
    const response = await fetchImpl(`https://api.github.com/repos/${entry.repo}`, {headers});
    if (!response.ok) throw new Error(`${entry.repo}: GitHub API ${response.status}`);
    const repo = await response.json();
    if (repo.archived || repo.fork || repo.full_name !== entry.repo || !Number.isInteger(repo.stargazers_count)) throw new Error(`${entry.repo}: repository is ineligible`);
    const description = nonEmpty(repo.description) ? repo.description.trim() : entry.focus;
    return {
      title: repo.full_name,
      source: 'GitHub',
      date: String(repo.pushed_at || '').slice(0,10),
      summary: description,
      url: repo.html_url,
      stars: repo.stargazers_count,
      forks: repo.forks_count || 0,
      license: repo.license?.spdx_id || '逐項確認',
      type: entry.type,
      focus: entry.focus,
      tools: entry.tools,
      verified: true
    };
  }));
  items.sort((a,b)=>b.stars-a.stars || a.title.localeCompare(b.title));
  return {items, _updated_at:now.toISOString(), source:'GitHub REST API'};
}

export async function run(options={}) {
  const outputPath = options.outputPath || OUTPUT;
  const result = await collectSkills(options);
  const temp = `${outputPath}.tmp-${process.pid}`;
  await fs.writeFile(temp, JSON.stringify(result,null,2)+'\n');
  await fs.rename(temp, outputPath);
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().then(result=>console.log(`skills: ${result.items.length} repositories`)).catch(error=>{ console.error(error.message); process.exitCode=1; });
}
