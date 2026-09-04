<!-- 自 CLAUDE.md 拆出（2026-09-04）。此檔是權威規範，CLAUDE.md 只留索引；改本檔不必同步回 CLAUDE.md。 -->

### B. 模型 runner：`scripts/newshub_agents.py`（743 行，可 import）

常數 `SCHEMA="agent-trend-v0.1"`、`MODEL="claude-opus-5"`、`TIMEOUT_SEC=900`。可重用函式：`fail_open(reason)`（回 `{"source":"fail_open",…}`）、`cap_text`、`_extract_json(text)`、`_cli_error_detail(stdout)`、`call_analyst(system_prompt, user_prompt, model, timeout, backoff)`。`call_analyst` 指令：`claude -p <user> --model M --output-format json --system-prompt <sys> --allowedTools "" --strict-mcp-config --permission-mode plan`，執行前 pop `ANTHROPIC_API_KEY`，只在 transient API status 重試。`main()` 旗標 `--selftest/--input/--out/--model/--timeout/--print-prompt`；輸入缺 → 2；`fail_open` → 1；`if __name__ == "__main__"` 保護，故新 runner 可直接 import。`newshub_roadmap.py`、`newshub_brief.py` 同型。

