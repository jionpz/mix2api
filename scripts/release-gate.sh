#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

CHANNEL="${1:-stable}"
VERSION="${2:-local}"
TS="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="_bmad-output/release-gates/${TS}-${CHANNEL}"
mkdir -p "$OUT_DIR"

SUMMARY_FILE="${OUT_DIR}/summary.txt"
PASS_COUNT=0
FAIL_COUNT=0

echo "release_gate channel=${CHANNEL} version=${VERSION} ts=${TS}" | tee "$SUMMARY_FILE"

run_pack() {
  local pack_name="$1"
  local pattern="$2"
  local log_file="${OUT_DIR}/${pack_name}.log"

  echo "running ${pack_name} pattern=${pattern}" | tee -a "$SUMMARY_FILE"
  if node --test --test-name-pattern "$pattern" tests/integration/chat-completions-auth-nonstream.test.js >"$log_file" 2>&1; then
    echo "result ${pack_name}=PASS" | tee -a "$SUMMARY_FILE"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "result ${pack_name}=FAIL log=${log_file}" | tee -a "$SUMMARY_FILE"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

run_pack "pack-a-stream" "stream=true|DONE|flushes first chunk|request.completed logs fixed dimensions"
run_pack "pack-b-tools-loop" "forwards tools schema|legacy functions|tool_calls|tool backfill|MCP-safe"
run_pack "pack-c-cancel-timeout" "timeout|client abort|upstream HTTP error|upstream payload error"

echo "totals pass=${PASS_COUNT} fail=${FAIL_COUNT}" | tee -a "$SUMMARY_FILE"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  echo "gate=BLOCK reason=regression_failed" | tee -a "$SUMMARY_FILE"
  echo "rollback_action: set ${CHANNEL} weight to 0% and collect request_id evidence" | tee -a "$SUMMARY_FILE"
  exit 1
fi

echo "gate=PASS" | tee -a "$SUMMARY_FILE"
