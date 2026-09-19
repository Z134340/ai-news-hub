"""AH-01 public data v2: pure migration, identity and offline classification.

No network, timestamps, guessed claims, writes, title/URL rewrites or publication
policy. Legacy is a compatibility state, never evidence of source verification.
"""
from copy import deepcopy
from functools import lru_cache
from pathlib import Path
import hashlib
import json
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .schema import errors, load_schema

CATEGORIES = tuple(load_schema('latest.schema.json')['properties']['data']['properties'])
MODEL_FIELDS = tuple(load_schema('models.schema.json')['allOf'][1]['then']['required'])
# Deliberately preserve semantic ref/source parameters and trailing path slashes.
TRACKING_KEYS = frozenset(('fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid'))


def canonical_url(value):
    if not isinstance(value, str) or not value or any(c.isspace() or ord(c) < 32 for c in value):
        return ''
    try:
        parts = urlsplit(value)
        if (parts.scheme not in ('http', 'https') or not parts.hostname
                or parts.username is not None or parts.password is not None or '\\' in value
                or re.search(r'%(?![0-9a-fA-F]{2})', value)):
            return ''
        host = parts.hostname.encode('idna').decode('ascii').lower()
        if ':' in host:
            host = '[' + host + ']'
        port = parts.port  # validates malformed/out-of-range ports
        authority = host if port is None or (parts.scheme, port) in (('https', 443), ('http', 80)) else f'{host}:{port}'
        query = sorted((key, val) for key, val in parse_qsl(parts.query, keep_blank_values=True)
                       if not key.lower().startswith('utm_') and key.lower() not in TRACKING_KEYS)
        return urlunsplit((parts.scheme.lower(), authority, parts.path or '/', urlencode(query), ''))
    except (ValueError, UnicodeError):
        return ''


def source_url(item):
    return item.get('url') or item.get('source_url') or ''


def stable_item_id(url):
    canonical = canonical_url(url)
    if not canonical:
        raise ValueError('Cannot identify an invalid URL')
    # Category, position, translated title, model/version and date are excluded.
    material = ('ai-news-hub:item:v2\n' + canonical).encode('utf-8')
    return 'ahn2_' + hashlib.sha256(material).hexdigest()


def item_schema(category):
    return load_schema('latest.schema.json')['properties']['data']['properties'][category]['items']


def legacy_model(item, category):
    return (category == 'models' and item.get('contract_state') == 'legacy'
            and any(key not in item for key in MODEL_FIELDS))


@lru_cache(maxsize=1)
def company_domains():
    path = Path(__file__).resolve().parents[2] / 'skills/official-ai-ecosystem-research/references/official-sources.json'
    doc = json.loads(path.read_text(encoding='utf-8'))
    return {row['company']: row['domains'] for row in doc['sources']}


def official_evidence_matches(item, category):
    company = item.get('institution' if category == 'models' else 'company')
    domains = company_domains().get(company, [])
    urls = [source_url(item), *item.get('evidence_urls', [])]
    return bool(domains) and all(
        any((urlsplit(url).hostname or '').lower().removeprefix('www.') == domain
            or (urlsplit(url).hostname or '').lower().endswith('.' + domain) for domain in domains)
        for url in urls)


def review_reasons(item, category):
    reasons = []
    if not item.get('source_title'):
        reasons.append('source_title_missing')
    if not item.get('display_title'):
        reasons.append('display_title_missing')
    if legacy_model(item, category):
        reasons.append('legacy_model_fields_missing')
    if category in ('models', 'official_info') and not official_evidence_matches(item, category):
        reasons.append('official_evidence_unconfirmed')
    return reasons


def prepare_item(original, category):
    """Return v2 copy + schema errors. Invalid input is returned unchanged.

    Only unversioned / integer version 1 records can migrate. A malformed v2 or
    unknown version is never relabelled as legacy to evade its schema.
    """
    if category not in CATEGORIES:
        return deepcopy(original), ['unknown category']
    if not isinstance(original, dict):
        return deepcopy(original), ['item must be an object']
    item = deepcopy(original)
    version = item.get('schema_version', 1)
    if type(version) is not int or version not in (1, 2):
        return item, ['unknown schema_version']
    if version == 1:
        # Do not overwrite an existing identity or a claimed contract envelope.
        if any(key in item for key in ('item_id', 'canonical_url', 'contract_state', 'legacy')):
            return item, ['legacy input contains reserved v2 metadata']
        canonical = canonical_url(source_url(item))
        if not canonical:
            return item, ['invalid source URL']
        item.update(schema_version=2, contract_state='legacy', canonical_url=canonical,
                    item_id=stable_item_id(source_url(item)))
        # Explicit values only: title is ambiguous in historical data.
        item.setdefault('source_title', None)
        item.setdefault('display_title', item.get('title_zh'))
        fields = ('source_title', 'display_title') + (MODEL_FIELDS if category == 'models' else ())
        item['legacy'] = {'from_version': 1, 'missing_fields': sorted(key for key in fields if key not in original)}
    problems = errors(item, item_schema(category))
    for key in ('url', 'source_url'):
        if key in item and not canonical_url(item[key]):
            problems.append(f'invalid {key}')
    canonical = canonical_url(source_url(item))
    if canonical:
        if item.get('canonical_url') != canonical:
            problems.append('canonical_url mismatch')
        if item.get('item_id') != stable_item_id(source_url(item)):
            problems.append('item_id mismatch')
    if category in ('models', 'official_info'):
        for url in item.get('evidence_urls', []) if isinstance(item.get('evidence_urls', []), list) else []:
            if not canonical_url(url):
                problems.append('invalid evidence URL')
    return item, problems


def envelope_errors(document):
    if not isinstance(document, dict) or not isinstance(document.get('data'), dict):
        return ['latest.data must be an object']
    version = document.get('schema_version', 1)
    if type(version) is not int or version not in (1, 2):
        return ['unknown root schema_version']
    # Only envelope here: single bad item must not prevent independent diagnostics.
    shell = {**document, 'schema_version': 2, 'data': {key: [] if isinstance(value, list) else value
                                                      for key, value in document['data'].items()}}
    return errors(shell, load_schema('latest.schema.json'))


def migrate_document(document):
    """Return compatible document and lossless diagnostic sidecar.

    Invalid records live verbatim in quarantine in the sidecar. This is a local
    migration result, not AH-02's candidate/publication storage or quality gate.
    """
    problems = envelope_errors(document)
    if problems:
        raise ValueError('; '.join(problems))
    output = deepcopy(document)
    output['schema_version'] = 2
    report = {'schema_version': 2, 'schema_errors': [], 'legacy_compatible': [],
              'needs_review': [], 'quarantine': []}
    for category, rows in document['data'].items():
        kept = []
        for index, original in enumerate(rows):
            item, issues = prepare_item(original, category)
            if document.get('schema_version') == 2 and isinstance(original, dict) and original.get('schema_version') != 2:
                issues.append('v2 envelope requires v2 items')
            location = {'category': category, 'index': index}
            if not issues and category in ('models', 'official_info') and not legacy_model(item, category) and not official_evidence_matches(item, category):
                report['quarantine'].append({**location, 'reasons': ['company_domain_mismatch'], 'original': deepcopy(original)})
                continue
            if issues:
                report['schema_errors'].append({**location, 'reasons': issues})
                report['quarantine'].append({**location, 'reasons': issues, 'original': deepcopy(original)})
                continue
            reasons = review_reasons(item, category)
            if reasons:
                item['verified'] = 'needs_review'
                item['complete'] = False
                item['review_reasons'] = reasons
            if category in ('models', 'official_info'):
                item['official_source'] = official_evidence_matches(item, category)
            kept.append(item)
            if item['contract_state'] == 'legacy':
                report['legacy_compatible'].append({**location, 'item_id': item['item_id']})
            reasons = review_reasons(item, category)
            if reasons:
                report['needs_review'].append({**location, 'item_id': item['item_id'], 'reasons': reasons})
        output['data'][category] = kept
    if 'stats' in output:
        output['stats'] = {key: len(rows) for key, rows in output['data'].items()}
    if 'validation' in output:
        # Preserve the historical report, but never expose its stale success rate
        # as the validation summary of migrated records.
        output.setdefault('legacy_validation', deepcopy(output['validation']))
        rows = [item for items in output['data'].values() for item in items]
        verified = sum(item.get('verified') is True for item in rows)
        review = sum(item.get('verified') == 'needs_review' for item in rows)
        output['validation'] = {'scope': 'retained_after_migration', 'total': len(rows),
                                'verified': verified, 'needs_review': review,
                                'warnings': review, 'removed': 0,
                                'pass_rate': round(100 * verified / len(rows), 2) if rows else 0}
    return output, report


def encoded(value):
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + '\n'
