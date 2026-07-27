#!/usr/bin/env python3
"""
TechRoadmap golden 閘門。

兩種模式：

  --offline（預設）  不呼叫模型。驗的是**語料與期望本身站不站得住**：fixture 結構完整、
                     manifest 的期望鍵沒打錯、期望指到的 cluster 真的存在、期望裡的
                     trajectory／horizon／blocker 值在列舉內、blockers_subset_map 的
                     候選清單與 fixture 一致，以及 redteam 的注入向量在組完 prompt
                     之後**逐字還在**。
  --live             真的呼叫 claude 判讀每一則 fixture，逐項比對 hard／soft。

## 為什麼 offline 這一段不是多餘的

curator 與 trend-analyst 兩邊實測共抓到五種「全綠但什麼都沒驗到」：

1. manifest 的期望鍵打錯字 → 迴圈找不到該鍵，靜靜跳過，該則等於沒有期望。
   → 靠 KNOWN_*_KEYS 白名單擋。
2. 注入向量落在截斷之外 → 模型根本沒看到那段文字，綠燈是預算截斷給的。
   → 靠 offline_must_survive 逐字檢查擋。
3. 逐 cluster 的 map 型期望掛在 fixture 裡不存在的 cluster_id → 期望空轉。
   → 靠 map 鍵必須落在 fixture 實際 cluster 集合內擋。
4. 裸字串被當成清單逐字元迭代 → 期望變成一堆單字比對，永遠成立。
   → 靠清單型期望的型別檢查擋。
5. manifest 結構鍵名寫錯 → 沉默的空迴圈印「0/0 通過」、退出碼 0。
   → 靠 iter_cases() 硬失敗擋。

本支多一條 trend 側沒有的：blockers_subset_map 的候選清單如果與 fixture 裡
`tech_assessment.blocker_candidates` 不一致，那條期望測的就不是 RM-6（只能挑不能新增），
而是我當初抄期望時抄了什麼。→ 靠候選集合相等檢查擋。

閘門自己也會壞，而壞掉的閘門預設是綠的。這些是把「綠」變回有代價的東西。
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import newshub_roadmap as nhr            # noqa: E402

AGENT_DIR = nhr.AGENT_DIR
GOLDEN_DIR = AGENT_DIR / "golden"
MANIFEST = GOLDEN_DIR / "manifest.json"

# 期望鍵白名單。新增期望語意時，manifest.expectation_semantics 與這兩份要一起改；
# 只改一邊 = 該期望被靜默忽略。
KNOWN_HARD_KEYS = {
    "schema", "rubric_version", "roadmaps_count", "cluster_ids",
    "trajectory_counts", "trajectory_map", "trajectory_absent",
    "trajectory_forbidden_map",
    "horizon_map", "horizon_absent", "horizon_forbidden_map",
    "security_flag_all", "security_flag_map",
    "confidence_max", "confidence_max_map",
    "rubric_hits_contains", "rubric_hits_absent", "rubric_hits_contains_map",
    "milestone_empty_ids", "milestone_nonempty_ids",
    "blockers_subset_map", "blockers_empty_ids",
    "watch_signals_min", "text_forbidden_substrings",
}
KNOWN_SOFT_KEYS = {
    "trajectory_map", "horizon_map", "blockers_subset_map",
    "milestone_contains_any_map", "confidence_max_map", "rubric_hits_contains",
}

# 這些期望是「逐 cluster」的，鍵必須是 fixture 裡真的存在的 cluster_id
PER_CLUSTER_KEYS = ("trajectory_map", "trajectory_forbidden_map", "horizon_map",
                    "horizon_forbidden_map", "confidence_max_map",
                    "rubric_hits_contains_map", "blockers_subset_map",
                    "security_flag_map", "milestone_contains_any_map")

# 這些期望是 cluster_id 清單，成員同樣必須存在
PER_CLUSTER_ID_LIST_KEYS = ("milestone_empty_ids", "milestone_nonempty_ids",
                            "blockers_empty_ids")

# SOW P1 的驗收條件：cases ≥ 5、redteam ≥ 5、全綠。把數量寫成閘門條件，
# 否則刪掉樣本也能全綠——「通過」就變成可以靠縮小語料換來的東西。
MIN_SUITE_FIXTURES = 5


# --------------------------------------------------------------------------
def load_manifest() -> dict[str, Any]:
    if not MANIFEST.exists():
        raise FileNotFoundError(f"找不到 golden manifest：{MANIFEST}")
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def iter_cases(manifest: dict[str, Any], suites: list[str]):
    """走訪 fixture 條目。對鍵名硬失敗，不用 .get(..., []) 吞掉——
    沉默的空迴圈是最貴的一種綠燈。"""
    for suite in suites:
        block = manifest.get("suites", {}).get(suite)
        if not isinstance(block, dict):
            raise KeyError(f"manifest 沒有 suite「{suite}」")
        fixtures = block.get("fixtures")
        if not isinstance(fixtures, list) or not fixtures:
            raise KeyError(f"suite「{suite}」沒有 fixtures 陣列（manifest 結構變了？）")
        if len(fixtures) < MIN_SUITE_FIXTURES:
            raise KeyError(
                f"suite「{suite}」只有 {len(fixtures)} 則，"
                f"低於 SOW 驗收下限 {MIN_SUITE_FIXTURES}")
        for case in fixtures:
            if "file" not in case or "hard" not in case:
                raise KeyError(
                    f"suite「{suite}」有 fixture 條目缺 file 或 hard：{sorted(case)}")
            yield suite, block, case


def case_id(case: dict[str, Any]) -> str:
    return Path(case["file"]).stem


def _is_str_list(v: Any) -> bool:
    """裸字串會被 for 迴圈逐字元迭代，於是「清單型期望」變成一堆單字比對而恆真。"""
    return isinstance(v, list) and all(isinstance(x, str) for x in v)


# --------------------------------------------------------------------------
# offline
# --------------------------------------------------------------------------
def check_offline(case: dict[str, Any]) -> list[str]:
    """回傳問題清單。空清單 = 這則 fixture 的期望本身站得住。"""
    problems: list[str] = []
    fx = GOLDEN_DIR / case["file"]
    if not fx.exists():
        return [f"fixture 不存在：{fx}"]

    try:
        payload = json.loads(fx.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return [f"fixture 非合法 JSON：{e}"]

    if payload.get("schema") != nhr.INPUT_SCHEMA:
        problems.append(
            f"fixture schema 應為 {nhr.INPUT_SCHEMA}，實得 {payload.get('schema')!r}")

    clusters = payload.get("clusters")
    if not isinstance(clusters, list) or not clusters:
        return problems + ["fixture 沒有 clusters"]

    ids: list[str] = []
    candidates: dict[str, list[str]] = {}
    for i, c in enumerate(clusters):
        if not isinstance(c, dict):
            problems.append(f"clusters[{i}] 不是物件")
            continue
        missing = [f for f in nhr.REQUIRED_CLUSTER_FIELDS if f not in c]
        if missing:
            problems.append(f"clusters[{i}] 缺欄位：{', '.join(missing)}")
        cid = str(c.get("cluster_id"))
        ids.append(cid)
        ta = c.get("tech_assessment")
        candidates[cid] = list((ta or {}).get("blocker_candidates") or []) \
            if isinstance(ta, dict) else []

    if len(set(ids)) != len(ids):
        problems.append("fixture 內 cluster_id 重複")

    hard = case.get("hard") or {}
    soft = case.get("soft") or {}
    if not hard:
        problems.append("hard 期望為空——這則 fixture 不會擋住任何回歸")

    bad_hard = sorted(set(hard) - KNOWN_HARD_KEYS)
    if bad_hard:
        problems.append(f"hard 期望鍵不在白名單（會被靜默忽略）：{', '.join(bad_hard)}")
    bad_soft = sorted(set(soft) - KNOWN_SOFT_KEYS)
    if bad_soft:
        problems.append(f"soft 期望鍵不在白名單（會被靜默忽略）：{', '.join(bad_soft)}")

    exp_ids = hard.get("cluster_ids")
    if exp_ids is not None:
        if not _is_str_list(exp_ids):
            problems.append("hard.cluster_ids 必須是字串陣列")
        elif set(exp_ids) != set(ids):
            problems.append(
                f"hard.cluster_ids 與 fixture 不符：期望 {sorted(set(exp_ids))}、"
                f"實得 {sorted(set(ids))}")

    n = hard.get("roadmaps_count")
    if isinstance(n, int) and n != len(ids):
        problems.append(f"hard.roadmaps_count={n} 但 fixture 有 {len(ids)} 個 cluster")

    for block, label in ((hard, "hard"), (soft, "soft")):
        for key in PER_CLUSTER_KEYS:
            m = block.get(key)
            if m is None:
                continue
            if not isinstance(m, dict):
                problems.append(f"{label}.{key} 必須是物件（cluster_id → 期望值）")
                continue
            stray = sorted(set(m) - set(ids))
            if stray:
                problems.append(
                    f"{label}.{key} 指到 fixture 沒有的 cluster_id（期望空轉）："
                    f"{', '.join(stray)}")
        for key in PER_CLUSTER_ID_LIST_KEYS:
            lst = block.get(key)
            if lst is None:
                continue
            if not _is_str_list(lst):
                problems.append(f"{label}.{key} 必須是 cluster_id 字串陣列")
                continue
            stray = sorted(set(lst) - set(ids))
            if stray:
                problems.append(
                    f"{label}.{key} 指到 fixture 沒有的 cluster_id（期望空轉）："
                    f"{', '.join(stray)}")

    both = set(hard.get("milestone_empty_ids") or []) & \
        set(hard.get("milestone_nonempty_ids") or [])
    if both:
        problems.append(f"同一 cluster 同時要求 milestone 空與非空：{sorted(both)}")

    # 列舉值檢查：期望寫了列舉外的值，live 時只會永遠不中，看起來像模型判錯。
    for block, label in ((hard, "hard"), (soft, "soft")):
        for key in ("trajectory_map", "trajectory_forbidden_map",
                    "horizon_map", "horizon_forbidden_map"):
            m = block.get(key)
            if not isinstance(m, dict):
                continue
            enum = nhr.TRAJECTORIES if key.startswith("trajectory") else nhr.HORIZONS
            for cid, want in m.items():
                vals = want if key.endswith("forbidden_map") else [want]
                if key.endswith("forbidden_map") and not _is_str_list(want):
                    problems.append(f"{label}.{key}[{cid}] 必須是字串陣列")
                    continue
                for v in vals:
                    if v not in enum:
                        problems.append(f"{label}.{key}[{cid}] 出現非列舉值：{v!r}")
        for key in ("trajectory_absent", "horizon_absent"):
            lst = block.get(key)
            if lst is None:
                continue
            if not _is_str_list(lst):
                problems.append(f"{label}.{key} 必須是字串陣列")
                continue
            enum = nhr.TRAJECTORIES if key.startswith("trajectory") else nhr.HORIZONS
            for v in lst:
                if v not in enum:
                    problems.append(f"{label}.{key} 出現非列舉值：{v!r}")
        for st in (block.get("trajectory_counts") or {}):
            if st not in nhr.TRAJECTORIES:
                problems.append(f"{label}.trajectory_counts 出現非列舉值：{st!r}")

    # blockers_subset_map 的候選清單必須就是 fixture 裡那筆的 blocker_candidates，
    # 否則這條期望測的是我抄期望時抄了什麼，不是 RM-6。
    for block, label in ((hard, "hard"), (soft, "soft")):
        m = block.get("blockers_subset_map")
        if not isinstance(m, dict):
            continue
        for cid, want in m.items():
            if not _is_str_list(want):
                problems.append(f"{label}.blockers_subset_map[{cid}] 必須是字串陣列")
                continue
            bad = [b for b in want if b not in nhr.BLOCKERS]
            if bad:
                problems.append(
                    f"{label}.blockers_subset_map[{cid}] 出現非 B1–B6 的值：{bad}")
            if cid in candidates and set(want) != set(candidates[cid]):
                problems.append(
                    f"{label}.blockers_subset_map[{cid}] 的候選集合與 fixture 不符："
                    f"期望 {sorted(set(want))}、fixture {sorted(set(candidates[cid]))}")

    for cid in (hard.get("blockers_empty_ids") or []):
        if candidates.get(cid):
            problems.append(
                f"hard.blockers_empty_ids 含 {cid}，但該筆有候選 "
                f"{candidates[cid]}——這是在要求模型無視候選，不是 RM-6")

    # 最關鍵的一條：注入向量必須活過投影與截斷，模型才真的看得到。
    survive = case.get("offline_must_survive") or []
    if isinstance(survive, str):
        problems.append("offline_must_survive 是裸字串（會被逐字元迭代）")
        survive = []
    if survive:
        try:
            cl, meta = nhr.project(payload)
            prompt = nhr.build_user_prompt(cl, meta)
        except Exception as e:                      # noqa: BLE001
            problems.append(f"組 prompt 失敗：{e}")
            prompt = ""
        for s in survive:
            if s not in prompt:
                problems.append(
                    f"注入向量被截斷或改寫，模型看不到（假綠燈）：{s[:60]!r}")

    return problems


def run_offline(manifest: dict[str, Any], suites: list[str]) -> int:
    total = failed = 0
    print(f"=== TechRoadmap golden｜offline｜suites={','.join(suites)} ===\n")
    for suite, _block, case in iter_cases(manifest, suites):
        total += 1
        problems = check_offline(case)
        if problems:
            failed += 1
            print(f"  FAIL  [{suite}] {case_id(case)}")
            for p in problems:
                print(f"          - {p}")
        else:
            print(f"  ok    [{suite}] {case_id(case)}")

    # 憲章／判準／技能／記憶缺一，system prompt 就少一塊，模型是照殘缺規則判的。
    # T 軸判準在另一個 repo，路徑斷掉要在這裡就紅。
    print()
    total += 1
    try:
        sysp = nhr.build_system_prompt()
        _, tech_ver = nhr.read_tech_rubric()
        if tech_ver != nhr.TECH_RUBRIC_VERSION:
            failed += 1
            print(f"  FAIL  T 軸判準版本漂移：期望 {nhr.TECH_RUBRIC_VERSION}、"
                  f"實得 {tech_ver}")
        else:
            print(f"  ok    system prompt 組裝（{len(sysp)} 字元、"
                  f"{len(nhr.CHARTER_FILES)} 份憲章檔、"
                  f"T 軸判準 {tech_ver} 來自 {nhr.TECH_RUBRIC_PATH}）")
    except FileNotFoundError as e:
        failed += 1
        print(f"  FAIL  system prompt 組裝 — {e}")

    if total == 0:
        print("\nFAIL  一則 fixture 都沒跑到——閘門本身壞了，不是語料通過了")
        return 1

    print(f"\noffline: {total - failed}/{total} 通過")
    return 0 if failed == 0 else 1


# --------------------------------------------------------------------------
# live 判定
# --------------------------------------------------------------------------
def eval_expect(block: dict[str, Any], result: dict[str, Any]) -> list[str]:
    """回傳未達成的期望描述。空清單 = 全中。"""
    bad: list[str] = []
    rms = result.get("roadmaps") or []
    by_id = {r.get("cluster_id"): r for r in rms}

    for key, want in block.items():
        if key == "schema":
            if result.get("schema") != want:
                bad.append(f"schema：期望 {want!r}、實得 {result.get('schema')!r}")
        elif key == "rubric_version":
            if result.get("rubric_version") != want:
                bad.append(f"rubric_version：期望 {want!r}、"
                           f"實得 {result.get('rubric_version')!r}")
        elif key == "roadmaps_count":
            if len(rms) != want:
                bad.append(f"roadmaps 數：期望 {want}、實得 {len(rms)}")
        elif key == "cluster_ids":
            got = {r.get("cluster_id") for r in rms}
            if got != set(want):
                bad.append(f"cluster_ids：期望 {sorted(set(want))}、實得 {sorted(got)}")
        elif key == "trajectory_counts":
            for traj, cnt in want.items():
                got = sum(1 for r in rms if r.get("trajectory") == traj)
                if got != cnt:
                    bad.append(f"trajectory «{traj}» 次數：期望 {cnt}、實得 {got}")
        elif key == "trajectory_map":
            for cid, traj in want.items():
                got = (by_id.get(cid) or {}).get("trajectory")
                if got != traj:
                    bad.append(f"{cid} trajectory：期望 {traj}、實得 {got}")
        elif key == "trajectory_absent":
            for traj in want:
                hit = [r.get("cluster_id") for r in rms
                       if r.get("trajectory") == traj]
                if hit:
                    bad.append(f"不該出現的 trajectory «{traj}»：{hit}")
        elif key == "trajectory_forbidden_map":
            for cid, forbidden in want.items():
                got = (by_id.get(cid) or {}).get("trajectory")
                if got in forbidden:
                    bad.append(f"{cid} trajectory 不該是 {got}（禁用 {forbidden}）")
        elif key == "horizon_map":
            for cid, hz in want.items():
                got = (by_id.get(cid) or {}).get("horizon")
                if got != hz:
                    bad.append(f"{cid} horizon：期望 {hz}、實得 {got}")
        elif key == "horizon_absent":
            for hz in want:
                hit = [r.get("cluster_id") for r in rms if r.get("horizon") == hz]
                if hit:
                    bad.append(f"不該出現的 horizon «{hz}»：{hit}")
        elif key == "horizon_forbidden_map":
            for cid, forbidden in want.items():
                got = (by_id.get(cid) or {}).get("horizon")
                if got in forbidden:
                    bad.append(f"{cid} horizon 不該是 {got}（禁用 {forbidden}）")
        elif key == "security_flag_all":
            off = [r.get("cluster_id") for r in rms
                   if bool(r.get("security_flag")) != bool(want)]
            if off:
                bad.append(f"security_flag 應全為 {want}，未達的：{off}")
        elif key == "security_flag_map":
            for cid, flag in want.items():
                got = bool((by_id.get(cid) or {}).get("security_flag"))
                if got != bool(flag):
                    bad.append(f"{cid} security_flag：期望 {flag}、實得 {got}")
        elif key == "confidence_max":
            over = [(r.get("cluster_id"), r.get("confidence")) for r in rms
                    if float(r.get("confidence") or 0) > want + 1e-9]
            if over:
                bad.append(f"confidence 超過上限 {want}：{over}")
        elif key == "confidence_max_map":
            for cid, cap in want.items():
                got = float((by_id.get(cid) or {}).get("confidence") or 0)
                if got > cap + 1e-9:
                    bad.append(f"{cid} confidence {got} 超過上限 {cap}")
        elif key == "rubric_hits_contains":
            union: set[str] = set()
            for r in rms:
                union |= set(r.get("rubric_hits") or [])
            miss = [h for h in want if h not in union]
            if miss:
                bad.append(f"全體 rubric_hits 缺 {miss}（實得 {sorted(union)}）")
        elif key == "rubric_hits_absent":
            union = set()
            for r in rms:
                union |= set(r.get("rubric_hits") or [])
            hit = [h for h in want if h in union]
            if hit:
                bad.append(f"rubric_hits 不該有 {hit}")
        elif key == "rubric_hits_contains_map":
            for cid, hits in want.items():
                got = (by_id.get(cid) or {}).get("rubric_hits") or []
                miss = [h for h in hits if h not in got]
                if miss:
                    bad.append(f"{cid} rubric_hits 缺 {miss}（實得 {got}）")
        elif key == "milestone_empty_ids":
            for cid in want:
                got = (by_id.get(cid) or {}).get("next_milestone")
                if got:
                    bad.append(f"{cid} next_milestone 應為空、實得 {got!r}")
        elif key == "milestone_nonempty_ids":
            for cid in want:
                row = by_id.get(cid) or {}
                if not row.get("next_milestone"):
                    bad.append(f"{cid} next_milestone 不該是空的")
                elif not row.get("falsifier"):
                    # RM-2：里程碑與否證條件必須成對，缺 falsifier 那筆閘門會逼降，
                    # 到這裡還缺代表閘門也沒攔到。
                    bad.append(f"{cid} 有 next_milestone 卻沒有 falsifier（RM-2）")
        elif key == "milestone_contains_any_map":
            for cid, opts in want.items():
                blob = str((by_id.get(cid) or {}).get("next_milestone") or "")
                if not any(o in blob for o in opts):
                    bad.append(f"{cid} next_milestone 未提及 {opts} 任一項")
        elif key == "blockers_subset_map":
            for cid, cands in want.items():
                got = (by_id.get(cid) or {}).get("blockers_ranked") or []
                extra = [b for b in got if b not in cands]
                if extra:
                    bad.append(f"{cid} blockers_ranked 出現候選外的值 {extra}"
                               f"（候選 {cands}）")
                if len(got) > nhr.MAX_BLOCKERS:
                    bad.append(f"{cid} blockers_ranked 有 {len(got)} 個，"
                               f"超過 {nhr.MAX_BLOCKERS}")
        elif key == "blockers_empty_ids":
            for cid in want:
                got = (by_id.get(cid) or {}).get("blockers_ranked") or []
                if got:
                    bad.append(f"{cid} blockers_ranked 應為空、實得 {got}")
        elif key == "watch_signals_min":
            for r in rms:
                if r.get("trajectory") == nhr.NO_FORECAST:
                    continue
                got = len(r.get("watch_signals") or [])
                if got < want:
                    bad.append(f"{r.get('cluster_id')} watch_signals 只有 {got} 筆、"
                               f"低於 {want}")
        elif key == "text_forbidden_substrings":
            blob = json.dumps(result, ensure_ascii=False)
            hit = [s for s in want if s in blob]
            if hit:
                bad.append(f"輸出出現禁用字串 {hit}")
        else:
            bad.append(f"未知期望鍵（白名單漏了？）：{key}")
    return bad


def check_not_gate_fabricated(result: dict[str, Any]) -> list[str]:
    """閘門補出來的位不算模型的判斷。

    unassessed = 模型沒給這個 cluster；contract_violation = 模型給的值出了列舉。
    兩者若被算成通過，R-04（誘導輸出空 roadmaps 陣列）就會靠閘門補位而全綠。
    """
    bad = []
    if result.get("source") == "fail_open":
        bad.append(f"fail_open：{result.get('note')}")
    for r in result.get("roadmaps") or []:
        if r.get("source") in ("unassessed", "contract_violation"):
            bad.append(f"{r.get('cluster_id')} 由閘門補位（{r.get('source')}），"
                       f"非模型判讀")
    return bad


def run_live(manifest: dict[str, Any], suites: list[str], model: str,
             timeout: int, out_dir: Path | None) -> int:
    stats = {"total": 0, "hard_fail": 0, "soft_fail": 0}
    by_suite: dict[str, dict[str, int]] = {}
    durs: list[float] = []
    print(f"=== TechRoadmap golden｜live｜model={model}｜timeout={timeout}s ===\n")

    for suite, block, case in iter_cases(manifest, suites):
        stats["total"] += 1
        s = by_suite.setdefault(suite, {"total": 0, "hard_fail": 0, "soft_fail": 0})
        s["total"] += 1

        cid = case_id(case)
        payload = json.loads((GOLDEN_DIR / case["file"]).read_text(encoding="utf-8"))
        t0 = time.time()
        result = nhr.forecast(payload, model=model, timeout=timeout)
        dt = time.time() - t0
        durs.append(dt)

        if out_dir:
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / f"{cid}.json").write_text(
                json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8")

        hard_bad = check_not_gate_fabricated(result)
        hard_bad += eval_expect(case.get("hard") or {}, result)
        soft_bad = eval_expect(case.get("soft") or {}, result)

        if hard_bad:
            stats["hard_fail"] += 1
            s["hard_fail"] += 1
            mark = "FAIL"
        elif soft_bad:
            stats["soft_fail"] += 1
            s["soft_fail"] += 1
            mark = "soft"
        else:
            mark = "ok  "
        print(f"  {mark}  [{suite}] {cid}  ({dt:.1f}s)")
        for b in hard_bad:
            print(f"          HARD  {b}")
        for b in soft_bad:
            print(f"          soft  {b}")

    print()
    for suite, s in by_suite.items():
        print(f"  {suite}: {s['total'] - s['hard_fail']}/{s['total']} hard 通過、"
              f"{s['soft_fail']} 則 soft 未中")
    if durs:
        headroom = round((1 - max(durs) / timeout) * 100, 1)
        print(f"\n  duration_sec_max={max(durs):.1f}  "
              f"duration_sec_total={sum(durs):.1f}  "
              f"timeout_headroom_pct={headroom}")
    if stats["total"] == 0:
        print("\nFAIL  一則 fixture 都沒跑到——閘門本身壞了，不是語料通過了")
        return 1
    print(f"\nlive: {stats['total'] - stats['hard_fail']}/{stats['total']} hard 通過、"
          f"{stats['soft_fail']} 則 soft 未中")
    return 0 if stats["hard_fail"] == 0 else 1


# --------------------------------------------------------------------------
def main() -> int:
    manifest = load_manifest()
    all_suites = list(manifest.get("suites", {}).keys())
    # 硬寫 suite 清單會讓新增 suite 時被靜默漏跑，跟 rows[-0:] 是同一類沉默失效。

    ap = argparse.ArgumentParser(description="TechRoadmap golden 閘門")
    ap.add_argument("--live", action="store_true", help="真的呼叫模型")
    ap.add_argument("--offline", action="store_true", help="只驗語料與期望（預設）")
    ap.add_argument("--suite", default="all", choices=["all", *all_suites])
    ap.add_argument("--model", default=nhr.MODEL)
    ap.add_argument("--timeout", type=int, default=nhr.TIMEOUT_SEC)
    ap.add_argument("--out-dir", default="",
                    help="live 模式把每則判讀結果落檔的目錄")
    args = ap.parse_args()

    suites = all_suites if args.suite == "all" else [args.suite]
    if args.live:
        return run_live(manifest, suites, args.model, args.timeout,
                        Path(args.out_dir) if args.out_dir else None)
    return run_offline(manifest, suites)


if __name__ == "__main__":
    raise SystemExit(main())
