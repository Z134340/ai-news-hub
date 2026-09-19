#!/usr/bin/env python3
"""AH-02 local category store and daily adapter; never writes public data itself.

Published here means locally selected data, not Git push or website deployment.
All paths are explicit; candidate/quarantine/LKG live outside the public repo.
"""
import argparse
import base64
from copy import deepcopy
from datetime import datetime, timezone, timedelta
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

from contracts.category_quality import decide, digest, timestamp, check_policy, reliable
from contracts.schema import errors, load_schema
from contracts.data_v2 import CATEGORIES, prepare_item
import validate

ROOT = Path(__file__).resolve().parents[1]
POLICY = ROOT / 'scripts/category-quality-policy.json'
_spec = importlib.util.spec_from_file_location('quality_merge_stack', ROOT / 'scripts/merge-stack.py')
_stack = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_stack)


def encode(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + '\n').encode()


def atomic_write(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def read_json(path):
    return json.loads(Path(path).read_bytes())


def load_current(store):
    try:
        key = (store / 'current').read_text().strip()
    except FileNotFoundError:
        return None, {}, {}, []
    try:
        if not re.fullmatch('[0-9a-f]{64}', key):
            raise ValueError('invalid store pointer')
        result = read_json(store / 'generations' / key / 'result.json')
        previous = result['last_known_good']
        if not isinstance(previous, dict):
            raise ValueError('invalid LKG map')
        checked = result['published'].get('_checked_at', {})
        if not isinstance(checked, dict):
            checked = {}
        return key, previous, checked, []
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        # Explicit unavailable, never bootstrap from arbitrary latest.json.
        return None, {}, {}, ['corrupt_current:' + type(exc).__name__]


def fresh_item(original, category):
    """Version NEW producer rows only. Historical migration remains AH-01 legacy.

    No facts filled. A fresh unversioned row qualifies as current only when every
    current schema field was explicitly supplied. Reserved metadata is not erased.
    """
    row, issues = prepare_item(original, category)
    if (not issues and isinstance(original, dict)
            and 'schema_version' not in original and 'contract_state' not in original):
        current = {k: v for k, v in row.items() if k != 'legacy'}
        current['contract_state'] = 'current'
        if not prepare_item(current, category)[1]:
            row = current
    # Never trust producer-supplied validation claims.
    if isinstance(row, dict):
        for key in ('verified', 'complete', 'verified_at', 'url_status', 'review_reasons', 'title_score'):
            row.pop(key, None)
    return row


def validate_candidate(candidate, checked_at, validator=validate.validate_items):
    output = deepcopy(candidate)
    for category, entry in output.items():
        if not isinstance(entry, dict):
            output[category] = {'status':'success','items':None,'original':deepcopy(entry),'reasons':['invalid_candidate_entry']}
            continue
        if entry.get('status') != 'success':
            continue
        raw = entry.get('items')
        entry['input_count'] = len(raw) if isinstance(raw, list) else None
        if not isinstance(raw, list):
            entry['reasons'] = ['category_not_array']
            continue
        # Keep raw originals and indexes before mutation, pruning or deduplication.
        data = {category: [fresh_item(row, category) for row in raw]}
        try:
            report = validator(data, schema_version=2)
            entry['items'] = data[category]
            entry['validation_report'] = report
            reasons = entry.setdefault('reasons', [])
            if report['removed'] or report['schema_errors'] or report['quarantine']:
                reasons.append('validator_rejected_or_deduplicated_items')
            if len(data[category]) != len(raw):
                reasons.append('candidate_count_changed')
            for row in data[category]:
                row['verified_at'] = checked_at
        except Exception as exc:
            entry['reasons'] = ['validator_exception:' + type(exc).__name__]
            entry['items'] = []
    return output


def merge_reliable(category, current, history, now):
    if category in _stack.CATEGORY_POLICY:
        return _stack.merge_category(category, current, history, now=now)
    return current


def guard_paths(store, output, source=None):
    store, output = Path(store).resolve(), Path(output).resolve()
    # Includes the original scheduled checkout, not only this worktree.
    roots = {ROOT}
    try:
        common = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', '--git-common-dir'],
                                capture_output=True, text=True, check=True).stdout.strip()
        git_dir = (ROOT / common).resolve()
        if git_dir.name == '.git':
            roots.add(git_dir.parent)
    except (OSError, subprocess.CalledProcessError):
        pass  # A fixture/exported copy still protects its own data directory.
    for root in roots:
        if store == root or root in store.parents:
            raise ValueError('private store must be outside repository')
        data = root / 'data'
        if output == data or data in output.parents:
            raise ValueError('output must be a candidate, never public data')
    if output == store or store in output.parents:
        raise ValueError('output must be outside store')
    if source:
        source = Path(source).resolve()
        if source == store or source in store.parents or store in source.parents:
            raise ValueError('candidate and store directories must be separate')
        if source == output or source in output.parents:
            raise ValueError('output cannot overwrite candidate evidence')


def checked_snapshot(result, policy, checked_at):
    """A saved retry cannot skip integrity checks on its selected payload."""
    records = result['last_known_good']
    document = result['published']
    if not isinstance(records, dict) or set(records) - set(CATEGORIES):
        raise ValueError('invalid saved LKG map')
    for category, record in records.items():
        if reliable(record, category, policy['categories'][category], checked_at)[0] is None:
            raise ValueError('saved generation is corrupt; use a new attempt')
    expected = {cat: records[cat]['items'] if cat in records else [] for cat in CATEGORIES}
    expected_updated = {cat: record['updated_at'] for cat, record in records.items()}
    if (document.get('data') != expected or document.get('_updated_at') != expected_updated
            or document.get('stats') != {cat: len(rows) for cat, rows in expected.items()}
            or errors(document, load_schema('latest.schema.json'))):
        raise ValueError('published snapshot differs from reliable records')
    for value in document.get('_checked_at', {}).values():
        if timestamp(value) > timestamp(checked_at):
            raise ValueError('future saved check timestamp')
    return result


def publish(candidate, store, output, checked_at, policy, validator=validate.validate_items):
    """Persist raw attempt before processing; one atomic pointer commits the LKG set.

    A failed write never modifies previous generations. Request hashes provide
    idempotency, not a release manifest; no public release identity is introduced.
    """
    store, output = Path(store), Path(output)
    guard_paths(store, output)
    timestamp(checked_at)
    check_policy(policy)
    if not isinstance(candidate, dict) or set(candidate) - set(CATEGORIES):
        raise ValueError('unknown candidate category')
    request = {'candidate': candidate, 'checked_at': checked_at, 'policy': policy,
               'schema': 'category-attempt-v1'}
    key = digest(request)
    store.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (store / '.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        current_key, previous, previous_checked, state_errors = load_current(store)
        generation = store / 'generations' / key
        if current_key == key:
            result = read_json(generation / 'result.json')
            checked_snapshot(result, policy, checked_at)
            atomic_write(output, encode(result['published']))
            return result
        if generation.exists():
            # Can be an interrupted commit; only complete identical, newest attempts.
            saved = read_json(generation / 'request.json')
            if saved.get('base_generation') != current_key:
                raise ValueError('interrupted attempt has a changed base; use a new attempt')
            if {k:v for k,v in saved.items() if k != 'base_generation'} != request:
                raise ValueError('attempt identity collision')
        if current_key:
            prior_request = read_json(store / 'generations' / current_key / 'request.json')
            if timestamp(prior_request['checked_at']) >= timestamp(checked_at):
                raise ValueError('stale or ambiguous attempt must not roll back current data')
        attempt = store / 'attempts' / key
        attempt.mkdir(parents=True, exist_ok=True)
        if not (attempt / 'candidate.json').exists():
            atomic_write(attempt / 'candidate.json', encode(request))
        if generation.exists():
            result = checked_snapshot(read_json(generation / 'result.json'), policy, checked_at)
        else:
            checked = validate_candidate(candidate, checked_at, validator)
            result = decide(checked, previous, checked_at, policy, merge_reliable, previous_checked)
            result['state_errors'] = state_errors
            result['attempt_id'] = key
            # Keep all diagnostics off-repo, not just the rejected category data.
            result['candidate_validation'] = checked
            (store / 'generations').mkdir(exist_ok=True)
            stage = Path(tempfile.mkdtemp(prefix='.pending-', dir=store / 'generations'))
            atomic_write(stage / 'request.json', encode({**request, 'base_generation': current_key}))
            atomic_write(stage / 'result.json', encode(result))
            atomic_write(stage / 'validated.json', encode(result['validated']))
            atomic_write(stage / 'quarantine.json', encode(result['quarantine']))
            atomic_write(stage / 'published.json', encode(result['published']))
            sync_directory(stage)
            os.replace(stage, generation)
            sync_directory(generation.parent)
        atomic_write(output, encode(result['published']))
        atomic_write(store / 'current', (key + '\n').encode())
        return result


def collect(directory, status_dir, scheduled):
    result = {}
    for category in CATEGORIES:
        if category not in scheduled:
            result[category] = {'status': 'not_scheduled'}
            continue
        path = directory / (category + '.json')
        raw = path.read_bytes() if path.exists() else b''
        # Include every model attempt, even when a retry eventually succeeds.
        attempts = {p.name: base64.b64encode(p.read_bytes()).decode()
                    for p in sorted(directory.glob(category + '.attempt*.txt'))}
        entry = {'status': 'fetch_failed', 'source_location': str(path),
                 'original': {'file_base64': base64.b64encode(raw).decode(), 'attempts_base64': attempts}}
        try:
            status = (status_dir / category).read_text().strip()
            entry['fetch_status'] = status
            if status != 'OK':
                raise ValueError('fetch_failed:' + status)
            value = json.loads(raw)
            rows = value.get('items') if isinstance(value, dict) else value
            if not isinstance(rows, list):
                # Successful transport, malformed candidate is validation failure.
                entry.update(status='success', items=rows)
            else:
                entry.update(status='success' if rows else 'no_change', items=rows)
            entry['original']['items'] = deepcopy(rows)
        except (OSError, ValueError) as exc:
            entry['reasons'] = [type(exc).__name__ + ':' + str(exc)]
        result[category] = entry
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate-dir', type=Path, required=True)
    parser.add_argument('--status-dir', type=Path, required=True)
    parser.add_argument('--scheduled', nargs='+', choices=CATEGORIES, required=True)
    parser.add_argument('--store', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--checked-at', default=None)
    args = parser.parse_args()
    try:
        guard_paths(args.store, args.output, args.candidate_dir)
        checked_at = args.checked_at or datetime.now(timezone(timedelta(hours=8))).isoformat()
        result = publish(collect(args.candidate_dir, args.status_dir, args.scheduled),
                         args.store, args.output, checked_at, read_json(POLICY))
        print(json.dumps({'attempt_id': result['attempt_id'], 'outcomes': result['published']['_update_outcome']}, ensure_ascii=False))
        # Processing succeeded even if all categories failed: explicit empty/retained
        # output is useful. Daily health/exit is derived from category outcomes.
        return 0
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print('Category publication failed: ' + str(exc))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
