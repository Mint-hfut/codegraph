#!/usr/bin/env bash
# Knowledge benchmark: IMPROVED codegraph (current build) vs ORIGINAL codegraph
# (a baseline git ref), BOTH attached over MCP, on a set of knowledge questions
# answered against a corpus repo. Measures the two metrics that matter here:
# task SUCCESS RATE and TOKEN consumption (plus Read/Grep + codegraph call counts
# as supporting context).
#
# Why a git worktree for the baseline (not `git checkout <ref> -- <files>` like
# ab-new-vs-baseline.sh): the knowledge-graph feature is mostly NEW files
# (artifact extractors, skill-bundle, extra-roots). `git checkout <ref> -- path`
# can't remove a file that didn't exist at <ref>, so a file-level revert would
# leave the feature half-present. A full worktree checkout at the ref is a true
# "before" build.
#
# Reliable MCP attach (works even nested inside a Claude session): each arm
# pre-warms a persistent codegraph daemon for its corpus copy, and claude
# connects with CODEGRAPH_WASM_RELAUNCHED=1 to skip the startup re-exec — so it's
# attached before the agent's first turn (same technique as ab-new-vs-baseline).
#
# Usage:   run-bench.sh [corpus-repo] [baseline-ref] [reps]
#   corpus-repo   repo whose knowledge files the questions are about
#                 (default: this engine repo — it's rich in skills/docs/memory)
#   baseline-ref  the ORIGINAL build (default: 16c73e2, the commit before the
#                 knowledge-graph work landed)
#   reps          runs per (arm × task) cell (default: 1; use >=2 for variance)
# Env:
#   MODEL=opus            model for the agent arms (default opus)
#   JUDGE_MODEL=sonnet    model for the LLM judge fallback
#   TASKS=id1,id2         restrict to these task ids (default: all in tasks.json)
#   MAX_USD=2             per-run agent budget cap
#   NO_JUDGE=1            assertion-only scoring (no LLM judge)
#   DRY_RUN=1             print the plan and exit (no build/index/agent calls)
#   AGENT_EVAL_OUT=DIR    output dir (default /tmp/bench-knowledge)
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ENGINE="$(cd "$HERE/../../.." && pwd)"
CORPUS_SRC="${1:-$ENGINE}"
BASE_REF="${2:-16c73e2}"
REPS="${3:-${REPS:-1}}"
MODEL="${MODEL:-opus}"
MAX_USD="${MAX_USD:-2}"
OUT="${AGENT_EVAL_OUT:-/tmp/bench-knowledge}"
TASKS_FILE="$HERE/tasks.json"
BIN_NEW="$ENGINE/dist/bin/codegraph.js"
WORKTREE="$OUT/baseline-engine"
BIN_BASE="$WORKTREE/dist/bin/codegraph.js"

command -v claude >/dev/null || { echo "claude CLI not on PATH"; exit 1; }
command -v node   >/dev/null || { echo "node not on PATH"; exit 1; }
[ -d "$CORPUS_SRC" ] || { echo "corpus repo not found: $CORPUS_SRC"; exit 1; }

# Task list.
mapfile -t ALL_TASKS < <(node -e 'for(const t of require(process.argv[1]).tasks) console.log(t.id)' "$TASKS_FILE")
if [ -n "${TASKS:-}" ]; then IFS=',' read -ra TASK_IDS <<< "$TASKS"; else TASK_IDS=("${ALL_TASKS[@]}"); fi

echo "###### corpus=$CORPUS_SRC"
echo "###### improved=current build   original=$BASE_REF"
echo "###### model=$MODEL  reps=$REPS  tasks=${TASK_IDS[*]}"
echo "###### out=$OUT"
echo

if [ "${DRY_RUN:-0}" = 1 ]; then
  echo "DRY RUN — would execute these runs:"
  for arm in improved original; do
    for id in "${TASK_IDS[@]}"; do
      for r in $(seq 1 "$REPS"); do echo "  [$arm] $id rep$r"; done
    done
  done
  total=$(( 2 * ${#TASK_IDS[@]} * REPS ))
  echo "Total agent runs: $total (plus 1 baseline build + 2 indexes)."
  exit 0
fi

mkdir -p "$OUT"
RESULTS="$OUT/results.jsonl"; : > "$RESULTS"

cleanup() {
  pkill -9 -f "serve --mcp --path $OUT/corpus-" 2>/dev/null
  git -C "$ENGINE" worktree remove --force "$WORKTREE" 2>/dev/null
}
trap cleanup EXIT

prewarm() { # corpus-dir bin
  pkill -9 -f "serve --mcp --path $1" 2>/dev/null
  CODEGRAPH_DAEMON_IDLE_TIMEOUT_MS=3600000 node "$2" serve --mcp --path "$1" </dev/null >/dev/null 2>&1 &
  node -e 'const fs=require("fs");let n=0;const t=setInterval(()=>{if(fs.existsSync(process.argv[1]+"/.codegraph/daemon.sock")){clearInterval(t);process.exit(0)}if(n++>200){clearInterval(t);process.exit(1)}},100)' "$1" \
    && echo "  daemon warm: $1" || echo "  WARN: daemon never bound for $1"
}

setup_arm() { # arm-name bin
  local arm="$1" bin="$2" corpus="$OUT/corpus-$1"
  echo "== [$arm] prepare corpus + index =="
  rm -rf "$corpus"
  rsync -a --exclude node_modules --exclude .git --exclude dist --exclude .codegraph \
        --exclude 'corpus-*' --exclude baseline-engine "$CORPUS_SRC/" "$corpus/"
  node "$bin" init "$corpus" >/dev/null 2>&1 && echo "  indexed $corpus" || echo "  WARN: index failed for $arm"
  prewarm "$corpus" "$bin"
}

run_one() { # arm bin task-id rep
  local arm="$1" bin="$2" id="$3" rep="$4" corpus="$OUT/corpus-$1"
  local cfg="$OUT/mcp-$arm.json"
  local log="$OUT/run-$arm-$id-r$rep.jsonl"
  printf '{"mcpServers":{"codegraph":{"command":"env","args":["CODEGRAPH_WASM_RELAUNCHED=1","node","%s","serve","--mcp","--path","%s"]}}}' "$bin" "$corpus" > "$cfg"
  local prompt
  prompt="$(node -e 'const t=require(process.argv[1]).tasks.find(x=>x.id===process.argv[2]);process.stdout.write(t.prompt)' "$TASKS_FILE" "$id")"
  ( cd "$corpus" && claude -p "$prompt" \
      --output-format stream-json --verbose --permission-mode bypassPermissions \
      --model "$MODEL" --max-budget-usd "$MAX_USD" --strict-mcp-config --mcp-config "$cfg" \
      </dev/null > "$log" 2>"$OUT/run-$arm-$id-r$rep.err" )
  # Merge metrics + score into one results row.
  local metrics score
  metrics="$(node "$HERE/parse-bench.mjs" "$log" "$arm" "$id" "$rep")"
  score="$(node "$HERE/score.mjs" "$TASKS_FILE" "$id" "$log")"
  node -e 'const m=JSON.parse(process.argv[1]),s=JSON.parse(process.argv[2]);process.stdout.write(JSON.stringify({...m,...s}))' \
    "$metrics" "$score" >> "$RESULTS"
  echo "" >> "$RESULTS"
  local ok; ok="$(echo "$score" | node -e 'process.stdin.on("data",d=>{const s=JSON.parse(d);console.log(s.success?"PASS":"FAIL",s.by)})')"
  local tok; tok="$(echo "$metrics" | node -e 'process.stdin.on("data",d=>{const m=JSON.parse(d);console.log((m.tokens.billable/1000).toFixed(1)+"k bill | R+G "+(m.tools.reads+m.tools.greps)+" | cg "+m.tools.codegraph)})')"
  printf '  [%s] %-18s r%s  %-9s %s\n' "$arm" "$id" "$rep" "$ok" "$tok"
}

# --- IMPROVED arm (current build) ---
echo "== build IMPROVED (current) =="
( cd "$ENGINE" && npm run build >/dev/null 2>&1 ) && echo "  built" || { echo "  build failed"; exit 1; }
setup_arm improved "$BIN_NEW"
for id in "${TASK_IDS[@]}"; do for r in $(seq 1 "$REPS"); do run_one improved "$BIN_NEW" "$id" "$r"; done; done
pkill -9 -f "serve --mcp --path $OUT/corpus-improved" 2>/dev/null

# --- ORIGINAL arm (baseline ref via worktree) ---
echo "== build ORIGINAL ($BASE_REF) in a worktree =="
git -C "$ENGINE" worktree remove --force "$WORKTREE" 2>/dev/null
git -C "$ENGINE" worktree add --force "$WORKTREE" "$BASE_REF" >/dev/null 2>&1 || { echo "  worktree add failed"; exit 1; }
ln -sfn "$ENGINE/node_modules" "$WORKTREE/node_modules"
( cd "$WORKTREE" && npm run build >/dev/null 2>&1 ) && echo "  built baseline" || { echo "  baseline build failed"; exit 1; }
setup_arm original "$BIN_BASE"
for id in "${TASK_IDS[@]}"; do for r in $(seq 1 "$REPS"); do run_one original "$BIN_BASE" "$id" "$r"; done; done
pkill -9 -f "serve --mcp --path $OUT/corpus-original" 2>/dev/null

echo
echo "== REPORT =="
node "$HERE/report.mjs" "$RESULTS" | tee "$OUT/report.md"
echo
echo "Raw results: $RESULTS   ·   per-run logs: $OUT/run-*.jsonl"
