#!/usr/bin/env python3
"""
extract-json.py — 從 claude CLI 的多段文字回應中安全提取 JSON items 陣列。

claude 可能輸出：思考過程 + web search 結果 + 最終 JSON
本腳本找到最後一個包含 "items" 的 JSON 物件，提取 items 陣列。
"""

import json
import re
import sys


def extract_json_items(raw: str) -> list:
    """從原始文字中提取 JSON items 陣列。"""

    # 策略 1：找最後一個包含 "items" 的 JSON 物件
    # 使用貪婪匹配來找到完整的 JSON 物件
    matches = []
    depth = 0
    start = -1

    for i, ch in enumerate(raw):
        if ch == '{':
            if depth == 0:
                start = i
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0 and start >= 0:
                candidate = raw[start:i + 1]
                if '"items"' in candidate:
                    matches.append(candidate)
                start = -1

    # 從最後一個匹配開始嘗試解析（先標準解析，失敗再用 json-repair）
    for candidate in reversed(matches):
        try:
            data = json.loads(candidate)
            items = data.get("items", [])
            if isinstance(items, list):
                return items
        except json.JSONDecodeError:
            pass
        # json.loads 失敗（如標題內含未跳脫的 ASCII 雙引號），嘗試 json-repair
        try:
            import json_repair
            data = json.loads(json_repair.repair_json(candidate))
            items = data.get("items", [])
            if isinstance(items, list) and len(items) > 0:
                return items
        except Exception:
            continue

    # 策略 2：用 regex 找包含 items 的 JSON
    pattern = re.compile(r'\{[\s\S]*?"items"\s*:\s*\[[\s\S]*?\]\s*\}')
    regex_matches = list(pattern.finditer(raw))
    for m in reversed(regex_matches):
        try:
            data = json.loads(m.group())
            items = data.get("items", [])
            if isinstance(items, list):
                return items
        except json.JSONDecodeError:
            continue

    # 策略 3：找任何 JSON 陣列（可能直接輸出 items）
    array_pattern = re.compile(r'\[[\s\S]*\]')
    array_match = array_pattern.search(raw)
    if array_match:
        try:
            data = json.loads(array_match.group())
            if isinstance(data, list) and len(data) > 0:
                return data
        except json.JSONDecodeError:
            pass

    # 策略 4：找任何 JSON 物件
    for i in range(len(raw) - 1, -1, -1):
        if raw[i] == '}':
            for j in range(i, -1, -1):
                if raw[j] == '{':
                    try:
                        data = json.loads(raw[j:i + 1])
                        if isinstance(data, dict):
                            items = data.get("items", [])
                            if isinstance(items, list):
                                return items
                    except json.JSONDecodeError:
                        continue
            break

    # 完全找不到 → 輸出空陣列（不 crash）
    return []


def main():
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            json.dump([], sys.stdout, ensure_ascii=False)
            return

        items = extract_json_items(raw)
        json.dump(items, sys.stdout, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"extract-json.py error: {e}", file=sys.stderr)
        json.dump([], sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
