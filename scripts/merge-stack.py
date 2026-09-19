#!/usr/bin/env python3
"""Merge cumulative categories without mutating latest.json.

The daily merger remains the sole writer of latest.json. This helper only rewrites the
selected category files, which keeps retries and candidate validation transactional.
"""

import argparse
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from contracts.data_v2 import canonical_url

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
NOW = datetime.now(timezone(timedelta(hours=8)))
NOW_ISO = NOW.isoformat()

CATEGORY_POLICY = {
    "official_info": {"days": 30, "limit": 20, "date": "date", "key": ("company", "title")},
    "models": {"days": 90, "limit": 20, "date": "release_date", "key": ("institution", "model_name", "version")},
    "tutorials": {"days": 90, "limit": 20, "date": "date", "key": ("source", "title", "url")},
}


def load_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def items_from(value):
    if isinstance(value, list):
        return value
    if isinstance(value, dict) and isinstance(value.get("items"), list):
        return value["items"]
    return []


def item_key(item, fields):
    url = canonical_url(item.get("url") or item.get("source_url") or "")
    if url:
        return ("url", url)
    return tuple(str(item.get(field) or "").strip().lower() for field in fields)


def merge_category(category, current, history):
    policy = CATEGORY_POLICY[category]
    cutoff = (NOW - timedelta(days=policy["days"])).strftime("%Y-%m-%d")
    merged = []
    seen = set()
    valid_history = {}

    for original in history:
        if not isinstance(original, dict):
            continue
        key = item_key(original, policy["key"])
        date = original.get(policy["date"])
        if any(key) and isinstance(date, str) and cutoff <= date <= NOW.strftime("%Y-%m-%d"):
            valid_history.setdefault(key, original)

    for fetched, rows in ((True, current), (False, history)):
        for original in rows:
            if not isinstance(original, dict):
                continue
            item = dict(original)
            key = item_key(item, policy["key"])
            date = item.get(policy["date"])
            if not any(key) or not isinstance(date, str) or date < cutoff or date > NOW.strftime("%Y-%m-%d") or key in seen:
                continue
            seen.add(key)
            prior = valid_history.get(key) if fetched else None
            if prior:
                item = {**prior, **item}
            item["is_new"] = fetched and prior is None
            item["first_seen"] = (prior or {}).get("first_seen") or item.get("first_seen") or item.get("last_seen") or NOW_ISO
            if fetched:
                item["last_seen"] = NOW_ISO
            else:
                item["last_seen"] = item.get("last_seen") or NOW_ISO
            merged.append(item)

    merged.sort(key=lambda row: row.get(policy["date"], ""), reverse=True)
    return merged[:policy["limit"]]


def run(categories, dry_run=False):
    latest = load_json(DATA_DIR / "latest.json")
    history_data = latest.get("data", {}) if isinstance(latest, dict) else {}
    output = {}
    for category in categories:
        current = items_from(load_json(DATA_DIR / f"{category}.json"))
        history = history_data.get(category, []) if isinstance(history_data.get(category, []), list) else []
        merged = merge_category(category, current, history)
        output[category] = merged
        print(f"{category}: {len(current)} fetched + {len(history)} historical -> {len(merged)} retained")
        if not dry_run:
            temporary = DATA_DIR / f".{category}.json.tmp"
            temporary.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            os.replace(temporary, DATA_DIR / f"{category}.json")
    return output


def self_test():
    today = NOW.strftime("%Y-%m-%d")
    old = (NOW - timedelta(days=10)).strftime("%Y-%m-%d")
    future = (NOW + timedelta(days=1)).strftime("%Y-%m-%d")
    current = [
        {"title": "API update", "company": "OpenAI", "date": today, "url": "https://openai.com/a"},
        {"title": "New safety policy", "company": "OpenAI", "date": today, "url": "https://openai.com/safety?utm_source=test"},
        {"title": "Brand new", "company": "Cohere", "date": today, "url": "https://cohere.com/new"},
        {"title": "Future", "company": "OpenAI", "date": future, "url": "https://openai.com/future"},
    ]
    history = [
        {"title": "API update old copy", "company": "OpenAI", "date": old, "url": "https://openai.com/a", "first_seen": "2026-01-01T00:00:00+08:00"},
        {"title": "Safety old copy", "company": "OpenAI", "date": old, "url": "https://openai.com/safety"},
        {"title": "Platform", "company": "Anthropic", "date": old, "url": "https://anthropic.com/b"},
    ]
    result = merge_category("official_info", current, history)
    checks = {
        "dedupe prefers fetched item": len(result) == 4 and any(item["title"] == "API update" for item in result),
        "future item removed": all(item["title"] != "Future" for item in result),
        "new and historical flags": next(item for item in result if item["title"] == "API update")["is_new"] is False
        and next(item for item in result if item["title"] == "New safety policy")["is_new"] is False
        and next(item for item in result if item["title"] == "Brand new")["is_new"] is True
        and next(item for item in result if item["title"] == "Platform")["is_new"] is False,
    }
    for label, ok in checks.items():
        print(f"[{'PASS' if ok else 'FAIL'}] {label}")
    return 0 if all(checks.values()) else 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--categories", nargs="+", choices=sorted(CATEGORY_POLICY), default=sorted(CATEGORY_POLICY))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        raise SystemExit(self_test())
    run(args.categories, args.dry_run)


if __name__ == "__main__":
    main()
