#!/usr/bin/env node
// Aggregate probe-results.jsonl into a per-probe improved-vs-original table.
// Usage: probe-report.mjs <probe-results.jsonl>
import { readFileSync } from 'fs';

const file = process.argv[2];
const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
if (rows.length === 0) { console.error('no rows'); process.exit(1); }

const arms = [...new Set(rows.map((r) => r.arm))];
const ids = [...new Set(rows.map((r) => r.id))];
const cell = (arm, id) => rows.find((r) => r.arm === arm && r.id === id);

const mark = (b) => (b === undefined ? '—' : b ? '✅' : '❌');

console.log(`| Probe | ${arms.join(' | ')} |`);
console.log(`|---|${arms.map(() => ':--:').join('|')}|`);
for (const id of ids) {
  console.log(`| ${id} | ${arms.map((a) => mark(cell(a, id)?.pass)).join(' | ')} |`);
}

console.log('');
for (const arm of arms) {
  const rs = rows.filter((r) => r.arm === arm);
  const pass = rs.filter((r) => r.pass).length;
  console.log(`${arm}: ${pass}/${rs.length} probes passed`);
}
