"""AH-02 category decisions. No network, clock, files, or inferred content."""
from copy import deepcopy
from datetime import datetime
from hashlib import sha256
import json
import re

from .data_v2 import CATEGORIES, prepare_item, review_reasons
from .schema import errors, load_schema

OUTCOMES = ('updated', 'no_change', 'fetch_failed', 'validation_failed', 'not_scheduled')
VOLATILE = {'verified_at', 'url_status', 'title_score', 'verified', 'complete',
            'review_reasons', 'is_new', 'last_seen'}


def digest(value):
    return sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                             separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def timestamp(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})', value):
        raise ValueError('timestamp must be an ISO string with timezone')
    parsed = datetime.fromisoformat(value.replace('t', 'T').replace('z', 'Z'))
    if parsed.tzinfo is None:
        raise ValueError('timestamp requires timezone')
    return parsed


def check_policy(policy):
    if policy.get('schema') != 'category-quality-policy-v1' or set(policy.get('categories', {})) != set(CATEGORIES):
        raise ValueError('policy must explicitly cover every v2 category')
    for row in policy['categories'].values():
        # AH-02's integrity invariants cannot be disabled by lowering a ratio.
        if (type(row.get('min_items')) is not int or row['min_items'] < 1
                or type(row.get('min_verified_ratio')) not in (int, float) or row['min_verified_ratio'] != 1
                or type(row.get('max_hard_errors')) is not int or row['max_hard_errors'] != 0
                or type(row.get('max_age_days')) is not int or row['max_age_days'] < 0
                or not isinstance(row.get('reason'), str) or not row['reason'].strip()):
            raise ValueError('invalid or weakened category policy')


def content(rows):
    return [{k: v for k, v in row.items() if k not in VOLATILE} for row in rows]


def eligible(rows, category, policy, checked_at, fresh=True):
    problems = []
    if not isinstance(rows, list):
        return ['category_not_array']
    if len(rows) < policy['min_items']:
        problems.append('below_min_items')
    seen = set()
    for index, row in enumerate(rows):
        prepared, issues = prepare_item(row, category)
        if not issues:
            if prepared['contract_state'] != 'current':
                issues.append('legacy_not_publishable')
            if prepared.get('verified') is not True or prepared.get('complete') is not True:
                issues.append('not_verified_complete')
            issues.extend(review_reasons(prepared, category))
            if prepared.get('review_reasons'):
                issues.append('unresolved_review')
            if prepared.get('url_status') != 'verified':
                issues.append('source_validation_missing')
            try:
                if timestamp(prepared.get('verified_at')) > timestamp(checked_at):
                    issues.append('future_verification')
            except (TypeError, ValueError):
                issues.append('invalid_verified_at')
            identity = prepared['item_id']
            if identity in seen:
                issues.append('duplicate_identity')
            seen.add(identity)
            if fresh:
                date = prepared.get('release_date' if category == 'models' else 'date')
                age = (timestamp(checked_at).date() - datetime.fromisoformat(date).date()).days
                if not 0 <= age <= policy['max_age_days']:
                    issues.append('outside_publication_window')
        problems.extend(f'items[{index}]:{issue}' for issue in issues)
    return problems


def reliable(record, category, policy, now):
    if not isinstance(record, dict):
        return None, ['no_last_known_good']
    try:
        if record.get('schema') != 'category-lkg-v1' or record.get('category') != category:
            raise ValueError('invalid_lkg_record')
        rows = record['items']
        if digest(rows) != record['sha256']:
            raise ValueError('lkg_hash_mismatch')
        updated = timestamp(record['updated_at'])
        checked = timestamp(record['checked_at'])
        last_checked = timestamp(record.get('last_checked_at', record['checked_at']))
        if updated > checked or checked > last_checked or last_checked > timestamp(now):
            raise ValueError('invalid_lkg_timestamps')
        problems = eligible(rows, category, policy, record['checked_at'], fresh=False)
        if problems:
            return None, problems
        return deepcopy(record), []
    except (KeyError, ValueError, TypeError) as exc:
        return None, [str(exc)]


def decide(candidate, previous, checked_at, policy, merge=None, previous_checked=None):
    """Candidate categories have fetch status plus independently validated rows.

    `original` is lossless input; `items` is validator output, never trusted merely
    because a fetcher labels it verified. Daily adapter owns actual validation.
    """
    check_policy(policy)
    now = timestamp(checked_at)
    previous_checked = previous_checked or {}
    data, updated, checked, outcomes, lkg, validated, quarantine = {}, {}, {}, {}, {}, {}, []
    reports = {}
    for category in CATEGORIES:
        rule = policy['categories'][category]
        old, prior_errors = reliable(previous.get(category), category, rule, checked_at)
        prior_checked = previous_checked.get(category)
        if prior_checked is not None:
            try:
                if timestamp(prior_checked) > now:
                    raise ValueError('future check')
            except (ValueError, TypeError):
                prior_errors.append('invalid_previous_checked_at')
                prior_checked = None
        entry = candidate.get(category, {'status': 'fetch_failed', 'reasons': ['missing_candidate']})
        if not isinstance(entry, dict):
            entry = {'status':'success', 'items':None, 'original':deepcopy(entry), 'reasons':['invalid_candidate_entry']}
        status = entry.get('status')
        reasons = list(entry.get('reasons', []))
        rows = entry.get('items')
        input_count = entry.get('input_count', len(rows) if isinstance(rows, list) else None)
        eligible_count = sum(not eligible([row], category, {**rule, 'min_items': 1}, checked_at) for row in rows) if status == 'success' and isinstance(rows, list) else 0
        if status not in ('success', 'no_change', 'fetch_failed', 'not_scheduled'):
            status = 'fetch_failed'
            reasons.append('invalid_fetch_status')
        outcome = status
        if status == 'success':
            reasons += eligible(rows, category, rule, checked_at)
            if reasons:
                outcome = 'validation_failed'
            else:
                validated[category] = deepcopy(rows)
                if merge:
                    rows = merge(category, rows, old['items'] if old else [], now)
                reasons += eligible(rows, category, rule, checked_at)
                if reasons:
                    outcome = 'validation_failed'
                else:
                    same = old is not None and content(rows) == content(old['items'])
                    outcome = 'no_change' if same else 'updated'
                    # Exact old payload/timestamp on no-change, no incidental freshness rewrite.
                    if not same:
                        old = {'schema': 'category-lkg-v1', 'category': category,
                               'items': deepcopy(rows), 'updated_at': checked_at,
                               'checked_at': checked_at, 'sha256': digest(rows)}
        elif status == 'no_change' and rows != []:
            outcome = 'validation_failed'
            reasons.append('no_change_requires_explicit_empty_result')
        if outcome in ('validation_failed', 'fetch_failed'):
            quarantine.append({'category': category, 'source_location': entry.get('source_location'),
                               'reasons': reasons or [outcome], 'original': deepcopy(entry.get('original'))})
        if old:
            if status != 'not_scheduled':
                checked[category] = checked_at
            else:
                checked[category] = prior_checked or old.get('last_checked_at', old['checked_at'])
            old['last_checked_at'] = checked[category]
            # LKG checked_at is the last successful category check, not a failed attempt.
            if outcome in ('updated', 'no_change'):
                old['checked_at'] = checked_at
            lkg[category] = old
            data[category] = deepcopy(old['items'])
            updated[category] = old['updated_at']
            serving = 'current' if outcome == 'updated' else 'last_known_good'
        else:
            data[category] = []
            if status != 'not_scheduled':
                checked[category] = checked_at
            elif prior_checked:
                checked[category] = prior_checked
            serving = 'no_reliable_data'
        outcomes[category] = {'attempt': outcome, 'serving': serving}
        reports[category] = {'outcome': outcomes[category], 'reasons': reasons,
                             'previous_errors': prior_errors, 'policy': deepcopy(rule),
                             'candidate_count': input_count, 'eligible_count': eligible_count,
                             'verified_ratio': eligible_count / input_count if input_count else None,
                             'published_count': len(data[category])}
    published = {'schema_version': 2, 'date': now.date().isoformat(), 'time': checked_at,
                 'generated_at': now.strftime('%H:%M'), 'source': 'local', 'data': data,
                 'stats': {cat: len(rows) for cat, rows in data.items()},
                 '_updated_at': updated, '_checked_at': checked, '_update_outcome': outcomes}
    total = sum(published['stats'].values())
    published['validation'] = {'scope': 'selected_category_data', 'total': total,
                               'verified': total, 'needs_review': 0, 'pass_rate': 100 if total else 0,
                               'categories': reports}
    problems = errors(published, load_schema('latest.schema.json'))
    if problems:
        raise ValueError('; '.join(problems))
    return {'published': published, 'last_known_good': lkg, 'validated': validated,
            'quarantine': quarantine, 'report': reports}
