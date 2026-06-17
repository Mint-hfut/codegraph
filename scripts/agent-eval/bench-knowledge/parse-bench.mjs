#!/usr/bin/env node
// Emit one run's metrics as a single JSON line.
// Usage: parse-bench.mjs <run.jsonl> [arm] [taskId] [rep]
import { runMetrics } from './lib.mjs';

const [file, arm, taskId, rep] = process.argv.slice(2);
if (!file) { console.error('usage: parse-bench.mjs <run.jsonl> [arm] [taskId] [rep]'); process.exit(1); }

const m = runMetrics(file);
// Keep the answer out of the metrics line (it can be long / multi-line); the
// scorer reads it straight from the run log. Emit a short preview for eyeballing.
const { answer, ...rest } = m;
process.stdout.write(JSON.stringify({
  arm: arm ?? null,
  taskId: taskId ?? null,
  rep: rep ? Number(rep) : null,
  ...rest,
  answerPreview: answer.replace(/\s+/g, ' ').slice(0, 160),
}) + '\n');
