#!/usr/bin/env python3
"""
extract-json.py — 從 claude CLI 的多段文字回應中安全提取 JSON items 陣列。

claude 可能輸出：思考過程 + web search 結果 + 最終 JSON（常包在 markdown code-fence 內）。
處理順序：
  0. 先偵測基礎設施 sentinel（配額耗盡 / API 中斷）→ 印明確 stderr 診斷（非解析失敗，別誤判）。
  1. 剝除 markdown code-fence 後，用「字串感知」括號掃描找最後一個含 "items" 的物件。
  2~4. regex / 陣列 / 任意物件多層 fallback。
任何情況都不 crash，最壞回傳 []。json_repair 缺席時自動降級（不強制依賴）。
"""

import json
import re
import sys

# 基礎設施 / 配額 sentinel：出現代表 claude 根本沒產生 JSON（非解析問題）
INFRA_SENTINELS = [
    "session limit",
    "usage limit",
    "rate limit",
    "hit your limit",
    "reached your",
    "api error",
    "connection closed",
    "overloaded",
    "quota",
]


def detect_infra_error(raw: str) -> str:
    """若輸出像配額 / 連線錯誤而非資料，回傳首行摘要，否則回空字串。

    僅在「短輸出且不含大括號」時判定，避免誤傷含 sentinel 字樣的正常新聞資料
    （正常 JSON 一定含 '{'，且遠長於 400 字元）。
    """
    stripped = raw.strip()
    if len(stripped) > 400 or "{" in stripped:
        return ""
    low = stripped.lower()
    for s in INFRA_SENTINELS:
        if s in low:
            first = stripped.splitlines()[0] if stripped.splitlines() else stripped
            return first[:200]
    return ""


def strip_code_fences(raw: str) -> str:
    """移除 markdown code-fence 標記行（```json / ``` / ~~~），保留內容。"""
    return re.sub(r'(?m)^[ \t]*(?:```|~~~)[a-zA-Z0-9_-]*[ \t]*$', '', raw)


def iter_balanced_objects(s: str):
    """字串感知括號掃描：yield 所有頂層平衡的 {...} 子字串。

    追蹤字串狀態與跳脫字元，忽略字串值內的 { }（原版逐字掃描的主要弱點）。
    """
    depth = 0
    start = -1
    in_str = False
    escape = False
    for i, ch in enumerate(s):
        if in_str:
            if escape:
                escape = False
            elif ch == '\\':
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == '{':
            if depth == 0:
                start = i
            depth += 1
        elif ch == '}':
            if depth > 0:
                depth -= 1
                if depth == 0 and start >= 0:
                    yield s[start:i + 1]
                    start = -1


def _repair_load(candidate: str):
    """json_repair 降級解析；未安裝則丟出例外交由呼叫端略過。"""
    import json_repair
    return json.loads(json_repair.repair_json(candidate))


def _load_items(candidate: str):
    """解析單一 JSON 物件字串，回傳 items list；失敗回 None。"""
    for loader in (json.loads, _repair_load):
        try:
            data = loader(candidate)
        except Exception:
            continue
        if isinstance(data, dict):
            items = data.get("items")
            if isinstance(items, list):
                return items
    return None


def _load_array(text: str):
    """解析頂層 JSON 陣列，回傳非空 list；失敗回 None。"""
    for loader in (json.loads, _repair_load):
        try:
            data = loader(text)
        except Exception:
            continue
        if isinstance(data, list) and len(data) > 0:
            return data
    return None


def extract_json_items(raw: str) -> list:
    cleaned = strip_code_fences(raw)

    # 策略 1：字串感知掃描，取「最後一個」含 items 的平衡物件（最終答案通常在最後）
    candidates = [c for c in iter_balanced_objects(cleaned) if '"items"' in c]
    for candidate in reversed(candidates):
        items = _load_items(candidate)
        if items is not None:
            return items

    # 策略 2：regex 找含 items 的物件
    pattern = re.compile(r'\{[\s\S]*?"items"\s*:\s*\[[\s\S]*?\]\s*\}')
    for m in reversed(list(pattern.finditer(cleaned))):
        items = _load_items(m.group())
        if items is not None:
            return items

    # 策略 3：找任何頂層 JSON 陣列（模型可能直接輸出 items 陣列）
    array_match = re.search(r'\[[\s\S]*\]', cleaned)
    if array_match:
        arr = _load_array(array_match.group())
        if arr is not None:
            return arr

    # 策略 4：任何平衡物件（不限 items），最後嘗試
    for candidate in reversed(list(iter_balanced_objects(cleaned))):
        items = _load_items(candidate)
        if items is not None:
            return items

    return []


def main():
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            print("extract-json.py: 空輸入（Claude 無輸出）", file=sys.stderr)
            json.dump([], sys.stdout, ensure_ascii=False)
            return

        infra = detect_infra_error(raw)
        if infra:
            print(f"extract-json.py: 偵測到配額/連線錯誤，非解析問題 → {infra}",
                  file=sys.stderr)
            json.dump([], sys.stdout, ensure_ascii=False)
            return

        items = extract_json_items(raw)
        if not items:
            print("extract-json.py: 找不到可解析的 items（格式異常或空結果）",
                  file=sys.stderr)
        json.dump(items, sys.stdout, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"extract-json.py error: {e}", file=sys.stderr)
        json.dump([], sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
