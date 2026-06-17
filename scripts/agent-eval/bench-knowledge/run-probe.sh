#!/usr/bin/env bash
# Deterministic retrieval benchmark — NO LLM, NO agent, runs in seconds.
#
# Generates a synthetic corpus that exercises every knowledge-graph feature,
# indexes it with the IMPROVED build (current) and the ORIGINAL build (a baseline
# git ref), and runs the probes in probes.json against each. Each probe asks
# "does codegraph surface the right knowledge here?" via the real searchNodes
# path / the graph edges — so the pass/fail gap between the two builds is the
# benchmark result, with zero model cost.
#
# Usage: run-probe.sh [baseline-ref]   (default baseline: 16c73e2)
# Env:   SKIP_BASELINE=1   only probe the improved build
#        AGENT_EVAL_OUT=DIR   work dir (default /tmp/bench-knowledge-probe)
set -uo pipefail
export NODE_NO_WARNINGS=1

HERE="$(cd "$(dirname "$0")" && pwd)"
ENGINE="$(cd "$HERE/../../.." && pwd)"
BASE_REF="${1:-16c73e2}"
OUT="${AGENT_EVAL_OUT:-/tmp/bench-knowledge-probe}"
WORKTREE="$OUT/baseline-engine"
RESULTS="$OUT/probe-results.jsonl"
mkdir -p "$OUT"; : > "$RESULTS"

command -v node >/dev/null || { echo "node not on PATH"; exit 1; }

cleanup() { git -C "$ENGINE" worktree remove --force "$WORKTREE" 2>/dev/null; }
trap cleanup EXIT

probe_arm() { # arm-label dist-dir
  local arm="$1" dist="$2" corpus="$OUT/corpus-$1"
  node "$HERE/make-fixture.mjs" "$corpus" >/dev/null
  node "$dist/bin/codegraph.js" init "$corpus" >/dev/null 2>&1 || { echo "  index failed ($arm)"; return 1; }
  echo "== [$arm] probes =="
  node "$HERE/probe-bench.mjs" "$dist" "$corpus" "$arm" 2>&1 >>"$RESULTS"
}

# --- IMPROVED (current build) ---
( cd "$ENGINE" && npm run build >/dev/null 2>&1 ) && echo "improved build: ok"
probe_arm improved "$ENGINE/dist"

# --- ORIGINAL (baseline ref via full worktree checkout) ---
if [ "${SKIP_BASELINE:-0}" != 1 ]; then
  git -C "$ENGINE" worktree remove --force "$WORKTREE" 2>/dev/null
  if git -C "$ENGINE" worktree add --force "$WORKTREE" "$BASE_REF" >/dev/null 2>&1; then
    ln -sfn "$ENGINE/node_modules" "$WORKTREE/node_modules"
    ( cd "$WORKTREE" && npm run build >/dev/null 2>&1 ) && echo "original build ($BASE_REF): ok"
    probe_arm original "$WORKTREE/dist"
  else
    echo "WARN: could not create baseline worktree at $BASE_REF — skipping original arm"
  fi
fi

echo
echo "== SUMMARY =="
node "$HERE/probe-report.mjs" "$RESULTS"
echo
echo "Raw: $RESULTS"
