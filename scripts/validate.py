#!/usr/bin/env python3
"""
Comprehensive 8-step validation script for AI News Hub.

This script validates all items in data/latest.json against:
1. URL liveness + Title-URL consistency checks (GET page, compare <title>/<h1> vs claimed title)
2. Domain whitelist verification
3. Field completeness
4. Date reasonableness
5. Duplicate detection
6. Auto-fix (unless --dry-run)
7. Validation reporting
8. Title mismatch removal (hallucination detection)
"""

import json
import sys
import os
import argparse
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
import time
from difflib import SequenceMatcher
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from contracts.data_v2 import (canonical_url, source_url, prepare_item, legacy_model,
                               review_reasons, envelope_errors, CATEGORIES)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Trusted domains whitelist
TRUSTED_DOMAINS = {
    # Research & Papers
    'arxiv.org',
    'paperswithcode.com',
    'semanticscholar.org',
    # AI Companies
    'openai.com',
    'anthropic.com',
    'deepmind.google',
    'ai.meta.com',
    'microsoft.com',
    'research.google',
    'github.com',
    'huggingface.co',
    'nvidia.com',
    'apple.com',
    'stability.ai',
    'midjourney.com',
    'cohere.com',
    'mistral.ai',
    # Cloud Providers
    'cloud.google.com',
    'aws.amazon.com',
    'alibabacloud.com',
    'ai.google.dev',
    'developers.googleblog.com',
    'blog.google',
    'azure.microsoft.com',
    'cloudflare.com',
    # Global Tech Media
    'techcrunch.com',
    'theverge.com',
    'venturebeat.com',
    'wired.com',
    'technologyreview.com',
    'bloomberg.com',
    'reuters.com',
    'arstechnica.com',
    'theinformation.com',
    'news.ycombinator.com',
    'aibusiness.com',
    'aimagazine.com',
    'therundown.ai',
    'zdnet.com',
    'infoworld.com',
    # Taiwan Media
    'ithome.com.tw',
    'cna.com.tw',
    'digitimes.com.tw',
    'technews.tw',
    'thenewslens.com',
    'inside.com.tw',
    'panx.asia',
    'aiposthub.com',
    'fsc.gov.tw',
    'moda.gov.tw',
    'ndc.gov.tw',
    # China Media
    '36kr.com',
    'jiqizhixin.com',
    'qbitai.com',
    'zhihu.com',
    'baidu.com',
    # Consulting & Analyst Firms
    'deloitte.com',
    'kpmg.com',
    'pwc.com',
    'ey.com',
    'bcg.com',
    'mckinsey.com',
    'idc.com',
    'gartner.com',
    'forrester.com',
    # Governance & Standards
    'nist.gov',
    'whitehouse.gov',
    'owasp.org',
    'oecd.org',
    'europa.eu',
    # Frameworks & Tools
    'pytorch.org',
    'tensorflow.org',
    'langchain.com',
    'llamaindex.ai',
    # Social & Others
    'medium.com',
    'youtube.com',
    'x.com',
    'twitter.com',
    'reddit.com',
    'linkedin.com',
    'coursera.org',
    'edx.org',
    'deeplearning.ai',
    'learn.microsoft.com',
}

# Tier B 擴充白名單（learning-loop v1 L-3；add-only，只增不減，決策 4）
# 由 apply-change.mjs add_domain 維護（整檔即 TIER_B_DOMAINS 區段），validate.py 只讀不寫。
TIER_B_DOMAINS_PATH = Path(__file__).parent / 'tier-b-domains.json'
SOURCES_REGISTRY_PATH = Path(__file__).parent / 'sources-registry.json'
OFFICIAL_AI_SOURCES_PATH = Path(__file__).parent.parent / 'skills' / 'official-ai-ecosystem-research' / 'references' / 'official-sources.json'


def load_official_ai_sources(path=OFFICIAL_AI_SOURCES_PATH):
    """Load the single approved company-to-domain registry for enterprise ecosystem items."""
    try:
        doc = json.loads(Path(path).read_text(encoding='utf-8'))
        return {
            str(source['company']): {
                str(domain).lower().removeprefix('www.')
                for domain in source.get('domains', [])
                if isinstance(domain, str) and domain.strip()
            }
            for source in doc.get('sources', [])
            if isinstance(source, dict) and isinstance(source.get('company'), str)
        }
    except (OSError, json.JSONDecodeError, AttributeError):
        return {}


OFFICIAL_AI_COMPANY_DOMAINS = load_official_ai_sources()
OFFICIAL_AI_DOMAINS = set().union(*OFFICIAL_AI_COMPANY_DOMAINS.values()) if OFFICIAL_AI_COMPANY_DOMAINS else set()


def _normalize_domain(d):
    d = str(d).strip().lower()
    if d.startswith('www.'):
        d = d[4:]
    return d


def load_tier_b_domains(path=TIER_B_DOMAINS_PATH):
    """讀 tier-b-domains.json 的 domains[]；檔案缺失／格式錯誤一律回空集合，不中斷驗證。"""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            doc = json.load(f)
        raw = doc.get('domains', []) if isinstance(doc, dict) else []
        return {_normalize_domain(d) for d in raw if isinstance(d, str) and d.strip()}
    except FileNotFoundError:
        return set()
    except Exception as e:
        logger.warning(f"tier-b-domains.json unreadable, ignored: {e}")
        return set()


def merge_tier_b(trusted, tier_b):
    """add-only：只把 tier_b 併入 trusted，絕不移除既有項目。"""
    trusted |= set(tier_b)
    return trusted


TRUSTED_DOMAINS = merge_tier_b(TRUSTED_DOMAINS, load_tier_b_domains())

# Required fields per category


USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"


def get_repo_root():
    """Get the repository root based on script location."""
    script_dir = Path(__file__).parent.resolve()
    return script_dir.parent


def load_latest_json(repo_root):
    """Load data/latest.json with proper error handling."""
    latest_path = repo_root / 'data' / 'latest.json'

    if not latest_path.exists():
        logger.warning(f"File not found: {latest_path}")
        sys.exit(0)

    try:
        with open(latest_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse JSON: {e}")
        sys.exit(1)


def fetch_page(url):
    """
    Fetch page content via GET request.
    Returns: (status_code: int, html: str or None)
    """
    try:
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return 0, None

        request = urllib.request.Request(url, method='GET')
        request.add_header('User-Agent', USER_AGENT)
        request.add_header('Accept', 'text/html,application/xhtml+xml')
        request.add_header('Accept-Language', 'zh-TW,zh;q=0.9,en;q=0.8')

        with urllib.request.urlopen(request, timeout=15) as response:
            status = response.status
            if 200 <= status < 400:
                charset = response.headers.get_content_charset() or 'utf-8'
                html = response.read(64000).decode(charset, errors='replace')
                return status, html
            return status, None
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception:
        return 0, None


def extract_page_title(html):
    """Extract <title> and first <h1> from HTML."""
    import re
    titles = []

    # Extract <title>
    m = re.search(r'<title[^>]*>(.*?)</title>', html, re.IGNORECASE | re.DOTALL)
    if m:
        title = re.sub(r'<[^>]+>', '', m.group(1)).strip()
        # Remove common suffixes like " - TechCrunch", " | Reuters"
        title = re.split(r'\s*[|\-–—]\s*(?=[A-Z\u4e00-\u9fff])', title)[0].strip()
        if title:
            titles.append(title)

    # Extract first <h1>
    m = re.search(r'<h1[^>]*>(.*?)</h1>', html, re.IGNORECASE | re.DOTALL)
    if m:
        h1 = re.sub(r'<[^>]+>', '', m.group(1)).strip()
        if h1:
            titles.append(h1)

    return titles


def title_similarity(claimed_title, page_titles):
    """
    Compare claimed title against page titles.
    Returns best similarity score (0.0 ~ 1.0).
    """
    if not page_titles:
        return 0.0

    best = 0.0
    # Normalize: lowercase, strip whitespace
    claimed = claimed_title.lower().strip()

    for pt in page_titles:
        pt_lower = pt.lower().strip()
        # Full SequenceMatcher
        score = SequenceMatcher(None, claimed, pt_lower).ratio()
        best = max(best, score)

        # Also check if claimed title is a substring of page title or vice versa
        if claimed in pt_lower or pt_lower in claimed:
            best = max(best, 0.7)

        # Check keyword overlap (split by spaces, count common words)
        claimed_words = set(claimed.split())
        page_words = set(pt_lower.split())
        if claimed_words and page_words:
            overlap = len(claimed_words & page_words) / max(len(claimed_words), len(page_words))
            best = max(best, overlap)

    return best


# Domains where <title> often doesn't match article titles
# (arxiv shows IDs, Chinese news sites use different formats, etc.)
TITLE_CHECK_RELAXED_DOMAINS = {
    'arxiv.org', 'paperswithcode.com', 'semanticscholar.org',
    'huggingface.co', 'github.com',
    'linkedin.com', 'x.com', 'twitter.com', 'reddit.com',
    'youtube.com', 'medium.com',
    '163.com', 'caixin.com', 'people.com.cn', 'guancha.cn',
    'eastmoney.com', 'chinatechnews.com', 'zhihu.com',
    'skilljar.com', 'coursera.org', 'edx.org',
}


def check_url_and_title(url, claimed_title=''):
    """
    Check URL liveness AND verify title consistency.
    Returns: (verified: bool|None, status: str, title_score: float)
    """
    try:
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return False, 'invalid_url', 0.0

        domain = parsed.netloc.lower()
        if domain.startswith('www.'):
            domain = domain[4:]
        # Check if domain requires relaxed title checking
        # Use exact match or subdomain match (e.g. sub.arxiv.org) to prevent
        # fake-arxiv.org from matching arxiv.org via endswith()
        relaxed = any(domain == d or domain.endswith('.' + d) for d in TITLE_CHECK_RELAXED_DOMAINS)

        # First try HEAD to check liveness quickly
        request = urllib.request.Request(url, method='HEAD')
        request.add_header('User-Agent', USER_AGENT)

        head_ok = False
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                if 200 <= response.status < 400:
                    head_ok = True
                elif response.status == 403:
                    return None, 'needs_review', 0.0
                elif response.status in [404, 410]:
                    return False, 'not_found', 0.0
                elif response.status >= 500:
                    return False, 'server_error', 0.0
        except urllib.error.HTTPError as e:
            if e.code == 405:
                head_ok = True  # Will use GET below
            elif e.code == 403:
                return None, 'needs_review', 0.0
            elif e.code in [404, 410]:
                return False, 'not_found', 0.0
            elif e.code >= 500:
                return False, 'server_error', 0.0
            else:
                return False, f'http_error_{e.code}', 0.0
        except (urllib.error.URLError, TimeoutError):
            return False, 'connection_error', 0.0
        except Exception:
            return False, 'unknown_error', 0.0

        # For relaxed domains, just verify liveness (title format unreliable)
        if relaxed:
            return (True, 'verified', 0.0) if head_ok else (None, 'needs_review', 0.0)

        # Now fetch full page for title verification
        if claimed_title:
            status_code, html = fetch_page(url)
            if html:
                page_titles = extract_page_title(html)
                score = title_similarity(claimed_title, page_titles)
                if score >= 0.3:
                    return True, 'verified', score
                elif score > 0:
                    # Partial match — URL alive, title differs (often translation)
                    # Mark as needs_review, don't remove
                    return None, 'title_low_match', score
                else:
                    # Zero match — likely hallucinated URL
                    return False, 'title_mismatch', score
            elif status_code == 403:
                # Can't read page (paywall etc), trust URL liveness
                return None, 'needs_review', 0.0
            elif status_code >= 400:
                return False, f'http_error_{status_code}', 0.0
            else:
                # Fetch failed but HEAD was ok — trust liveness
                return True if head_ok else None, 'verified_no_title', 0.0

        # No title to check — just verify liveness
        return True if head_ok else None, 'verified', 0.0

    except Exception:
        return False, 'unknown_error', 0.0


def check_domain_whitelist(url):
    """Check if URL domain is in whitelist. Returns: (is_trusted: bool, domain: str)"""
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower()

        # Remove 'www.' prefix if present
        if domain.startswith('www.'):
            domain = domain[4:]

        is_trusted = domain in TRUSTED_DOMAINS
        return is_trusted, domain
    except Exception:
        return False, 'unknown'


def check_official_ai_domain(url):
    """Require an approved first-party host; approved parent domains also cover subdomains."""
    try:
        host = (urlparse(url).hostname or '').lower().removeprefix('www.')
        return bool(host) and any(host == domain or host.endswith('.' + domain)
                                  for domain in OFFICIAL_AI_DOMAINS), host or 'unknown'
    except (TypeError, ValueError):
        return False, 'unknown'


def check_official_ai_company_domain(company, url):
    """Require the exact approved company name and one of that company's domains."""
    domains = OFFICIAL_AI_COMPANY_DOMAINS.get(company)
    if not domains:
        return False, 'unregistered_company'
    try:
        host = (urlparse(url).hostname or '').lower().removeprefix('www.')
        return bool(host) and any(host == domain or host.endswith('.' + domain)
                                  for domain in domains), host or 'unknown'
    except (TypeError, ValueError):
        return False, 'unknown'


# Per-category maximum age in days (None = use default 90)
CATEGORY_DATE_LIMITS = {
    'papers': 90,
    'topnews': 1,
    'taiwan': 1,
    'china': 1,
    'usa': 1,
    'techtrends': 7,
    'governance': 7,
    'tutorials': 90,
    'courses': 90,
    'official_info': 30,
    'models': 90,
    'skills': 90,
}


def validate_date(date_str, allow_future=False, no_limit=False, max_days=90):
    """
    Validate date format (YYYY-MM-DD) and reasonableness.
    Returns: (is_valid: bool, error_msg: str)
    """
    if not date_str or not isinstance(date_str, str):
        return False, 'empty_or_invalid_type'

    try:
        parsed_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        if parsed_date.isoformat() != date_str:
            return False, 'invalid_format'
        today = datetime.now(timezone(timedelta(hours=8))).date()

        # No date range restriction
        if no_limit:
            return True, ''

        # Check if date is in reasonable range
        if allow_future:
            # For models release_date: allow future dates, up to 2 years old
            if parsed_date < today - timedelta(days=730):
                return False, 'date_too_old'
        else:
            if parsed_date > today or parsed_date < today - timedelta(days=max_days):
                return False, 'date_out_of_range'

        return True, ''
    except ValueError:
        return False, 'invalid_format'


def validate_required_fields(item, category):
    """Compatibility entry point; v2 schemas are the single structural authority."""
    _, issues = prepare_item(item, category)
    return not issues, issues


def similarity(a, b):
    """Calculate string similarity using SequenceMatcher."""
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def remove_duplicates(items, category=None):
    """Remove duplicates by URL match and title similarity > 0.8."""
    seen_urls = set()
    seen_titles = []
    result = []
    removed_count = 0

    for item in items:
        url = canonical_url(source_url(item))
        title = item.get('model_name') if isinstance(item.get('model_name'), str) else item.get('title', '')

        if category == 'models':
            title = '|'.join(str(item.get(k) or '').strip().lower()
                             for k in ('institution', 'model_name', 'version'))
        elif category == 'official_info':
            title = '|'.join(str(item.get(k) or '').strip().lower()
                             for k in ('company', 'title'))

        # Check URL duplicate
        if url in seen_urls:
            removed_count += 1
            continue

        # Check title similarity
        is_duplicate = False
        for seen_title in seen_titles:
            if (title == seen_title if category in ('models', 'official_info') else similarity(title, seen_title) > 0.8):
                is_duplicate = True
                break

        if is_duplicate:
            removed_count += 1
            continue

        seen_urls.add(url)
        seen_titles.append(title)
        result.append(item)

    return result, removed_count


def validate_items(data, category_filter=None, dry_run=False, offline=False, schema_version=1):
    """Reject invalid structure before dedup/network; compose qualification exactly once."""
    if not isinstance(data, dict):
        raise ValueError('category data must be an object')
    categories = [category_filter] if category_filter else list(data)
    if any(cat not in CATEGORIES or not isinstance(data.get(cat), list) for cat in categories):
        raise ValueError('unknown category or category is not an array')
    results = {'date': datetime.now().isoformat(), 'dry_run':dry_run, 'total_items':0,
               'verified':0, 'needs_review':0, 'warnings':0, 'removed':0,
               'details':{}, 'per_item_results':{}, 'schema_errors':[],
               'legacy_compatible':[], 'evidence_needs_review':[], 'quarantine':[]}
    candidates = {}
    for cat in categories:
        detail = {'total':len(data[cat]), 'verified':0, 'needs_review':0, 'warnings':0, 'removed_items':[], 'items':[]}
        results['details'][cat] = detail
        results['total_items'] += len(data[cat])
        candidates[cat] = []
        for idx, item in enumerate(data[cat]):
            original = item
            item, schema_issues = prepare_item(original, cat)
            if schema_version == 2 and isinstance(original, dict) and original.get('schema_version') != 2:
                schema_issues.append('v2 envelope requires v2 items')
            location = {'category': cat, 'index': idx}
            issues = list(schema_issues)
            evidence_issues = []
            if schema_issues:
                results['schema_errors'].append({**location, 'reasons': schema_issues})
            else:
                if item['contract_state'] == 'legacy':
                    results['legacy_compatible'].append({**location, 'item_id': item['item_id']})
                evidence_issues = review_reasons(item, cat)
                date_field = 'release_date' if cat == 'models' else 'date'
                # Offline contract checks read old archives without freshness/network policy.
                valid, reason = validate_date(item.get(date_field), no_limit=offline,
                                              max_days=CATEGORY_DATE_LIMITS.get(cat) or 90)
                if not valid:
                    issues.append(f'Invalid {date_field}: {reason}')
                url = source_url(item)
                if cat in ('official_info', 'models'):
                    company = item.get('company') if cat == 'official_info' else item.get('institution')
                    official, domain = check_official_ai_company_domain(company, url)
                    mismatched = any(not check_official_ai_company_domain(company, value)[0]
                                     for value in item.get('evidence_urls', []))
                    item['official_source'] = official and not mismatched
                    if not official or mismatched:
                        reason = f'Non-official or company-mismatched evidence: {company}: {domain}'
                        if legacy_model(item, cat):
                            evidence_issues.append(reason)
                        else:
                            issues.append(reason)
            if issues:
                detail['items'].append({'index':idx, 'issues':issues, 'remove':True,
                                        'classification':'schema_error' if schema_issues else 'quarantine'})
                detail['removed_items'].append(source_url(item) if isinstance(item, dict) else '')
                results['quarantine'].append({**location, 'reasons': issues, 'original': original})
                detail['warnings'] += 1; results['warnings'] += 1; results['removed'] += 1
            else:
                item['review_reasons'] = evidence_issues
                if evidence_issues:
                    results['evidence_needs_review'].append({**location, 'item_id': item['item_id'], 'reasons': evidence_issues})
                candidates[cat].append(item)
        candidates[cat], duplicates = remove_duplicates(candidates[cat], cat)
        results['removed'] += duplicates

    url_status = {}
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {}
        count = 0
        for cat in categories:
            for idx, item in enumerate(candidates[cat]):
                if not offline and count and count % 3 == 0:
                    time.sleep(0.5)
                count += 1
                if offline:
                    url_status[(cat, idx)] = (None, 'offline_not_checked', 0.0)
                    continue
                future = executor.submit(check_url_and_title, source_url(item), item.get('source_title') or '')
                futures[future] = (cat, idx)
        for future in as_completed(futures):
            key = futures[future]
            try:
                url_status[key] = future.result()
            except Exception:
                url_status[key] = (False, 'validation_error', 0.0)

    for cat in categories:
        kept, detail = [], results['details'][cat]
        for idx, item in enumerate(candidates[cat]):
            verified, status, score = url_status[(cat, idx)]
            if verified is True and item.get('review_reasons'):
                verified, status = None, 'evidence_needs_review'
            item['verified'] = True if verified is True else 'needs_review' if verified is None else False
            item['complete'] = not bool(item.get('review_reasons'))
            item['url_status'] = status
            item['title_score'] = round(score or 0, 2)
            item['verified_at'] = datetime.now(timezone(timedelta(hours=8))).isoformat()
            trusted, domain = check_domain_whitelist(source_url(item))
            issues = [] if trusted else [f'Untrusted domain: {domain}']
            if verified is True:
                detail['verified'] += 1; results['verified'] += 1
            elif verified is None:
                detail['needs_review'] += 1; results['needs_review'] += 1
                issues.append(f'Source needs review: {status}')
            else:
                results['removed'] += 1; detail['removed_items'].append(source_url(item))
                results['quarantine'].append({'category': cat, 'index': idx, 'reasons': [status], 'original': item.copy()})
                issues.append(f'URL failed: {status}')
            if issues:
                detail['warnings'] += 1; results['warnings'] += 1
            detail['items'].append({'index':idx, 'url':source_url(item), 'issues':issues, 'remove':verified is False})
            if verified is True or verified is None:
                kept.append(item)
        data[cat] = kept
    return results


def write_validation_report(repo_root, results):
    """Write validation report to data/logs/validate-YYYY-MM-DD.json"""
    logs_dir = repo_root / 'data' / 'logs'
    logs_dir.mkdir(parents=True, exist_ok=True)

    report_date = datetime.now().strftime('%Y-%m-%d')
    report_path = logs_dir / f'validate-{report_date}.json'

    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    logger.info(f"Validation report written to {report_path}")


def save_latest_json(repo_root, data, results, output_path=None):
    """Save updated data to data/latest.json"""
    latest_path = Path(output_path) if output_path else repo_root / 'data' / 'latest.json'

    # Add validation summary
    validation_summary = {
        'total': results['total_items'],
        'verified': results['verified'],
        'needs_review': results['needs_review'],
        'warnings': results['warnings'],
        'removed': results['removed'],
        'pass_rate': round(results['verified'] / results['total_items'] * 100, 2) if results['total_items'] > 0 else 0
    }

    # Update validation summary at top level
    data['validation'] = validation_summary

    # Update stats counts if present
    if 'data' in data and isinstance(data['data'], dict):
        data['stats'] = {cat: len(items) for cat, items in data['data'].items() if isinstance(items, list)}

    temporary = latest_path.with_name(latest_path.name + '.tmp')
    with open(temporary, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(temporary, latest_path)

    logger.info(f"Updated {latest_path}")


def run_self_test():
    """不打網路的自測：tier-b 載入、add-only 合併、白名單判定、registry 結構。"""
    import tempfile
    failures = []

    def check(name, cond):
        print(f"  [{'PASS' if cond else 'FAIL'}] {name}")
        if not cond:
            failures.append(name)

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        check('missing tier-b file -> empty set', load_tier_b_domains(td / 'nope.json') == set())
        bad = td / 'bad.json'
        bad.write_text('{not json', encoding='utf-8')
        check('malformed tier-b file -> empty set', load_tier_b_domains(bad) == set())
        good = td / 'good.json'
        good.write_text(json.dumps({'schema': 'tier-b-domains-v0.1',
                                    'domains': ['WWW.Example-B.com', 'sub.example-b.org', '', 7]}),
                        encoding='utf-8')
        loaded = load_tier_b_domains(good)
        check('lowercase + strip www. + drop empty/non-str',
              loaded == {'example-b.com', 'sub.example-b.org'})
        base = {'arxiv.org', 'openai.com'}
        merged = merge_tier_b(set(base), loaded)
        check('merge is add-only (base kept)', base <= merged and loaded <= merged)
        check('merge adds nothing else', merged == base | loaded)

    real = load_tier_b_domains()
    check('repo tier-b-domains.json readable and non-empty', len(real) > 0)
    check('repo tier-b domains all merged into TRUSTED_DOMAINS', real <= TRUSTED_DOMAINS)
    sample = sorted(real)[0]
    ok, dom = check_domain_whitelist(f'https://www.{sample}/x/y')
    check(f'check_domain_whitelist accepts tier-b domain ({sample})', ok and dom == sample)
    ok2, _ = check_domain_whitelist('https://definitely-not-listed.invalid/')
    check('check_domain_whitelist rejects unlisted domain', not ok2)
    check('skills accepts a non-negative integer star count',
          validate_required_fields({'title':'owner/repo', 'source':'GitHub',
                                    'date':'2026-09-18', 'summary':'x',
                                    'url':'https://github.com/owner/repo', 'stars':1},
                                   'skills')[0])
    check('skills rejects a formatted string star count',
          not validate_required_fields({'title':'owner/repo', 'source':'GitHub',
                                        'date':'2026-09-18', 'summary':'x',
                                        'url':'https://github.com/owner/repo', 'stars':'1'},
                                       'skills')[0])
    check('official source registry readable and non-empty', len(OFFICIAL_AI_DOMAINS) >= 12)
    check('official source accepts approved subdomain', check_official_ai_domain('https://platform.openai.com/docs/models')[0])
    check('official source rejects media domain', not check_official_ai_domain('https://example.com/model')[0])
    check('company source accepts matching domain', check_official_ai_company_domain('OpenAI', 'https://platform.openai.com/docs/models')[0])
    check('company source rejects another approved company domain', not check_official_ai_company_domain('Anthropic', 'https://openai.com/news/')[0])
    try:
        with open(TIER_B_DOMAINS_PATH, 'r', encoding='utf-8') as f:
            doc = json.load(f)
        check('tier-b schema tag', doc.get('schema') == 'tier-b-domains-v0.1')
        ds = doc.get('domains', [])
        check('tier-b domains sorted lowercase unique',
              ds == sorted(set(ds)) and all(d == d.lower() and '/' not in d for d in ds))
    except Exception as e:
        check(f'tier-b file parse ({e})', False)

    try:
        with open(SOURCES_REGISTRY_PATH, 'r', encoding='utf-8') as f:
            reg = json.load(f)
        cats = reg.get('categories', {})
        check('registry schema tag', reg.get('schema') == 'sources-registry-v0.1')
        check('registry checked_at is YYYY-MM-DD',
              bool(datetime.strptime(str(reg.get('checked_at', '')), '%Y-%m-%d')))
        check('registry has every editorial discovery category', set(cats) == set(CATEGORIES) - {'skills'})
        check('registry every category >= 3 feeds', all(len(v) >= 3 for v in cats.values()))
        entries = [e for v in cats.values() for e in v]
        check('registry entries have name/tier/feed/type',
              all(e.get('name') and e.get('tier') in ('A', 'B', 'C')
                  and str(e.get('feed', '')).startswith('https://')
                  and e.get('type') in ('rss', 'atom', 'rdf') for e in entries))
        check('registry feeds unique within each category',
              all(len({e['feed'] for e in v}) == len(v) for v in cats.values()))
    except Exception as e:
        check(f'registry parse ({e})', False)

    total = len(failures)
    print(f"self-test: {total} failed")
    return 1 if failures else 0



def main():
    parser = argparse.ArgumentParser(
        description='Comprehensive validation script for AI News Hub'
    )
    parser.add_argument(
        '--category',
        type=str,
        default=None,
        help='Validate single category only'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Report only, do not modify files'
    )
    parser.add_argument(
        '--self-test',
        action='store_true',
        help='Run offline self-tests (tier-b whitelist merge, registry shape) and exit'
    )

    parser.add_argument('--offline', action='store_true', help='Read-only schema/legacy checks; no network or freshness rejection')
    parser.add_argument('--input', type=Path, help='Candidate JSON (default data/latest.json)')
    parser.add_argument('--output', type=Path, help='Validated output path')
    args = parser.parse_args()

    if args.self_test:
        return run_self_test()

    repo_root = get_repo_root()
    logger.info(f"Repository root: {repo_root}")

    # An invalid/missing input is a processing failure, never a successful empty run.
    try:
        latest = json.loads((args.input or repo_root / 'data/latest.json').read_text(encoding='utf-8'))
        if not isinstance(latest, dict) or not isinstance(latest.get('data'), dict):
            raise ValueError('latest.data must be an object')
        problems = envelope_errors(latest)
        if problems:
            raise ValueError('; '.join(problems))
        data = latest['data']
        if not data:
            raise ValueError('category data is empty')
    except (OSError, ValueError) as error:
        logger.error('Invalid input: %s', error)
        return 1

    # Run validation
    logger.info("Starting 7-step validation...")
    try:
        results = validate_items(data, category_filter=args.category, dry_run=args.dry_run or args.offline,
                                 offline=args.offline, schema_version=latest.get('schema_version', 1))
    except ValueError as error:
        logger.error('Invalid category data: %s', error)
        return 1

    if args.offline:
        print(json.dumps({key: results[key] for key in ('schema_errors', 'legacy_compatible', 'evidence_needs_review', 'quarantine')}, ensure_ascii=False, indent=2))
        return 1 if results['schema_errors'] or results['quarantine'] else 0

    # Write report
    if not args.dry_run and not args.offline:
        write_validation_report(repo_root, results)
    if not any(data.values()):
        logger.error('No usable items remain after validation')
        return 1

    # Save updated data (unless dry-run)
    if not args.dry_run and not args.offline:
        latest['data'] = data
        # A filtered run leaves other categories untouched, so retains the root version.
        if not args.category:
            latest['schema_version'] = 2
        save_latest_json(repo_root, latest, results, args.output or args.input)

    # Print summary
    logger.info("=" * 60)
    logger.info("VALIDATION SUMMARY")
    logger.info("=" * 60)
    logger.info(f"Total items: {results['total_items']}")
    logger.info(f"Verified: {results['verified']}")
    logger.info(f"Warnings: {results['warnings']}")
    logger.info(f"Removed: {results['removed']}")
    pass_rate = round(results['verified'] / results['total_items'] * 100, 2) if results['total_items'] > 0 else 0
    logger.info(f"Pass rate: {pass_rate}%")
    logger.info("=" * 60)

    if args.dry_run:
        logger.info("DRY RUN - No files modified")

    return 0


if __name__ == '__main__':
    sys.exit(main())
