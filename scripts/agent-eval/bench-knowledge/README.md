# Knowledge benchmark — improved vs original codegraph

Measures whether the **artifact knowledge-graph** work (indexing docs, skills,
agent memory, slash commands, and binary assets, plus skill-bundle edges and
memory-rank weighting) actually helps an agent — on the two metrics you asked
for: **task success rate** and **token consumption**.

It compares two arms, **both with codegraph attached over MCP**:

| Arm | Build | What it has |
|---|---|---|
| `improved` | current working tree | the knowledge graph (docs/skills/memory/commands/assets indexed) |
| `original` | baseline git ref (default `16c73e2`) | codegraph *before* the knowledge-graph work — markdown/skills not indexed |

There are **two tiers**, run them in order:

| Tier | Script | Cost | Measures |
|---|---|---|---|
| 1 — deterministic probes | `run-probe.sh` | **none (no LLM)** | does codegraph *surface the right knowledge* (retrieval correctness)? |
| 2 — full agent A/B | `run-bench.sh` | real agent runs (opus) | task **success rate** + **token consumption** end to end |

Tier 1 is the cheap, reproducible proof that the feature changed what's
retrievable; Tier 2 is the expensive proof that it changes agent outcomes. Tier 1
should pass before Tier 2 is worth spending money on (CLAUDE.md's validation
methodology: "deterministic probes" first, then the agent A/B).

## Tier 1 — deterministic probes (no LLM)

```bash
scripts/agent-eval/bench-knowledge/run-probe.sh            # ~12s, free
SKIP_BASELINE=1 scripts/agent-eval/bench-knowledge/run-probe.sh   # improved only
```

It generates a tiny synthetic corpus (`make-fixture.mjs`) that contains one of
everything — an agent skill with frontmatter + bundle siblings, a slash command
with an `argument-hint`, an agent-memory file vs an ordinary doc sharing a rare
term, a binary asset, and a README that links the asset and a code symbol — then
indexes it with **both builds** and runs the probes in `probes.json` against each.

Each probe is a benchmark task phrased as "when an agent searches for X, does
codegraph surface the right knowledge?" — checked through the real `searchNodes`
path (what `codegraph_search` wraps) or the graph edges directly. No model is
involved, so the result is deterministic. Example output:

```
| Probe                | improved | original |
|----------------------|:--------:|:--------:|
| skill-by-capability  |    ✅    |    ❌    |   skill found by its description
| skill-by-trigger     |    ✅    |    ❌    |   "Use when…" trigger is searchable
| command-frontmatter  |    ✅    |    ❌    |   command + argument-hint folded in
| memory-outranks-doc  |    ✅    |    ❌    |   memory ranks above a plain doc
| asset-by-name        |    ✅    |    ❌    |   asset found by name, content not indexed
| skill-bundle-edges   |    ✅    |    ❌    |   SKILL.md linked to its siblings
| doc-to-asset-edge    |    ✅    |    ❌    |   README image link → asset node
| doc-to-code-edge     |    ✅    |    ❌    |   README symbol mention → code node
improved: 8/8 · original: 0/8
```

(The `original` build at `16c73e2` doesn't index these knowledge files at all, so
none of the nodes/edges exist — the 8/0 split is the feature, isolated.)

## Tier 2 — full agent A/B (success rate + tokens)

Same two builds, both attached over MCP, but now a real agent answers the
questions in `tasks.json` over a corpus (default: **this repo**, which is full of
skills, a big `CLAUDE.md`, and docs).

```bash
# default: this repo as corpus, baseline 16c73e2, 1 rep/cell, opus
scripts/agent-eval/bench-knowledge/run-bench.sh

# 2 reps/cell (recommended — run-to-run variance is large), a subset of tasks
REPS=2 TASKS=skill-add-lang,asset-policy scripts/agent-eval/bench-knowledge/run-bench.sh

# see the plan without spending anything
DRY_RUN=1 scripts/agent-eval/bench-knowledge/run-bench.sh
```

Output (under `/tmp/bench-knowledge` by default): a `report.md` comparison
table, `results.jsonl` (one row per run), and the raw `run-*.jsonl` agent logs.

## How each metric is measured

- **Token consumption** — summed **per assistant turn** (`output` + uncached
  `input`/`cache_creation`), across the main thread *and* subagents. NOT read
  from `result.usage`, which Claude Code reports for the last turn only (see
  `CLAUDE.md` → "Measure tokens by summing per-turn assistant usage"). The
  headline number is `billable ≈ gen + fresh-input`; cache reads are tracked
  separately because they're near-free.
- **Task success** — assertion-first, LLM-judge fallback (`score.mjs`):
  1. Deterministic check that the required facts appear in the final answer
     (`mustInclude` / `anyOf` in `tasks.json`). Free, reproducible.
  2. If that misses, a separate cheap `claude -p` judge grades the answer
     against a reference (for correct-but-differently-worded answers). The
     judge's own tokens are **not** counted toward either arm.

Supporting context per run: Read+Grep count, codegraph call count, duration.

## Files

| File | Role |
|---|---|
| **Tier 1 (no LLM)** | |
| `probes.json` | the deterministic benchmark tasks + expected nodes/edges |
| `make-fixture.mjs` | generates the synthetic corpus exercising every feature |
| `run-probe.sh` | builds both arms, indexes the fixture, runs the probes, reports |
| `probe-bench.mjs` | runs probes against one build (searchNodes + graph edges) |
| `probe-report.mjs` | `probe-results.jsonl` → improved-vs-original table |
| **Tier 2 (agent A/B)** | |
| `tasks.json` | the questions + assertion keywords + reference answers |
| `run-bench.sh` | orchestrator: builds both arms, indexes the corpus per arm, runs every task×rep, scores, reports |
| `lib.mjs` | shared stream-json parsing (per-turn token sum, tool buckets, final-answer extraction) |
| `parse-bench.mjs` | one run log → metrics JSON line |
| `score.mjs` | one run → `{success, by, reason}` (assertion → judge) |
| `report.mjs` | `results.jsonl` → markdown comparison tables |

## Caveats

- **Cost / rate limits.** A full matrix is `2 arms × tasks × reps` real agent
  runs at `--model opus`, plus a baseline rebuild and two corpus indexes. Start
  with `DRY_RUN=1`, then a small `TASKS=` subset. Overage may be disabled on
  your org — watch the 5-hour window.
- **Variance.** Agent runs vary run-to-run; use `REPS>=2` and read the medians,
  never a single run (the report uses medians deliberately).
- **Baseline node_modules.** The baseline worktree symlinks the current repo's
  `node_modules` to avoid a slow `npm ci`. Fine when the baseline ref is close
  to HEAD (same deps); if you pick a far-back ref whose dependencies differ,
  `npm ci` inside the worktree instead.
- This harness deliberately uses headless `claude -p` (clean stream-json for
  parsing), unlike `itrun.sh` which drives the interactive TUI. For knowledge
  Q&A the answer text and token totals are what matter, and both are exact in
  the stream.
