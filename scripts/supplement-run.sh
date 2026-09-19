#!/bin/bash
# AH-02 supplemental runs share the daily lock, isolated candidates and quality gate.
set -uo pipefail
if [[ $# -eq 0 ]]; then
    set -- topnews taiwan china usa techtrends governance
fi
exec bash "$(dirname "$0")/run-daily.sh" --categories "$@"
