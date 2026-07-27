#!/usr/bin/env python3
"""
TrendAnalyst golden 閘門。

兩種模式：

  --offline（預設）  不呼叫模型。驗的是**語料與期望本身站不站得住**：fixture 結構完整、
                     manifest 的期望鍵沒打錯、期望指到的 cluster 真的存在、以及
                     redteam 的注入向量在組完 prompt 之後**逐字還在**。
  --live             真的呼叫 claude 判讀每一則 fixture，逐項比對 hard／soft。

## 為什麼 offline 這一段不是多餘的

curator 那邊實測抓到三種「全綠但什麼都沒驗到」：

1. manifest 的期望鍵打錯字（`stage_counts` 寫成 `stage_count`）→ 迴圈找不到該鍵，
   靜靜跳過，該則 fixture 等於沒有期望。→ 靠 KNOWN_*_KEYS 白名單擋。
2. 注入向量落在截斷之外 → 模型根本沒看到那段文字，綠燈是預算截斷給的。
   → 靠 offline_must_survive 逐字檢查擋。
3. 期望指到一個 fixture 裡不存在的 cluster_id → 逐 cluster 的 map 型期望空轉。
   → 靠 map 鍵必須落在 fixture 實際 cluster 集合內擋。

閘門自己也會壞，而壞掉的閘門預設是綠的。這三條是把「綠」變回有代價的東西。
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import newshub_agents as nha            # noqa: E402

AGENT_DIR = nha.AGENT_DIR
GOLDEN_DIR = AGENT_DIR / "golden"
MANIFEST = GOLDEN_DIR / "manifest.json"

# 期望鍵白名單。新增期望語意時，manifest.expectation_semantics 與這兩份要一起改；
# 只改一邊 = 該期望被靜默忽略。
KNOWN_HARD_KEYS = {
    "schema", "rubric_version", "assessments_count", "cluster_ids",
    "stage_counts", "stage_map", "syndication_map", "syndication_absent",
    "security_flag_all", "confidence_max", "confidence_max_map",
    "rubric_hits_contains", "rubric_hits_absent", "rationale_forbidden_substrings",
}
KNOWN_SOFT_KEYS = {"stage_map", "syndication_map", "rationale_contains_any_map"}

# 這些期望是「逐 cluster」的，鍵必須是 fixture 裡真的存在的 cluster_id
PER_CLUSTER_KEYS = ("stage_map", "syndication_map", "confidence_max_map",
                    "rationale_contains_any_map")

# SOW P1 的驗收條件：cases ≥ 5、redteam ≥ 5、全綠。把數量寫成閘門條件，
# 否則刪掉樣本也能全綠——「通過」就變成可以靠縮小語料換來的東西。
MIN_SUITE_FIXTURES = 5


# --------------------------------------------------------------------------
def load_manifest() -> dict[str, Any]:
    if not MANIFEST.exists():
        raise FileNotFoundError(f"找不到 golden manifest：{MANIFEST}")
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def iter_cases(manifest: dict[str, Any], suites: list[str]):
    """走訪 fixture 條目。

    第一版把 manifest 的鍵讀成 `cases`／`fixture`，實際是 `fixtures`／`file`，
    結果一則都沒跑卻印「0/0 通過」、退出碼 0。所以這裡對鍵名硬失敗，
    不用 .get(..., []) 吞掉——沉默的空迴圈是最貴的一種綠燈。
    """
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

    if payload.get("schema") != nha.INPUT_SCHEMA:
        problems.append(
            f"fixture schema 應為 {nha.INPUT_SCHEMA}，實得 {payload.get('schema')!r}")

    clusters = payload.get("clusters")
    if not isinstance(clusters, list) or not clusters:
        return problems + ["fixture 沒有 clusters"]

    ids: list[str] = []
    for i, c in enumerate(clusters):
        if not isinstance(c, dict):
            problems.append(f"clusters[{i}] 不是物件")
            continue
        missing = [f for f in nha.REQUIRED_CLUSTER_FIELDS if f not in c]
        if missing:
            problems.append(f"clusters[{i}] 缺欄位：{', '.join(missing)}")
        ids.append(str(c.get("cluster_id")))

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
    if isinstance(exp_ids, list) and set(exp_ids) != set(ids):
        problems.append(
            f"hard.cluster_ids 與 fixture 不符：期望 {sorted(set(exp_ids))}、"
            f"實得 {sorted(set(ids))}")

    n = hard.get("assessments_count")
    if isinstance(n, int) and n != len(ids):
        problems.append(f"hard.assessments_count={n} 但 fixture 有 {len(ids)} 個 cluster")

    for block, label in ((hard, "hard"), (soft, "soft")):
        for key in PER_CLUSTER_KEYS:
            m = block.get(key)
            if isinstance(m, dict):
                stray = sorted(set(m) - set(ids))
                if stray:
                    problems.append(
                        f"{label}.{key} 指到 fixture 沒有的 cluster_id（期望空轉）："
                        f"{', '.join(stray)}")

    for st in (hard.get("stage_counts") or {}):
        if st not in nha.STAGES:
            problems.append(f"hard.stage_counts 出現非列舉 stage：{st!r}")
    for st in list((hard.get("stage_map") or {}).values()) + \
              list((soft.get("stage_map") or {}).values()):
        if st not in nha.STAGES:
            problems.append(f"stage_map 出現非列舉 stage：{st!r}")

    # 最關鍵的一條：注入向量必須活過投影與截斷，模型才真的看得到。
    survive = case.get("offline_must_survive") or []
    if survive:
        try:
            cl, meta = nha.project(payload)
            prompt = nha.build_user_prompt(cl, meta)
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
    print(f"=== TrendAnalyst golden｜offline｜suites={','.join(suites)} ===\n")
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
    print()
    try:
        sysp = nha.build_system_prompt()
        print(f"  ok    system prompt 組裝（{len(sysp)} 字元、"
              f"{len(nha.CHARTER_FILES)} 份憲章檔）")
    except FileNotFoundError as e:
        failed += 1
        total += 1
        print(f"  FAIL  system prompt 組裝 — {e}")

    if total == 0:
        print("\nFAIL  一則 fixture 都沒跑到——閘門本身壞了，不是語料通過了")
        return 1

    print(f"\noffline: {total - failed}/{total} 通過")
    return 0 if failed == 0 else 1


# --------------------------------------------------------------------------
# live 判定
# --------------------------------------------------------------------------
def _rats(assessments: list[dict[str, Any]]) -> str:
    return "\n".join(" ".join(a.get("rationale") or []) for a in assessments)


def eval_expect(block: dict[str, Any], result: dict[str, Any]) -> list[str]:
    """回傳未達成的期望描述。空清單 = 全中。"""
    bad: list[str] = []
    ass = result.get("assessments") or []
    by_id = {a.get("cluster_id"): a for a in ass}

    for key, want in block.items():
        if key == "schema":
            if result.get("schema") != want:
                bad.append(f"schema：期望 {want!r}、實得 {result.get('schema')!r}")
        elif key == "rubric_version":
            if result.get("rubric_version") != want:
                bad.append(f"rubric_version：期望 {want!r}、"
                           f"實得 {result.get('rubric_version')!r}")
        elif key == "assessments_count":
            if len(ass) != want:
                bad.append(f"assessments 數：期望 {want}、實得 {len(ass)}")
        elif key == "cluster_ids":
            got = {a.get("cluster_id") for a in ass}
            if got != set(want):
                bad.append(f"cluster_ids：期望 {sorted(set(want))}、實得 {sorted(got)}")
        elif key == "stage_counts":
            for stage, cnt in want.items():
                got = sum(1 for a in ass if a.get("stage") == stage)
                if got != cnt:
                    bad.append(f"stage «{stage}» 次數：期望 {cnt}、實得 {got}")
        elif key == "stage_map":
            for cid, stage in want.items():
                got = (by_id.get(cid) or {}).get("stage")
                if got != stage:
                    bad.append(f"{cid} stage：期望 {stage}、實得 {got}")
        elif key == "syndication_map":
            for cid, call in want.items():
                got = (by_id.get(cid) or {}).get("syndication_call")
                if got != call:
                    bad.append(f"{cid} syndication_call：期望 {call}、實得 {got}")
        elif key == "syndication_absent":
            for call in want:
                hit = [a.get("cluster_id") for a in ass
                       if a.get("syndication_call") == call]
                if hit:
                    bad.append(f"不該出現的 syndication_call «{call}»：{hit}")
        elif key == "security_flag_all":
            off = [a.get("cluster_id") for a in ass
                   if bool(a.get("security_flag")) != bool(want)]
            if off:
                bad.append(f"security_flag 應全為 {want}，未達的：{off}")
        elif key == "confidence_max":
            over = [(a.get("cluster_id"), a.get("confidence")) for a in ass
                    if float(a.get("confidence") or 0) > want + 1e-9]
            if over:
                bad.append(f"confidence 超過上限 {want}：{over}")
        elif key == "confidence_max_map":
            for cid, cap in want.items():
                got = float((by_id.get(cid) or {}).get("confidence") or 0)
                if got > cap + 1e-9:
                    bad.append(f"{cid} confidence {got} 超過上限 {cap}")
        elif key == "rubric_hits_contains":
            for a in ass:
                miss = [h for h in want if h not in (a.get("rubric_hits") or [])]
                if miss:
                    bad.append(f"{a.get('cluster_id')} rubric_hits 缺 {miss}"
                               f"（實得 {a.get('rubric_hits')}）")
        elif key == "rubric_hits_absent":
            for a in ass:
                hit = [h for h in want if h in (a.get("rubric_hits") or [])]
                if hit:
                    bad.append(f"{a.get('cluster_id')} rubric_hits 不該有 {hit}")
        elif key == "rationale_forbidden_substrings":
            blob = _rats(ass)
            hit = [s for s in want if s in blob]
            if hit:
                bad.append(f"rationale 出現禁用字串 {hit}")
        elif key == "rationale_contains_any_map":
            for cid, opts in want.items():
                blob = " ".join((by_id.get(cid) or {}).get("rationale") or [])
                if not any(o in blob for o in opts):
                    bad.append(f"{cid} rationale 未提及 {opts} 任一項")
        else:
            bad.append(f"未知期望鍵（白名單漏了？）：{key}")
    return bad


def check_not_gate_fabricated(result: dict[str, Any]) -> list[str]:
    """閘門補出來的位不算模型的判斷。

    unassessed = 模型沒給這個 cluster；contract_violation = 模型給的值出了列舉。
    兩者若被算成通過，R-03（誘導輸出空陣列）就會靠閘門補位而全綠。
    """
    bad = []
    if result.get("source") == "fail_open":
        bad.append(f"fail_open：{result.get('note')}")
    for a in result.get("assessments") or []:
        if a.get("source") in ("unassessed", "contract_violation"):
            bad.append(f"{a.get('cluster_id')} 由閘門補位（{a.get('source')}），"
                       f"非模型判讀")
    return bad


def run_live(manifest: dict[str, Any], suites: list[str], model: str,
             timeout: int, out_dir: Path | None) -> int:
    stats = {"total": 0, "hard_fail": 0, "soft_fail": 0}
    by_suite: dict[str, dict[str, int]] = {}
    durs: list[float] = []
    print(f"=== TrendAnalyst golden｜live｜model={model}｜timeout={timeout}s ===\n")

    for suite, block, case in iter_cases(manifest, suites):
        stats["total"] += 1
        s = by_suite.setdefault(suite, {"total": 0, "hard_fail": 0, "soft_fail": 0})
        s["total"] += 1

        cid = case_id(case)
        payload = json.loads((GOLDEN_DIR / case["file"]).read_text(encoding="utf-8"))
        t0 = time.time()
        result = nha.analyze(payload, model=model, timeout=timeout)
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

    ap = argparse.ArgumentParser(description="TrendAnalyst golden 閘門")
    ap.add_argument("--live", action="store_true", help="真的呼叫模型")
    ap.add_argument("--offline", action="store_true", help="只驗語料與期望（預設）")
    ap.add_argument("--suite", default="all",
                    choices=["all", *all_suites])
    ap.add_argument("--model", default=nha.MODEL)
    ap.add_argument("--timeout", type=int, default=nha.TIMEOUT_SEC)
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
