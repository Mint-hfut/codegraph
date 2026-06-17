#!/usr/bin/env node
// Score one run's final answer against a task: assertion-first, LLM-judge fallback.
//
//   1. Assertion check (deterministic, free): every `mustInclude` string present
//      AND every `anyOf` group has at least one hit (case-insensitive substring).
//      This catches the common case where the answer plainly contains the fact.
//   2. If the assertion check fails, an LLM judge decides PASS/FAIL against the
//      task's reference answer — for answers that are correct but phrased so the
//      keywords don't literally appear. The judge runs as a separate, cheap
//      `claude -p` call (no MCP, no tools); ITS tokens are NOT part of the arm's
//      measured cost.
//
// Usage: score.mjs <tasks.json> <taskId> <run.jsonl>
// Output: one JSON line {success, by, reason}
// Env: JUDGE_MODEL (default sonnet), NO_JUDGE=1 to skip the LLM fallback.

import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { finalAnswerText, readEvents } from './lib.mjs';

const [tasksFile, taskId, runFile] = process.argv.slice(2);
if (!tasksFile || !taskId || !runFile) {
  console.error('usage: score.mjs <tasks.json> <taskId> <run.jsonl>');
  process.exit(1);
}

const tasks = JSON.parse(readFileSync(tasksFile, 'utf8')).tasks;
const task = tasks.find((t) => t.id === taskId);
if (!task) { console.error('unknown task', taskId); process.exit(1); }

const answer = finalAnswerText(readEvents(runFile));
const hay = answer.toLowerCase();

function assertCheck() {
  const must = task.mustInclude ?? [];
  for (const s of must) if (!hay.includes(s.toLowerCase())) return { ok: false, missing: s };
  for (const group of task.anyOf ?? []) {
    if (!group.some((s) => hay.includes(s.toLowerCase()))) return { ok: false, missing: group.join('|') };
  }
  return { ok: true };
}

function emit(o) { process.stdout.write(JSON.stringify(o) + '\n'); }

// Empty answer never passes (run errored / produced nothing).
if (!answer.trim()) { emit({ success: false, by: 'empty', reason: 'no answer text' }); process.exit(0); }

const a = assertCheck();
if (a.ok) { emit({ success: true, by: 'assert', reason: 'all assertions matched' }); process.exit(0); }

if (process.env.NO_JUDGE === '1') {
  emit({ success: false, by: 'assert', reason: `assertion miss: ${a.missing}` });
  process.exit(0);
}

// LLM-judge fallback.
const model = process.env.JUDGE_MODEL || 'sonnet';
const judgePrompt = [
  'You are grading whether a candidate answer is factually correct for a question about a software project.',
  'Grade ONLY on factual correctness against the reference; ignore phrasing, length, and extra detail.',
  'A candidate that states the key fact is PASS even if worded differently than the reference.',
  '',
  `QUESTION:\n${task.prompt}`,
  '',
  `REFERENCE ANSWER (ground truth):\n${task.reference}`,
  '',
  `CANDIDATE ANSWER:\n${answer.slice(0, 4000)}`,
  '',
  'Reply with ONE line of JSON and nothing else: {"pass": true|false, "reason": "<short>"}',
].join('\n');

try {
  const out = execFileSync(
    'claude',
    ['-p', judgePrompt, '--model', model, '--output-format', 'json', '--max-budget-usd', '1'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120000 }
  );
  // --output-format json wraps the result; pull the inner text then the JSON verdict.
  let text = out;
  try { const o = JSON.parse(out); text = o.result ?? out; } catch { /* raw text */ }
  const m = text.match(/\{[^{}]*"pass"[^{}]*\}/);
  if (!m) { emit({ success: false, by: 'judge-error', reason: 'judge gave no JSON verdict' }); process.exit(0); }
  const verdict = JSON.parse(m[0]);
  emit({ success: !!verdict.pass, by: 'judge', reason: String(verdict.reason || '').slice(0, 200) });
} catch (e) {
  emit({ success: false, by: 'judge-error', reason: (e.message || 'judge call failed').slice(0, 160) });
}
