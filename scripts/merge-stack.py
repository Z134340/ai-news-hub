#!/usr/bin/env python3
"""
merge-stack.py — 模型快訊 / AI 工具教學 累積合併腳本

功能：
  1. 讀取今日擷取的 data/models.json, data/tutorials.json
  2. 從 data/latest.json 或歸檔載入歷史資料
  3. 新資料標記 is_new: true，舊資料標記 is_new: false
  4. 去重合併（新的在前，舊的在後）
  5. 每筆記錄 first_seen / last_seen 時間戳
  6. 教學按 date 最新排序，僅保留近 3 個月

去重鍵：
  - models:    (model_name, version, institution)
  - tutorials: (title, source, url)

用法：
  python3 scripts/merge-stack.py
  python3 scripts/merge-stack.py --dry-run   # 只顯示不寫入
"""

import json
import os
import sys
from datetime import datetime, timezone, timedelta

# ── 設定 ──
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(REPO_DIR, "data")
TZ = timezone(timedelta(hours=8))
NOW = datetime.now(TZ)
TODAY = NOW.strftime("%Y-%m-%d")
NOW_ISO = NOW.isoformat()

DRY_RUN = "--dry-run" in sys.argv


def load_json(path):
    """載入 JSON 檔案，不存在或格式錯誤回傳空 list/dict"""
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return []


def save_json(path, data):
    """寫入 JSON 檔案"""
    if DRY_RUN:
        print(f"  [dry-run] 跳過寫入 {os.path.basename(path)}")
        return
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def find_previous_archive():
    """從 index.json 找到上一期歸檔（非今日的最新一期）"""
    index = load_json(os.path.join(DATA_DIR, "index.json"))
    if not isinstance(index, list):
        return None
    # 按日期降序，找第一個不是今日的
    for entry in sorted(index, key=lambda x: x.get("date", ""), reverse=True):
        if entry.get("date") != TODAY:
            archive_path = os.path.join(DATA_DIR, f"{entry['date']}.json")
            if os.path.exists(archive_path):
                return archive_path
    return None


def dedup_key_models(item):
    """模型去重鍵：(model_name, version, institution)"""
    return (
        (item.get("model_name") or "").strip().lower(),
        (item.get("version") or "").strip().lower(),
        (item.get("institution") or "").strip().lower(),
    )


def dedup_key_tutorials(item):
    """教學去重鍵：(title, source, url)"""
    return (
        (item.get("title") or "").strip().lower(),
        (item.get("source") or "").strip().lower(),
        (item.get("url") or "").strip().lower(),
    )


def merge_category(category, today_items, history_items, dedup_fn):
    """
    合併今日資料與歷史資料

    Args:
        category: 類別名稱 (models / tutorials)
        today_items: 今日擷取的項目 list
        history_items: 歷史歸檔中的項目 list
        dedup_fn: 去重鍵函數

    Returns:
        合併後的 list
    """
    seen = {}  # dedup_key -> merged item
    merged = []

    # ── 處理今日新資料（優先） ──
    for item in today_items:
        key = dedup_fn(item)
        item["is_new"] = True
        item["first_seen"] = item.get("first_seen") or NOW_ISO
        item["last_seen"] = NOW_ISO
        seen[key] = item
        merged.append(item)

    # ── 處理歷史資料 ──
    new_count = len(merged)
    for item in history_items:
        key = dedup_fn(item)
        if key in seen:
            # 已存在：保留舊的 first_seen，更新 last_seen
            existing = seen[key]
            existing["first_seen"] = item.get("first_seen") or item.get("last_seen") or existing["first_seen"]
            # 合併歷史中有但今日沒有的欄位
            for k, v in item.items():
                if k not in existing or existing[k] is None:
                    existing[k] = v
        else:
            # 舊資料：標記為非新
            item["is_new"] = False
            item["first_seen"] = item.get("first_seen") or item.get("last_seen") or NOW_ISO
            item["last_seen"] = item.get("last_seen") or NOW_ISO
            seen[key] = item
            merged.append(item)

    old_count = len(merged) - new_count
    print(f"  {category}: {new_count} 新 + {old_count} 舊 = {len(merged)} 筆")

    return merged


def main():
    print(f"{'[DRY RUN] ' if DRY_RUN else ''}merge-stack.py — {TODAY}")
    print(f"資料目錄: {DATA_DIR}")
    print()

    # ── 載入今日擷取資料 ──
    today_models_raw = load_json(os.path.join(DATA_DIR, "models.json"))
    today_tutorials_raw = load_json(os.path.join(DATA_DIR, "tutorials.json"))

    # 處理 {items: [...]} 和 [...] 兩種格式
    def extract_items(raw):
        if isinstance(raw, dict):
            return raw.get("items", [])
        return raw if isinstance(raw, list) else []

    today_models = extract_items(today_models_raw)
    today_tutorials = extract_items(today_tutorials_raw)

    if not isinstance(today_models, list):
        today_models = []
    if not isinstance(today_tutorials, list):
        today_tutorials = []

    print(f"今日擷取: models={len(today_models)}, tutorials={len(today_tutorials)}")

    # ── 載入歷史資料 ──
    history_models = []
    history_tutorials = []

    # 優先從 latest.json 讀取（最完整的累積資料）
    latest = load_json(os.path.join(DATA_DIR, "latest.json"))
    if isinstance(latest, dict) and "data" in latest:
        history_models = latest["data"].get("models", [])
        history_tutorials = latest["data"].get("tutorials", [])
        print(f"歷史來源: latest.json (models={len(history_models)}, tutorials={len(history_tutorials)})")
    else:
        # fallback: 從上一期歸檔讀取
        prev_path = find_previous_archive()
        if prev_path:
            prev = load_json(prev_path)
            if isinstance(prev, dict) and "data" in prev:
                history_models = prev["data"].get("models", [])
                history_tutorials = prev["data"].get("tutorials", [])
            print(f"歷史來源: {os.path.basename(prev_path)} (models={len(history_models)}, tutorials={len(history_tutorials)})")
        else:
            print("歷史來源: 無（首次執行）")

    print()

    # ── 合併 ──
    print("合併結果:")
    merged_models = merge_category("models", today_models, history_models, dedup_key_models)
    merged_tutorials = merge_category("tutorials", today_tutorials, history_tutorials, dedup_key_tutorials)

    # ── 模型按 release_date 排序（新的在前），僅保留近 3 個月 ──
    cutoff_3m = (NOW - timedelta(days=90)).strftime("%Y-%m-%d")
    merged_models = [m for m in merged_models if (m.get("release_date") or "9999") >= cutoff_3m]
    merged_models.sort(key=lambda x: x.get("release_date") or "", reverse=True)
    print(f"  models: 保留近 3 個月 {len(merged_models)} 筆")

    # ── 教學按 date 排序（新的在前），僅保留近 3 個月 ──
    merged_tutorials = [t for t in merged_tutorials if (t.get("date") or "9999") >= cutoff_3m]
    merged_tutorials.sort(key=lambda x: x.get("date") or "", reverse=True)
    print(f"  tutorials: 保留近 3 個月 {len(merged_tutorials)} 筆")

    print()

    # ── 寫回 ──
    # 寫入獨立檔案（供下次合併使用）
    save_json(os.path.join(DATA_DIR, "models.json"), merged_models)
    save_json(os.path.join(DATA_DIR, "tutorials.json"), merged_tutorials)

    # 更新 latest.json 中的對應區塊
    latest_path = os.path.join(DATA_DIR, "latest.json")
    latest_data = load_json(latest_path)
    if isinstance(latest_data, dict) and "data" in latest_data:
        latest_data["data"]["models"] = merged_models
        latest_data["data"]["tutorials"] = merged_tutorials
        if "stats" not in latest_data or not isinstance(latest_data["stats"], dict):
            latest_data["stats"] = {}
        latest_data["stats"]["models"] = len(merged_models)
        latest_data["stats"]["tutorials"] = len(merged_tutorials)
        if "validation" in latest_data and isinstance(latest_data["validation"], dict):
            latest_data["validation"]["total_items"] = sum(latest_data["stats"].values())
        save_json(latest_path, latest_data)
        if not DRY_RUN:
            print(f"✅ latest.json 已更新 (models={len(merged_models)}, tutorials={len(merged_tutorials)})")
    else:
        print("⚠️ latest.json 格式異常，僅更新獨立檔案")

    # ── 摘要 ──
    print()
    print("─" * 40)
    print(f"模型快訊: {len(merged_models)} 筆")
    for m in merged_models[:5]:
        flag = "🆕" if m.get("is_new") else "  "
        print(f"  {flag} {m.get('release_date','')} {m.get('model_name','?')} ({m.get('institution','')})")
    if len(merged_models) > 5:
        print(f"  ... 還有 {len(merged_models)-5} 筆")

    print()
    print(f"AI 工具教學: {len(merged_tutorials)} 筆 (近 3 個月)")
    for t in merged_tutorials[:5]:
        flag = "🆕" if t.get("is_new") else "  "
        print(f"  {flag} {t.get('date','')} {t.get('title','?')[:40]} ({t.get('source','')})")
    if len(merged_tutorials) > 5:
        print(f"  ... 還有 {len(merged_tutorials)-5} 筆")


if __name__ == "__main__":
    main()
