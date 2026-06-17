#!/usr/bin/env node
// Aggregate results.jsonl into a comparison report (markdown to stdout).
//
// Each input line is one run: {arm, taskId, rep, success, by, tokens:{billable,..},
// tools:{reads,greps,codegraph,..}, durationMs, costUsd, ...}.
//
// Reports, per arm: task success rate (the headline metric), median billable
// tokens (the other headline metric), and median Read+Grep / codegraph calls /
// duration as supporting context. Medians, not means — run-to-run variance is
// large, so a single outlier shouldn't move the number.
//
// Usage: report.mjs <results.jsonl>

import { readFileSync } from 'fs';

const file = process.argv[2];
if (!file) { console.error('usage: report.mjs <results.jsonl>'); process.exit(1); }

const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
if (rows.length === 0) { console.error('no rows'); process.exit(1); }

const median = (xs) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const k = (n) => (n / 1000).toFixed(1) + 'k';
const pct = (n, d) => d ? Math.round((100 * n) / d) + '%' : '—';

const arms = [...new Set(rows.map((r) => r.arm))];
const tasks = [...new Set(rows.map((r) => r.taskId))];

const byArm = (arm) => rows.filter((r) => r.arm === arm);

console.log('# Knowledge benchmark — improved vs original codegraph\n');
console.log(`Runs: ${rows.length}  ·  arms: ${arms.join(', ')}  ·  tasks: ${tasks.length}  ·  reps/cell: ${rows.length / (arms.length * tasks.length) || '?'}\n`);

// --- headline table: one row per arm ---
console.log('## Summary (per arm)\n');
console.log('| Arm | Success rate | Median billable tokens | Median Read+Grep | Median codegraph calls | Median duration | Total cost |');
console.log('|---|---|---|---|---|---|---|');
for (const arm of arms) {
  const rs = byArm(arm);
  const passed = rs.filter((r) => r.success).length;
  const tok = median(rs.map((r) => r.tokens?.billable ?? 0));
  const rg = median(rs.map((r) => (r.tools?.reads ?? 0) + (r.tools?.greps ?? 0)));
  const cg = median(rs.map((r) => r.tools?.codegraph ?? 0));
  const dur = median(rs.map((r) => (r.durationMs ?? 0) / 1000));
  const cost = rs.reduce((a, r) => a + (r.costUsd ?? 0), 0);
  console.log(`| ${arm} | ${pct(passed, rs.length)} (${passed}/${rs.length}) | ${k(tok)} | ${rg} | ${cg} | ${dur.toFixed(0)}s | $${cost.toFixed(2)} |`);
}

// --- per-task success matrix ---
console.log('\n## Success by task\n');
console.log(`| Task | ${arms.map((a) => a).join(' | ')} |`);
console.log(`|---|${arms.map(() => '---').join('|')}|`);
for (const task of tasks) {
  const cells = arms.map((arm) => {
    const rs = rows.filter((r) => r.arm === arm && r.taskId === task);
    const passed = rs.filter((r) => r.success).length;
    return `${pct(passed, rs.length)} (${passed}/${rs.length})`;
  });
  console.log(`| ${task} | ${cells.join(' | ')} |`);
}

// --- per-task median billable tokens ---
console.log('\n## Median billable tokens by task\n');
console.log(`| Task | ${arms.join(' | ')} |`);
console.log(`|---|${arms.map(() => '---').join('|')}|`);
for (const task of tasks) {
  const cells = arms.map((arm) => {
    const rs = rows.filter((r) => r.arm === arm && r.taskId === task);
    return k(median(rs.map((r) => r.tokens?.billable ?? 0)));
  });
  console.log(`| ${task} | ${cells.join(' | ')} |`);
}

// --- scoring provenance (how many passes came from the LLM judge vs assertions) ---
const judged = rows.filter((r) => r.by === 'judge');
if (judged.length) {
  console.log(`\n_${judged.length} run(s) fell back to the LLM judge; the rest were settled by assertion match._`);
}
const errored = rows.filter((r) => r.subtype && r.subtype !== 'success');
if (errored.length) {
  console.log(`\n⚠️  ${errored.length} run(s) did not end with a clean result event — check the raw logs.`);
}
