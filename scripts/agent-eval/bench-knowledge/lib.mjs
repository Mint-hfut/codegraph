// Shared parsing for the knowledge benchmark.
//
// All metrics are derived from a Claude Code `--output-format stream-json` run
// log (one JSON event per line). Two things matter and both are computed here so
// parse-bench.mjs and score.mjs agree:
//
//   1. Token usage — summed PER ASSISTANT TURN, never read from the final
//      `result.usage`. Claude Code's `result.usage` reports only the LAST turn,
//      so a multi-turn agent's real cost is the sum across turns (see CLAUDE.md,
//      "Measure tokens by summing per-turn assistant usage"). Subagent turns
//      (parent_tool_use_id != null) are included — they are real work the arm
//      paid for.
//   2. The agent's final answer text — taken from the terminal `result` event,
//      which is what the scorer judges.

import { readFileSync } from 'fs';

/** Parse a stream-json run log into the events array (bad lines skipped). */
export function readEvents(file) {
  const out = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* ignore partial/non-json lines */ }
  }
  return out;
}

/**
 * Sum token usage across every assistant turn (main thread + subagents).
 *   gen    = output tokens (generation)
 *   fresh  = uncached input (input + cache_creation) — the part actually billed at input rate
 *   cached = cache reads (≈free, but reported)
 *   billable ≈ gen + fresh  (the cost-relevant total; cached is near-zero-cost)
 */
export function sumTokens(events) {
  const t = { gen: 0, fresh: 0, cached: 0 };
  for (const ev of events) {
    if (ev.type !== 'assistant') continue;
    const u = ev.message?.usage;
    if (!u) continue;
    t.gen += u.output_tokens || 0;
    t.fresh += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    t.cached += u.cache_read_input_tokens || 0;
  }
  t.billable = t.gen + t.fresh;
  return t;
}

/** Count tool calls by name across all assistant turns (incl. subagent turns). */
export function toolCounts(events) {
  const counts = {};
  for (const ev of events) {
    if (ev.type !== 'assistant') continue;
    const content = ev.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b.type === 'tool_use') counts[b.name] = (counts[b.name] || 0) + 1;
    }
  }
  return counts;
}

/** Group raw tool counts into the metrics we report. */
export function bucketTools(counts) {
  let reads = 0, greps = 0, codegraph = 0, explore = 0, other = 0;
  for (const [name, n] of Object.entries(counts)) {
    if (name === 'Read') reads += n;
    else if (name === 'Grep' || name === 'Glob') greps += n;
    else if (name === 'Bash') greps += n; // Bash is overwhelmingly grep/find/cat in these runs
    else if (/codegraph/.test(name)) {
      codegraph += n;
      if (/explore/.test(name)) explore += n;
    } else other += n;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { reads, greps, codegraph, explore, other, total };
}

/** The terminal result event (last one wins), or null. */
export function resultEvent(events) {
  let r = null;
  for (const ev of events) if (ev.type === 'result') r = ev;
  return r;
}

/** The agent's final answer text, or '' if the run produced none. */
export function finalAnswerText(events) {
  const r = resultEvent(events);
  if (r && typeof r.result === 'string') return r.result;
  // Fallback: last assistant text block (e.g. run errored before a result event).
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type !== 'assistant') continue;
    const content = ev.message?.content;
    if (!Array.isArray(content)) continue;
    const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (text) return text;
  }
  return '';
}

/** Whether codegraph MCP tools were actually exposed (init snapshot). */
export function codegraphExposed(events) {
  for (const ev of events) {
    if (ev.type === 'system' && ev.subtype === 'init') {
      return (ev.tools || []).filter((t) => /codegraph/.test(t)).length;
    }
  }
  return 0;
}

/** Full metrics object for one run. */
export function runMetrics(file) {
  const events = readEvents(file);
  const tokens = sumTokens(events);
  const tools = bucketTools(toolCounts(events));
  const r = resultEvent(events);
  return {
    file,
    tokens,
    tools,
    answer: finalAnswerText(events),
    codegraphToolsExposed: codegraphExposed(events),
    subtype: r?.subtype ?? 'none',
    isError: r?.is_error ?? true,
    durationMs: r?.duration_ms ?? 0,
    numTurns: r?.num_turns ?? 0,
    costUsd: r?.total_cost_usd ?? 0,
  };
}
