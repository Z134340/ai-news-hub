#!/usr/bin/env python3
"""AH-03 content release installation/verification. No network or deployment claim."""
import argparse
import fcntl
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import re

from contracts.schema import errors, check_schema, load_schema

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location('release_category_publication', ROOT / 'scripts/category-publication.py')
quality = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(quality)
SCHEMA = json.loads((ROOT / 'schemas/release/manifest-v1.schema.json').read_text())
check_schema(SCHEMA)


def read_bytes(path):
    path = Path(path)
    if path.is_symlink() or path.parent.is_symlink():
        raise ValueError('release paths must not contain symlinks')
    return path.read_bytes()


def manifest_for(payload):
    document = json.loads(payload)
    if errors(document, load_schema('latest.schema.json')) or not document.get('_update_outcome'):
        raise ValueError('release requires a selected v2 snapshot')
    digest = sha256(payload).hexdigest()
    manifest = dict(schema_version=1, data_schema_version=2,
                    release_id='ahn-release-v1-' + digest, data_sha256=digest,
                    data_path='data/releases/' + digest + '.json', data_bytes=len(payload),
                    snapshot_time=document['time'], scope='local_snapshot')
    validate_manifest(manifest)
    return manifest


def validate_manifest(manifest):
    if errors(manifest, SCHEMA):
        raise ValueError('invalid release manifest schema')
    digest = manifest['data_sha256']
    if (manifest['release_id'] != 'ahn-release-v1-' + digest
            or manifest['data_path'] != 'data/releases/' + digest + '.json'):
        raise ValueError('manifest identity/path mismatch')
    return manifest


def verify_payload(manifest, payload):
    validate_manifest(manifest)
    if len(payload) != manifest['data_bytes'] or sha256(payload).hexdigest() != manifest['data_sha256']:
        raise ValueError('release content hash/size mismatch')
    if manifest_for(payload) != manifest:
        raise ValueError('release content metadata mismatch')


def verify_site(data_dir):
    """Legacy absence is supported; present malformed/mixed releases fail closed."""
    data_dir = Path(data_dir)
    path = data_dir / 'release-manifest.json'
    if not path.exists() and not path.is_symlink():
        return None
    manifest = validate_manifest(json.loads(read_bytes(path)))
    payload = read_bytes(data_dir.parent / manifest['data_path'])
    verify_payload(manifest, payload)
    if read_bytes(data_dir / 'latest.json') != payload:
        raise ValueError('legacy latest differs from manifest content')
    return manifest


def install(store, candidate, data_dir):
    """Hold the AH-02 lock through manifest switch; refuse stale/modified candidates.

    Immutable payload -> legacy latest -> manifest (commit point). A pre-commit
    failure leaves the old manifest usable; latest can already be new. Retry the
    current AH-02 selection to repair. No cross-file or deployment transaction.
    """
    store, candidate, data_dir = map(Path, (store, candidate, data_dir))
    quality.guard_paths(store, candidate)
    if store.resolve() == data_dir.resolve() or store.resolve() in data_dir.resolve().parents or data_dir.resolve() in store.resolve().parents:
        raise ValueError('private store and public data must be separate')
    if candidate.resolve() == data_dir.resolve() or data_dir.resolve() in candidate.resolve().parents:
        raise ValueError('candidate must be outside public data')
    if any(p.is_symlink() for p in (data_dir, data_dir / 'releases')):
        raise ValueError('public directory must not contain symlinks')
    with (store / '.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        key = read_bytes(store / 'current').decode().strip()
        if not re.fullmatch('[0-9a-f]{64}', key):
            raise ValueError('invalid quality pointer')
        generation = store / 'generations' / key
        request = json.loads(read_bytes(generation / 'request.json'))
        quality.check_policy(request['policy'])
        result = quality.checked_snapshot(json.loads(read_bytes(generation / 'result.json')),
                                          request['policy'], request['checked_at'])
        payload = read_bytes(candidate)
        if payload != quality.encode(result['published']) or payload != read_bytes(generation / 'published.json'):
            raise ValueError('candidate does not match current quality selection')
        manifest = manifest_for(payload)
        target = data_dir.parent / manifest['data_path']
        # data_dir is intentionally fixed to a directory named data, matching public URLs.
        if data_dir.name != 'data':
            raise ValueError('public directory must be named data')
        if target.exists() or target.is_symlink():
            if read_bytes(target) != payload:
                raise ValueError('immutable content path collision/corruption')
        else:
            quality.atomic_write(target, payload)
        verify_payload(manifest, read_bytes(target))
        quality.atomic_write(data_dir / 'latest.json', payload)
        quality.atomic_write(data_dir / 'release-manifest.json', quality.encode(manifest))
        return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify-site', type=Path)
    parser.add_argument('--store', type=Path)
    parser.add_argument('--candidate', type=Path)
    parser.add_argument('--data-dir', type=Path)
    args = parser.parse_args()
    try:
        if args.verify_site and not any((args.store, args.candidate, args.data_dir)):
            result = verify_site(args.verify_site)
        elif not args.verify_site and all((args.store, args.candidate, args.data_dir)):
            result = install(args.store, args.candidate, args.data_dir)
        else:
            parser.error('use --verify-site or all of --store/--candidate/--data-dir')
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print('release failed: ' + str(exc))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
