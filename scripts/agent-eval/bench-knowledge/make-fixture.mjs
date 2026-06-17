#!/usr/bin/env node
// Generate a tiny synthetic corpus that exercises every knowledge-graph feature
// the benchmark probes: an agent skill (+ bundle siblings), a slash command with
// frontmatter, an agent-memory file vs an ordinary doc sharing a rare term, a
// binary asset, and a README that mentions the asset + a code symbol.
//
// Generated (not committed) so the binary asset's bytes stay reproducible and
// the dir is rebuilt clean each run. Usage: make-fixture.mjs <dir>

import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';

const root = process.argv[2];
if (!root) { console.error('usage: make-fixture.mjs <dir>'); process.exit(1); }

rmSync(root, { recursive: true, force: true });

function put(rel, content) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

// Agent memory — shares the rare term "gribblefy" with the ordinary doc below,
// so the memory-ranking probe can assert memory outranks the plain doc.
put('CLAUDE.md', `# Project memory

This project uses the gribblefy convention for every internal batch job.
Always run the gribblefy validator before committing.
`);

// Ordinary doc — same rare term, lower-priority doc type.
put('docs/architecture.md', `# Architecture

The gribblefy pipeline is documented here for contributors.
`);

// Agent skill with frontmatter: name + description (incl. a "Use when…" trigger)
// + allowed-tools + model. The deployer dir is a bundle (SKILL.md + siblings).
put('.claude/skills/deployer/SKILL.md', `---
name: deployer
description: Deploy the service and roll back safely on failure. Use when the user asks to ship a release, cut a deploy, or assess blast radius rollout impact.
allowed-tools:
  - Bash
  - Read
model: opus
---

# Deployer

Steps to deploy the service.
`);
put('.claude/skills/deployer/scripts/deploy.py', `def deploy(target):
    """Deploy to the given target."""
    return f"deploying {target}"
`);
put('.claude/skills/deployer/reference.md', `# Rollback reference

How the rollback procedure works.
`);

// Slash command with frontmatter: description + argument-hint + allowed-tools.
put('.claude/commands/changelog.md', `---
description: Generate a changelog entry for a release version.
argument-hint: [version]
allowed-tools: [Read, Edit]
---

Generate the changelog entry for the given version.
`);

// A code file mentioned by the README (doc -> code edge).
put('src/app.ts', `export function startApp(): number {
  return 42;
}
`);

// Binary asset: real PNG signature + a few non-text bytes. Content must never be
// read; only the name enters the graph.
const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
]);
put('assets/diagram.png', png);

// README mentions the asset (doc -> asset edge) and a code symbol/file.
put('README.md', `# Demo

![architecture diagram](assets/diagram.png)

The entrypoint lives in \`src/app.ts\` and is called \`startApp\`.
`);

console.log(`fixture written -> ${root}`);
