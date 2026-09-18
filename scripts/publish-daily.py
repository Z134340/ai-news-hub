#!/usr/bin/env python3
"""Commit only daily outputs, three-way rebase onto remote main, then ordinary push.
Failures preserve the local candidate commit (and never resolve conflicts automatically).
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from datetime import datetime, timezone


class PublishError(RuntimeError):
    def __init__(self, message, candidate=None, retryable=False):
        super().__init__(message)
        self.candidate = candidate
        self.retryable = retryable


def git(root, *args, check=True):
    result = subprocess.run(['git', '-C', str(root), *args], capture_output=True, text=True)
    if check and result.returncode:
        raise PublishError(f'git {args[0]}: {result.stderr.strip()}')
    return result


def publish(root, base, message):
    if git(root, 'branch', '--show-current').stdout.strip() != 'main':
        raise PublishError('daily publisher requires main (never moves another branch)')
    if git(root, 'rev-parse', 'HEAD').stdout.strip() != base:
        raise PublishError('HEAD changed during collection')
    if git(root, 'diff', '--cached', '--name-only').stdout:
        raise PublishError('index already contains staged changes')
    for state in ('MERGE_HEAD','rebase-merge','rebase-apply','CHERRY_PICK_HEAD'):
        state_path = Path(git(root,'rev-parse','--git-path',state).stdout.strip())
        if (state_path if state_path.is_absolute() else root / state_path).exists():
            raise PublishError('unfinished Git operation')
    targets = ['data/']
    manifest = root / 'data/agent/.preview/apply-change-staged.txt'
    if manifest.exists():
        for line in manifest.read_text().splitlines():
            path = line.strip()
            if not path:
                continue
            if not (path in ('assets/js/config.js','scripts/tier-b-domains.json') or re.fullmatch(r'scripts/prompts/[a-z_]+\.md', path)):
                raise PublishError('auto-change path is outside allowlist')
            if (root / path).is_symlink():
                raise PublishError('auto-change path is a symlink')
            targets.append(path)
    changed = git(root,'diff','--name-only','-z').stdout.split('\0')
    untracked = git(root,'ls-files','--others','--exclude-standard','-z').stdout.split('\0')
    if any(p and not (p.startswith('data/') or p in targets) for p in changed + untracked):
        raise PublishError('unrelated working tree changes; refusing to publish')
    git(root,'add','-A','--',*targets)
    has_changes = bool(git(root,'diff','--cached','--name-only').stdout)
    if has_changes:
        git(root,'commit','-m',message)
    candidate = git(root,'rev-parse','HEAD').stdout.strip()
    return push_candidate(root, candidate, has_changes)


def push_candidate(root, candidate, has_changes=True):
    last_error = ''
    for attempt in range(3):
        try:
            git(root,'fetch','origin','main')
        except PublishError as error:
            raise PublishError(str(error), git(root,'rev-parse','HEAD').stdout.strip(), True) from error
        result = git(root,'rebase','origin/main',check=False)
        if result.returncode:
            git(root,'rebase','--abort',check=False)
            raise PublishError(f'publication conflict; candidate {candidate} preserved: {result.stderr.strip()}', candidate)
        result = git(root,'push','origin','HEAD:refs/heads/main',check=False)
        if result.returncode == 0:
            return {'status':'pushed' if has_changes else 'unchanged', 'commit':git(root,'rev-parse','HEAD').stdout.strip()}
        last_error = result.stderr.strip()
    raise PublishError(f'push failed after 3 attempts; candidate preserved: {last_error}', git(root,'rev-parse','HEAD').stdout.strip(), True)


def retry_pending(root, receipt):
    if receipt.get('status') != 'failed' or not receipt.get('retryable'):
        return None
    candidate = receipt.get('candidate')
    if (git(root,'branch','--show-current').stdout.strip() != 'main'
            or git(root,'status','--porcelain').stdout
            or git(root,'rev-parse','HEAD').stdout.strip() != candidate):
        raise PublishError('pending publication does not match clean checkout; review required')
    return push_candidate(root, candidate)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--base')
    parser.add_argument('--message')
    parser.add_argument('--retry-pending', action='store_true')
    parser.add_argument('--receipt', type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.retry_pending:
            prior = json.loads(args.receipt.read_text()) if args.receipt.exists() else {}
            receipt = retry_pending(args.root.resolve(), prior)
            if receipt is None:
                return 0
        else:
            if not args.base or not args.message:
                parser.error('--base and --message required for new publication')
            receipt = publish(args.root.resolve(), args.base, args.message)
        code = 0
    except (PublishError, OSError, ValueError) as error:
        print(error, file=sys.stderr)
        receipt = {'status':'failed', 'candidate':getattr(error,'candidate',None), 'retryable':getattr(error,'retryable',False)}
        code = 1
    receipt['finished_at'] = datetime.now(timezone.utc).isoformat()
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.receipt.with_suffix('.tmp')
    temporary.write_text(json.dumps(receipt, indent=2) + '\n')
    os.replace(temporary, args.receipt)
    return code


if __name__ == '__main__':
    sys.exit(main())
