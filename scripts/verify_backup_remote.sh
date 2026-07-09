#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/verify_backup_remote.sh [--remote NAME] [--branch NAME] [--allow-dirty] [--skip-adapter]

Verifies that the current ai-news-hub checkout is safely backed up to a git
remote and that the Hermes reference adapter boundary gate still passes.

Checks:
  - current directory is inside a git repository
  - Hermes adapter boundary gate passes
  - target remote exists and has a reachable branch ref
  - local branch HEAD equals the remote branch HEAD
  - current branch tracks the expected remote branch
  - working tree is clean unless --allow-dirty is provided
USAGE
}

remote="local-backup"
branch=""
allow_dirty=0
skip_adapter=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --remote)
      if [ "$#" -lt 2 ]; then
        echo "ERROR: --remote requires a value" >&2
        exit 2
      fi
      remote="$2"
      shift 2
      ;;
    --branch)
      if [ "$#" -lt 2 ]; then
        echo "ERROR: --branch requires a value" >&2
        exit 2
      fi
      branch="$2"
      shift 2
      ;;
    --allow-dirty)
      allow_dirty=1
      shift
      ;;
    --skip-adapter)
      skip_adapter=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "ERROR: not inside a git repository" >&2
  exit 1
}

cd "$repo_root"

check_file() {
  local path="$1"
  if [ ! -f "$path" ]; then
    echo "ERROR: required file missing: $path" >&2
    exit 1
  fi
}

check_file "hermes.project.yaml"
check_file "scripts/agent/check-agent-outputs.mjs"

if [ "$skip_adapter" -eq 0 ]; then
  echo "==> Hermes adapter boundary gate"
  node scripts/agent/check-agent-outputs.mjs --strict --self-test-boundary
fi

if [ -z "$branch" ]; then
  branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
fi

if [ -z "$branch" ]; then
  echo "ERROR: cannot infer branch from detached HEAD; pass --branch" >&2
  exit 1
fi

if ! git remote get-url "$remote" >/dev/null 2>&1; then
  echo "ERROR: remote '$remote' is not configured" >&2
  exit 1
fi

remote_url="$(git remote get-url --push "$remote" 2>/dev/null || git remote get-url "$remote")"
local_head="$(git rev-parse "$branch")"
remote_head="$(git ls-remote --heads "$remote" "$branch" | awk '{print $1}')"

if [ -z "$remote_head" ]; then
  echo "ERROR: remote '$remote' has no branch '$branch'" >&2
  echo "remote_url=$remote_url" >&2
  exit 1
fi

if [ "$local_head" != "$remote_head" ]; then
  echo "ERROR: local '$branch' is not backed up to '$remote/$branch'" >&2
  echo "local_head=$local_head" >&2
  echo "remote_head=$remote_head" >&2
  echo "remote_url=$remote_url" >&2
  exit 1
fi

upstream="$(git rev-parse --abbrev-ref --symbolic-full-name "${branch}@{upstream}" 2>/dev/null || true)"
expected_upstream="$remote/$branch"

if [ "$upstream" != "$expected_upstream" ]; then
  echo "ERROR: branch '$branch' tracks '$upstream', expected '$expected_upstream'" >&2
  exit 1
fi

dirty_status="$(git status --porcelain)"
if [ "$allow_dirty" -ne 1 ] && [ -n "$dirty_status" ]; then
  echo "ERROR: working tree is dirty; commit or stash changes before declaring backup healthy" >&2
  git status --short >&2
  exit 1
fi

echo "ai_news_hub_backup_status=PASS"
echo "repo_root=$repo_root"
echo "remote=$remote"
echo "remote_url=$remote_url"
echo "branch=$branch"
echo "head=$local_head"
echo "upstream=$upstream"
if [ "$skip_adapter" -eq 1 ]; then
  echo "adapter_gate=SKIPPED"
else
  echo "adapter_gate=PASS"
fi
if [ "$allow_dirty" -eq 1 ]; then
  echo "dirty_check=SKIPPED"
else
  echo "dirty_check=PASS"
fi
