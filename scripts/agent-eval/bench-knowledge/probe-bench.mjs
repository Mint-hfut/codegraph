#!/usr/bin/env node
// Deterministic retrieval benchmark — NO LLM, NO agent.
//
// Runs every probe in probes.json against an indexed corpus and reports
// pass/fail. 'search' probes go through the build-under-test's own
// `CodeGraph.searchNodes` (the exact retrieval path codegraph_search wraps);
// 'edge' probes read the SQLite graph directly. Because it imports the build's
// dist, the SAME script measures the improved and original builds — point it at
// each build's dist in turn (run-probe.sh does this).
//
// Usage: probe-bench.mjs <dist-dir> <indexed-corpus-dir> [arm-label]
// Output: a human table on stderr + one JSON line per probe on stdout
//         ({arm, id, type, pass, detail}), so a caller can aggregate.

import { createRequire } from 'module';
import { join } from 'path';
import { readFileSync, readdirSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';

const [distDir, corpus, arm = 'improved'] = process.argv.slice(2);
if (!distDir || !corpus) {
  console.error('usage: probe-bench.mjs <dist-dir> <indexed-corpus-dir> [arm-label]');
  process.exit(1);
}

const HERE = new URL('.', import.meta.url).pathname;
const probes = JSON.parse(readFileSync(join(HERE, 'probes.json'), 'utf8')).probes;

// Load the build-under-test's library API (CJS dist — require, like the CLI).
const require = createRequire(import.meta.url);
const mod = require(join(distDir, 'index.js'));
const CodeGraph = mod.CodeGraph ?? mod.default ?? mod;
const cg = await CodeGraph.open(corpus);

// Open the raw graph DB for edge probes.
const cgDir = join(corpus, '.codegraph');
const dbFile = readdirSync(cgDir).find((f) => f.endsWith('.db'));
const db = dbFile ? new DatabaseSync(join(cgDir, dbFile)) : null;

const lc = (s) => (s ?? '').toLowerCase();

function runSearch(p) {
  let results;
  try {
    results = cg.searchNodes(p.query, { limit: p.limit ?? 5, kinds: p.kinds });
  } catch (e) {
    return { pass: false, detail: `searchNodes threw: ${e.message}` };
  }
  const matchIdx = results.findIndex((r) => {
    const n = r.node;
    if (p.expect.filePathEndsWith && !n.filePath.endsWith(p.expect.filePathEndsWith)) return false;
    if (p.expect.signature && n.signature !== p.expect.signature) return false;
    if (p.expect.docstringIncludes && !lc(n.docstring).includes(lc(p.expect.docstringIncludes))) return false;
    return true;
  });
  if (matchIdx < 0) {
    const top = results.slice(0, 3).map((r) => `${r.node.signature ?? r.node.kind}:${r.node.filePath}`).join(', ');
    return { pass: false, detail: `no match in top ${results.length} [${top || 'empty'}]` };
  }
  if (p.expectTop && matchIdx !== 0) {
    return { pass: false, detail: `matched at rank ${matchIdx + 1}, expected #1 (${results[0].node.filePath})` };
  }
  return { pass: true, detail: `rank ${matchIdx + 1}` };
}

function runEdge(p) {
  if (!db) return { pass: false, detail: 'no graph db' };
  let sql = 'SELECT id FROM nodes WHERE file_path LIKE ?';
  const args = ['%' + p.fromPathEndsWith];
  if (p.fromSignature) { sql += ' AND signature = ?'; args.push(p.fromSignature); }
  const fromIds = db.prepare(sql).all(...args).map((r) => r.id);
  if (fromIds.length === 0) return { pass: false, detail: `no source node for ${p.fromPathEndsWith}` };

  const placeholders = fromIds.map(() => '?').join(',');
  const missing = [];
  for (const tp of p.targetPathsEndWith) {
    const row = db
      .prepare(`SELECT count(*) c FROM edges WHERE source IN (${placeholders}) AND kind = ? AND target LIKE ?`)
      .get(...fromIds, p.edgeKind, '%' + tp);
    if (!row || row.c === 0) missing.push(tp);
  }
  return missing.length
    ? { pass: false, detail: `missing ${p.edgeKind} edge(s) to: ${missing.join(', ')}` }
    : { pass: true, detail: `all ${p.targetPathsEndWith.length} edge(s) present` };
}

let pass = 0;
const rows = [];
for (const p of probes) {
  const res = p.type === 'edge' ? runEdge(p) : runSearch(p);
  if (res.pass) pass++;
  rows.push({ arm, id: p.id, type: p.type, pass: res.pass, detail: res.detail });
  process.stderr.write(`  ${res.pass ? '✅ PASS' : '❌ FAIL'}  ${p.id.padEnd(20)} ${res.detail}\n`);
  process.stdout.write(JSON.stringify({ arm, ...{ id: p.id, type: p.type }, pass: res.pass, detail: res.detail }) + '\n');
}
process.stderr.write(`  ── ${arm}: ${pass}/${probes.length} probes passed ──\n`);

await cg.close?.();
