#!/usr/bin/env python3
"""Offline structural validation for official AI ecosystem research packets."""

from __future__ import annotations

import json
import re
import sys
from datetime import date, datetime
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]
SOURCES_PATH = ROOT / "references" / "official-sources.json"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TRACKING_KEYS = {"fbclid", "gclid", "ref", "source"}
OFFICIAL_TYPES = {
    "product", "api", "pricing", "partnership", "availability",
    "safety", "policy", "company", "platform",
}
MODEL_STATUSES = {
    "preview", "beta", "ga", "open_weight", "research", "updated", "deprecated",
}


def fail(errors: list[str], path: str, message: str) -> None:
    errors.append(f"{path}: {message}")


def canonical_url(value: str) -> str:
    parts = urlsplit(value)
    query = [
        (key, val) for key, val in parse_qsl(parts.query, keep_blank_values=True)
        if not key.lower().startswith("utm_") and key.lower() not in TRACKING_KEYS
    ]
    path = parts.path.rstrip("/") or "/"
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, urlencode(query), ""))


def valid_https_url(value: object) -> bool:
    if not isinstance(value, str):
        return False
    parts = urlsplit(value)
    return parts.scheme == "https" and bool(parts.hostname) and not parts.username and not parts.password


def allowed_host(host: str, allowed: set[str]) -> bool:
    host = host.lower().rstrip(".")
    return any(host == domain or host.endswith("." + domain) for domain in allowed)


def require_fields(errors: list[str], item: dict, fields: list[str], path: str) -> None:
    for field in fields:
        if field not in item:
            fail(errors, f"{path}.{field}", "missing required field")


def check_date(errors: list[str], value: object, path: str) -> date | None:
    if not isinstance(value, str) or not DATE_RE.fullmatch(value):
        fail(errors, path, "must use YYYY-MM-DD")
        return None
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        fail(errors, path, "invalid calendar date")
        return None
    if parsed > date.today():
        fail(errors, path, "future dates are not allowed")
    return parsed


def check_text(errors: list[str], value: object, path: str) -> None:
    if not isinstance(value, str) or not value.strip():
        fail(errors, path, "must be a non-empty string")


def check_string_list(errors: list[str], value: object, path: str) -> None:
    if not isinstance(value, list) or any(not isinstance(entry, str) or not entry.strip() for entry in value):
        fail(errors, path, "must be an array of non-empty strings")


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate_items.py RESEARCH_JSON", file=sys.stderr)
        return 2

    target = Path(sys.argv[1])
    try:
        packet = json.loads(target.read_text(encoding="utf-8"))
        registry = json.loads(SOURCES_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    errors: list[str] = []
    if not isinstance(packet, dict):
        print("ERROR: root must be an object", file=sys.stderr)
        return 1
    if packet.get("schema_version") != "ecosystem-research-v1":
        fail(errors, "schema_version", "must equal ecosystem-research-v1")
    try:
        datetime.fromisoformat(str(packet.get("generated_at", "")).replace("Z", "+00:00"))
    except ValueError:
        fail(errors, "generated_at", "must be an ISO 8601 timestamp")
    window = packet.get("window")
    if not isinstance(window, dict) or any(
        not isinstance(window.get(key), int) or window[key] <= 0
        for key in ("official_info_days", "model_news_days")
    ):
        fail(errors, "window", "must contain positive integer official_info_days and model_news_days")

    registry_by_company = {
        source.get("company"): source
        for source in registry.get("sources", [])
        if isinstance(source, dict) and isinstance(source.get("company"), str)
    }
    seen_urls: dict[str, str] = {}
    specs = {
        "official_info": {
            "date": "date",
            "fields": ["title", "company", "date", "event_type", "summary", "highlights", "analysis", "source_url", "evidence_urls"],
        },
        "model_news": {
            "date": "release_date",
            "fields": ["model_name", "version", "company", "release_date", "release_status", "modalities", "domain", "summary", "capabilities", "access_channels", "context_window", "pricing", "license", "benchmarks", "limitations", "analysis", "source_url", "evidence_urls"],
        },
    }

    for category, spec in specs.items():
        items = packet.get(category)
        if not isinstance(items, list):
            fail(errors, category, "must be an array")
            continue
        previous: date | None = None
        for index, item in enumerate(items):
            path = f"{category}[{index}]"
            if not isinstance(item, dict):
                fail(errors, path, "must be an object")
                continue
            require_fields(errors, item, spec["fields"], path)
            date_field = spec["date"]
            parsed_date = check_date(errors, item.get(date_field), f"{path}.{date_field}")
            if parsed_date and previous and parsed_date > previous:
                fail(errors, path, "items must be sorted newest first")
            if parsed_date:
                previous = parsed_date

            text_fields = ["company", "summary", "analysis"]
            text_fields.append("title" if category == "official_info" else "model_name")
            for field in text_fields:
                check_text(errors, item.get(field), f"{path}.{field}")

            company = item.get("company")
            source_config = registry_by_company.get(company)
            if source_config is None:
                fail(errors, f"{path}.company", "company is not in official-sources.json")
            elif category not in source_config.get("coverage", []):
                fail(errors, f"{path}.company", f"company is not approved for {category}")

            list_fields = (
                ["highlights", "evidence_urls"]
                if category == "official_info"
                else ["modalities", "capabilities", "access_channels", "limitations", "evidence_urls"]
            )
            for field in list_fields:
                check_string_list(errors, item.get(field), f"{path}.{field}")

            source_url = item.get("source_url")
            if not valid_https_url(source_url):
                fail(errors, f"{path}.source_url", "must be an HTTPS URL without credentials")
            else:
                host = urlsplit(source_url).hostname or ""
                company_domains = set(source_config.get("domains", [])) if source_config else set()
                if not allowed_host(host, company_domains):
                    fail(errors, f"{path}.source_url", f"host is not registered for {company}: {host}")
                canonical = canonical_url(source_url)
                if canonical in seen_urls:
                    fail(errors, f"{path}.source_url", f"duplicates {seen_urls[canonical]}")
                else:
                    seen_urls[canonical] = path

            for evidence_index, evidence_url in enumerate(item.get("evidence_urls", [])):
                if not valid_https_url(evidence_url):
                    fail(errors, f"{path}.evidence_urls[{evidence_index}]", "must be an HTTPS URL without credentials")

            if category == "official_info":
                if item.get("event_type") not in OFFICIAL_TYPES:
                    fail(errors, f"{path}.event_type", "unsupported event type")
            else:
                if item.get("release_status") not in MODEL_STATUSES:
                    fail(errors, f"{path}.release_status", "unsupported release status")
                benchmarks = item.get("benchmarks")
                if not isinstance(benchmarks, list):
                    fail(errors, f"{path}.benchmarks", "must be an array")
                else:
                    for benchmark_index, benchmark in enumerate(benchmarks):
                        benchmark_path = f"{path}.benchmarks[{benchmark_index}]"
                        if not isinstance(benchmark, dict):
                            fail(errors, benchmark_path, "must be an object")
                            continue
                        require_fields(
                            errors,
                            benchmark,
                            ["name", "result", "scope", "attribution", "source_url"],
                            benchmark_path,
                        )
                        if benchmark.get("attribution") != "official_self_reported":
                            fail(errors, f"{benchmark_path}.attribution", "must equal official_self_reported")
                        if not valid_https_url(benchmark.get("source_url")):
                            fail(errors, f"{benchmark_path}.source_url", "must be an HTTPS URL without credentials")

    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(f"OK: {len(packet['official_info'])} official_info, {len(packet['model_news'])} model_news")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
