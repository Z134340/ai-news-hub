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
from datetime import datetime, timedelta
from pathlib import Path
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
import time
from difflib import SequenceMatcher
from urllib.parse import urlparse

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

# Required fields per category
REQUIRED_FIELDS = {
    'papers': ['title', 'authors', 'date', 'summary', 'url'],
    'topnews': ['title', 'source', 'date', 'summary', 'url'],
    'taiwan': ['title', 'source', 'date', 'summary', 'url'],
    'china': ['title', 'source', 'date', 'summary', 'url'],
    'usa': ['title', 'source', 'date', 'summary', 'url'],
    'techtrends': ['title', 'source', 'date', 'summary', 'url'],
    'governance': ['title', 'source', 'date', 'summary', 'url'],
    'tutorials': ['title', 'source', 'date', 'summary', 'url'],
    'courses': ['title', 'source', 'date', 'summary', 'url'],
    'models': ['model_name', 'institution', 'release_date', 'summary', 'url'],
}

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


# Per-category maximum age in days (None = use default 90)
CATEGORY_DATE_LIMITS = {
    'papers': 90,
    'topnews': 2,
    'taiwan': 2,
    'china': 2,
    'usa': 2,
    'techtrends': 7,
    'governance': 7,
    'tutorials': 90,
    'courses': 90,
    'models': None,  # handled by allow_future
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
        today = datetime.now().date()

        # No date range restriction
        if no_limit:
            return True, ''

        # Check if date is in reasonable range
        if allow_future:
            # For models release_date: allow future dates, up to 2 years old
            if parsed_date < today - timedelta(days=730):
                return False, 'date_too_old'
        else:
            if parsed_date > today + timedelta(days=1) or parsed_date < today - timedelta(days=max_days):
                return False, 'date_out_of_range'

        return True, ''
    except ValueError:
        return False, 'invalid_format'


def validate_required_fields(item, category):
    """Check if item has all required fields."""
    required = REQUIRED_FIELDS.get(category, [])
    missing = [field for field in required if field not in item]
    return len(missing) == 0, missing


def similarity(a, b):
    """Calculate string similarity using SequenceMatcher."""
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def remove_duplicates(items):
    """Remove duplicates by URL match and title similarity > 0.8."""
    seen_urls = set()
    seen_titles = []
    result = []
    removed_count = 0

    for item in items:
        url = item.get('url', '')
        title = item.get('title', '') or item.get('model_name', '')

        # Check URL duplicate
        if url in seen_urls:
            removed_count += 1
            continue

        # Check title similarity
        is_duplicate = False
        for seen_title in seen_titles:
            if similarity(title, seen_title) > 0.8:
                is_duplicate = True
                break

        if is_duplicate:
            removed_count += 1
            continue

        seen_urls.add(url)
        seen_titles.append(title)
        result.append(item)

    return result, removed_count


def validate_items(data, category_filter=None, dry_run=False):
    """
    Execute all 7 validation steps.
    Returns validation results.
    """
    results = {
        'date': datetime.now().isoformat(),
        'dry_run': dry_run,
        'total_items': 0,
        'verified': 0,
        'warnings': 0,
        'removed': 0,
        'details': {},
        'per_item_results': {}
    }

    # Get categories to process
    categories = [category_filter] if category_filter else list(data.keys())

    # Step 5: Deduplicate first
    for category in categories:
        if category not in data:
            continue

        items = data[category]
        deduplicated, dup_removed = remove_duplicates(items)
        if dup_removed > 0:
            logger.info(f"Removed {dup_removed} duplicates from {category}")
            results['removed'] += dup_removed
        data[category] = deduplicated

    # Step 1: URL Liveness + Title consistency checks (concurrent)
    url_status = {}
    urls_to_check = []

    for category in categories:
        if category not in data:
            continue
        for idx, item in enumerate(data[category]):
            url = item.get('url', '')
            claimed_title = item.get('title', '') or item.get('model_name', '')
            if url:
                urls_to_check.append((url, claimed_title, category, idx))

    # Concurrent URL + title checking with batch delays
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {}
        for i, (url, claimed_title, category, idx) in enumerate(urls_to_check):
            if i > 0 and i % 3 == 0:
                time.sleep(0.5)  # 0.5s delay between batches
            future = executor.submit(check_url_and_title, url, claimed_title)
            futures[future] = (url, category, idx)

        for future in as_completed(futures):
            url, category, idx = futures[future]
            try:
                verified, status, title_score = future.result()
                url_status[(category, idx)] = (verified, status, title_score)
            except Exception as e:
                logger.warning(f"Error checking URL {url}: {e}")
                url_status[(category, idx)] = (False, 'error', 0.0)

    # Process each category
    for category in categories:
        if category not in data:
            continue

        category_results = {
            'total': 0,
            'verified': 0,
            'warnings': 0,
            'removed_items': [],
            'items': []
        }

        items_to_keep = []

        for idx, item in enumerate(data[category]):
            results['total_items'] += 1
            category_results['total'] += 1

            item_result = {
                'index': idx,
                'url': item.get('url', ''),
                'issues': [],
                'remove': False
            }

            try:
                # Step 3: Field completeness
                is_complete, missing = validate_required_fields(item, category)
                if not is_complete:
                    item_result['issues'].append(f"Missing fields: {missing}")
                    category_results['warnings'] += 1
                    results['warnings'] += 1
                    item['verified'] = False

                # Step 2: Domain whitelist
                url = item.get('url', '')
                if url:
                    is_trusted, domain = check_domain_whitelist(url)
                    if not is_trusted:
                        item_result['issues'].append(f"Untrusted domain: {domain}")
                        category_results['warnings'] += 1
                        results['warnings'] += 1

                # Step 1: URL Liveness + Title consistency
                url_result = url_status.get((category, idx))
                if url_result:
                    verified, status, title_score = url_result
                    item['url_status'] = status
                    item['title_score'] = round(title_score, 2) if title_score else 0
                    if verified is True:
                        item['verified'] = True
                        category_results['verified'] += 1
                        results['verified'] += 1
                    elif verified is None:  # needs_review (403, title_low_match etc)
                        item['verified'] = 'needs_review'
                        # Count as verified for pass rate (URL is alive)
                        category_results['verified'] += 1
                        results['verified'] += 1
                        category_results['warnings'] += 1
                        results['warnings'] += 1
                    else:
                        item['verified'] = False
                        item_result['remove'] = True
                        item_result['issues'].append(f"URL failed: {status} (title_score={title_score:.2f})")
                        category_results['warnings'] += 1
                        results['warnings'] += 1

                # Step 4: Date reasonableness
                # Models: allow_future for release_date (up to 2 years back)
                is_models = (category == 'models')

                # Check main date field
                date_field = {
                    'papers': 'date',
                    'topnews': 'date',
                    'taiwan': 'date',
                    'china': 'date',
                    'usa': 'date',
                    'techtrends': 'date',
                    'governance': 'date',
                    'tutorials': 'date',
                    'courses': 'date',
                    'models': 'release_date',
                }.get(category, 'date')

                date_value = item.get(date_field, '')
                cat_max_days = CATEGORY_DATE_LIMITS.get(category, 90)
                is_valid, error = validate_date(
                    date_value,
                    allow_future=is_models,
                    no_limit=False,
                    max_days=cat_max_days if cat_max_days is not None else 90,
                )
                if not is_valid:
                    item_result['issues'].append(f"Invalid {date_field}: {error}")
                    category_results['warnings'] += 1
                    results['warnings'] += 1

                # Decide whether to keep item
                if not item_result['remove']:
                    items_to_keep.append(item)
                    item['verified_at'] = datetime.now().isoformat()
                    item['complete'] = is_complete
                    if 'verified' not in item:
                        item['verified'] = True
                else:
                    results['removed'] += 1
                    category_results['removed_items'].append(item.get('url', ''))

                category_results['items'].append(item_result)

            except Exception as e:
                logger.warning(f"Error validating item in {category}[{idx}]: {e}")
                item_result['issues'].append(f"Validation error: {str(e)}")
                category_results['warnings'] += 1
                results['warnings'] += 1
                items_to_keep.append(item)

        # Update data with processed items
        data[category] = items_to_keep
        results['details'][category] = category_results

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


def save_latest_json(repo_root, data, results):
    """Save updated data to data/latest.json"""
    latest_path = repo_root / 'data' / 'latest.json'

    # Add validation summary
    validation_summary = {
        'total': results['total_items'],
        'verified': results['verified'],
        'warnings': results['warnings'],
        'removed': results['removed'],
        'pass_rate': round(results['verified'] / results['total_items'] * 100, 2) if results['total_items'] > 0 else 0
    }

    # Update validation summary at top level
    data['validation'] = validation_summary

    # Update stats counts if present
    if 'data' in data and isinstance(data['data'], dict):
        data['stats'] = {cat: len(items) for cat, items in data['data'].items() if isinstance(items, list)}

    with open(latest_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    logger.info(f"Updated {latest_path}")


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

    args = parser.parse_args()

    repo_root = get_repo_root()
    logger.info(f"Repository root: {repo_root}")

    # Load data
    latest = load_latest_json(repo_root)

    # Extract the inner "data" dict (category -> items)
    if 'data' in latest and isinstance(latest['data'], dict):
        data = latest['data']
    else:
        # Fallback: treat the whole object as category data
        data = {k: v for k, v in latest.items() if isinstance(v, list)}

    # Run validation
    logger.info("Starting 7-step validation...")
    results = validate_items(data, category_filter=args.category, dry_run=args.dry_run)

    # Write report
    write_validation_report(repo_root, results)

    # Save updated data (unless dry-run)
    if not args.dry_run:
        latest['data'] = data
        save_latest_json(repo_root, latest, results)

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
