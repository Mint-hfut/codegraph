/**
 * Artifact extraction tests
 *
 * Covers the artifact extractor framework (src/extraction/artifacts/):
 * markdown docs / agent skills / agent memory, Dockerfile, docker-compose,
 * GitHub Actions workflows, and package.json — plus the strict doc-mention
 * resolution path (high-confidence doc→code edges only).
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CodeGraph } from '../src';
import { initGrammars, loadAllGrammars, detectLanguage, isSourceFile } from '../src/extraction/grammars';
import { MarkdownExtractor } from '../src/extraction/artifacts/markdown-extractor';
import { DockerfileExtractor } from '../src/extraction/artifacts/dockerfile-extractor';
import { ComposeExtractor } from '../src/extraction/artifacts/compose-extractor';
import { WorkflowExtractor } from '../src/extraction/artifacts/workflow-extractor';
import { PackageJsonExtractor } from '../src/extraction/artifacts/package-json-extractor';
import { findArtifactExtractor } from '../src/extraction/artifacts/registry';
import { classifyMarkdownDocType, isAssetPath } from '../src/extraction/artifacts/detect';

describe('artifact path detection', () => {
  it('indexes Dockerfile, package.json, and markdown files', () => {
    expect(isSourceFile('Dockerfile')).toBe(true);
    expect(isSourceFile('docker/Dockerfile.dev')).toBe(true);
    expect(isSourceFile('app.dockerfile')).toBe(true);
    expect(isSourceFile('package.json')).toBe(true);
    expect(isSourceFile('README.md')).toBe(true);
    expect(isSourceFile('.cursor/rules/codegraph.mdc')).toBe(true);
    // Still rejects arbitrary JSON / extensionless files
    expect(isSourceFile('tsconfig.json')).toBe(false);
    expect(isSourceFile('LICENSE')).toBe(false);
  });

  it('detects artifact languages', () => {
    expect(detectLanguage('Dockerfile')).toBe('dockerfile');
    expect(detectLanguage('package.json')).toBe('json');
    expect(detectLanguage('docs/guide.md')).toBe('markdown');
    expect(detectLanguage('.github/workflows/ci.yml')).toBe('yaml');
    expect(detectLanguage('assets/logo.png')).toBe('binary');
  });

  it('detects binary asset paths (name-only indexing)', () => {
    expect(isAssetPath('assets/logo.png')).toBe(true);
    expect(isAssetPath('docs/demo.mp4')).toBe(true);
    expect(isAssetPath('manual.PDF')).toBe(true);
    expect(isAssetPath('fonts/inter.woff2')).toBe(true);
    expect(isSourceFile('assets/logo.png')).toBe(true);
    // Not assets
    expect(isAssetPath('src/index.ts')).toBe(false);
    expect(isAssetPath('.png')).toBe(false);
    expect(isAssetPath('png')).toBe(false);
  });

  it('classifies markdown doc types', () => {
    expect(classifyMarkdownDocType('README.md')).toBe('readme');
    expect(classifyMarkdownDocType('packages/core/README.md')).toBe('readme');
    expect(classifyMarkdownDocType('CLAUDE.md')).toBe('memory');
    expect(classifyMarkdownDocType('AGENTS.md')).toBe('memory');
    expect(classifyMarkdownDocType('.cursor/rules/style.mdc')).toBe('memory');
    expect(classifyMarkdownDocType('.claude/skills/deploy/SKILL.md')).toBe('skill');
    expect(classifyMarkdownDocType('docs/architecture.md')).toBe('doc');
    // Slash commands under a tool's dot-dir — but NOT a generic commands/ dir.
    expect(classifyMarkdownDocType('.claude/commands/deploy.md')).toBe('command');
    expect(classifyMarkdownDocType('.cursor/commands/review.md')).toBe('command');
    expect(classifyMarkdownDocType('~extra/dotfiles/.claude/commands/x.md')).toBe('command');
    expect(classifyMarkdownDocType('src/commands/handler.md')).toBe('doc');
  });

  it('routes each artifact to its registry entry', () => {
    expect(findArtifactExtractor('README.md')?.name).toBe('markdown');
    expect(findArtifactExtractor('Dockerfile')?.name).toBe('dockerfile');
    expect(findArtifactExtractor('docker-compose.yml')?.name).toBe('compose');
    expect(findArtifactExtractor('compose.prod.yaml')?.name).toBe('compose');
    expect(findArtifactExtractor('.github/workflows/ci.yml')?.name).toBe('workflow');
    expect(findArtifactExtractor('package.json')?.name).toBe('package-manifest');
    expect(findArtifactExtractor('src/index.ts')).toBeNull();
    expect(findArtifactExtractor('config.yml')).toBeNull();
  });
});

describe('MarkdownExtractor', () => {
  it('builds a document + nested section tree from headings', () => {
    const source = [
      'Intro paragraph about the project.',
      '',
      '# Getting Started',
      'Install it first.',
      '## Install',
      'Run the installer.',
      '## Configure',
      'Edit the config.',
      '# Architecture',
      'Layered design.',
    ].join('\n');
    const result = new MarkdownExtractor('README.md', source).extract();

    const doc = result.nodes.find((n) => n.kind === 'document');
    expect(doc).toBeDefined();
    expect(doc!.signature).toBe('readme');
    expect(doc!.docstring).toContain('Intro paragraph');

    const sections = result.nodes.filter((n) => n.kind === 'section');
    expect(sections.map((s) => s.name)).toEqual([
      'Getting Started', 'Install', 'Configure', 'Architecture',
    ]);

    // Nesting: doc contains h1s; "Getting Started" contains its h2s.
    const gettingStarted = sections.find((s) => s.name === 'Getting Started')!;
    const install = sections.find((s) => s.name === 'Install')!;
    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: doc!.id, target: gettingStarted.id, kind: 'contains' })
    );
    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: gettingStarted.id, target: install.id, kind: 'contains' })
    );

    // Section spans: "Install" ends where "Configure" starts.
    expect(install.startLine).toBe(5);
    expect(install.endLine).toBe(6);
    expect(install.docstring).toContain('Run the installer');
  });

  it('reads SKILL.md frontmatter into the document node', () => {
    const source = [
      '---',
      'name: deploy-app',
      'description: Deploy the app to production safely.',
      '---',
      '',
      '# Steps',
      'Run the deploy script.',
    ].join('\n');
    const result = new MarkdownExtractor('.claude/skills/deploy/SKILL.md', source).extract();
    const doc = result.nodes.find((n) => n.kind === 'document')!;
    expect(doc.signature).toBe('skill');
    expect(doc.name).toBe('deploy-app');
    expect(doc.docstring).toContain('Deploy the app to production');
  });

  it('folds a skill trigger condition + allowed-tools into the searchable docstring', () => {
    const source = [
      '---',
      'name: releaser',
      'description: Cut a release and publish to npm. Use when the user asks to ship a version or run a release.',
      'allowed-tools:',
      '  - Bash',
      '  - Edit',
      'model: opus',
      '---',
      '',
      '# Steps',
    ].join('\n');
    const doc = new MarkdownExtractor('.claude/skills/release/SKILL.md', source)
      .extract()
      .nodes.find((n) => n.kind === 'document')!;
    expect(doc.signature).toBe('skill');
    // What-it-does kept; trigger split out and labeled; tools/model folded in.
    expect(doc.docstring).toContain('Cut a release and publish to npm');
    expect(doc.docstring).toContain('Trigger: Use when the user asks to ship');
    expect(doc.docstring).toContain('Tools: Bash, Edit');
    expect(doc.docstring).toContain('Model: opus');
  });

  it('extracts slash-command frontmatter (argument-hint, allowed-tools) for a command file', () => {
    const source = [
      '---',
      'description: Open a pull request for the current branch.',
      'argument-hint: [base-branch]',
      'allowed-tools: [Bash, Read]',
      '---',
      '',
      'Open a PR.',
    ].join('\n');
    const doc = new MarkdownExtractor('.claude/commands/open-pr.md', source)
      .extract()
      .nodes.find((n) => n.kind === 'document')!;
    expect(doc.signature).toBe('command');
    expect(doc.docstring).toContain('Open a pull request');
    expect(doc.docstring).toContain('Arguments: base-branch');
    expect(doc.docstring).toContain('Tools: Bash, Read');
  });

  it('leaves a plain doc description unchanged (no skill/command folding)', () => {
    const source = ['---', 'description: Architecture overview.', '---', '', '# Intro'].join('\n');
    const doc = new MarkdownExtractor('docs/architecture.md', source)
      .extract()
      .nodes.find((n) => n.kind === 'document')!;
    expect(doc.signature).toBe('doc');
    expect(doc.docstring).toBe('Architecture overview.');
  });

  it('emits high-confidence mentions and skips noise', () => {
    const source = [
      '# Usage',
      'Call `loginUser()` from [the auth module](src/auth.ts).',
      'Set `true` or use `npm` — these are noise.',
      'The `AuthService.login` method handles it; config in `package.json`.',
      '```ts',
      'const x = `fakeMention()`; // inside a fence, headings here are ignored',
      '# not a heading',
      '```',
    ].join('\n');
    const result = new MarkdownExtractor('docs/usage.md', source).extract();

    const names = result.unresolvedReferences.map((r) => r.referenceName);
    expect(names).toContain('loginUser');
    expect(names).toContain('src/auth.ts');
    expect(names).toContain('AuthService.login');
    expect(names).toContain('package.json');
    expect(names).not.toContain('true');
    expect(names).not.toContain('npm');
    expect(names).not.toContain('fakeMention');

    // Fenced "# not a heading" produced no section
    expect(result.nodes.filter((n) => n.kind === 'section').map((n) => n.name)).toEqual(['Usage']);
  });
});

describe('DockerfileExtractor', () => {
  it('extracts stages, COPY sources, and script invocations', () => {
    const source = [
      'FROM node:22-bookworm AS builder',
      'COPY package.json package-lock.json ./',
      'COPY src/ ./src/',
      'RUN ./scripts/build.sh \\',
      '    --production',
      '',
      'FROM node:22-slim',
      'COPY --from=builder /app/dist ./dist',
      'CMD ["node", "dist/index.js"]',
    ].join('\n');
    const result = new DockerfileExtractor('Dockerfile', source).extract();

    const doc = result.nodes.find((n) => n.kind === 'document')!;
    expect(doc.signature).toBe('dockerfile');

    const stages = result.nodes.filter((n) => n.kind === 'section');
    expect(stages.map((s) => s.name)).toEqual(['builder', 'stage-1']);
    expect(stages[0]!.signature).toBe('FROM node:22-bookworm');
    expect(stages[0]!.endLine).toBe(6);

    const names = result.unresolvedReferences.map((r) => r.referenceName);
    expect(names).toContain('package.json');
    expect(names).toContain('package-lock.json');
    expect(names).toContain('scripts/build.sh'); // continuation joined, ./ stripped
    expect(names).toContain('dist/index.js');
    // --from copy is another stage's fs, not the repo; `src/` is a directory
    expect(names).not.toContain('/app/dist');
    expect(names.some((n) => n.includes('src/') && !n.includes('.'))).toBe(false);
  });
});

describe('ComposeExtractor', () => {
  it('extracts services and their file references', () => {
    const source = [
      'services:',
      '  web:',
      '    build:',
      '      context: .',
      '      dockerfile: docker/Dockerfile.web',
      '    ports:',
      '      - "3000:3000"',
      '  db:',
      '    image: postgres:16',
      'volumes:',
      '  pgdata:',
    ].join('\n');
    const result = new ComposeExtractor('docker-compose.yml', source).extract();

    const doc = result.nodes.find((n) => n.kind === 'document')!;
    expect(doc.signature).toBe('compose');

    const services = result.nodes.filter((n) => n.kind === 'section');
    expect(services.map((s) => s.name)).toEqual(['web', 'db']);
    expect(services[1]!.docstring).toContain('postgres:16');
    // `volumes:` top-level key ended the services block — pgdata is not a service
    expect(services.map((s) => s.name)).not.toContain('pgdata');

    const names = result.unresolvedReferences.map((r) => r.referenceName);
    expect(names).toContain('docker/Dockerfile.web');
  });
});

describe('WorkflowExtractor', () => {
  it('extracts jobs and script references', () => {
    const source = [
      'name: CI',
      'on: [push]',
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - uses: ./.github/actions/setup',
      '      - run: ./scripts/test.sh',
      '  release:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: node scripts/prepare-release.mjs',
    ].join('\n');
    const result = new WorkflowExtractor('.github/workflows/ci.yml', source).extract();

    const doc = result.nodes.find((n) => n.kind === 'document')!;
    expect(doc.signature).toBe('workflow');
    expect(doc.name).toBe('CI');

    const jobs = result.nodes.filter((n) => n.kind === 'section');
    expect(jobs.map((j) => j.name)).toEqual(['test', 'release']);

    const names = result.unresolvedReferences.map((r) => r.referenceName);
    expect(names).toContain('scripts/test.sh');
    expect(names).toContain('scripts/prepare-release.mjs');
    expect(names).toContain('.github/actions/setup/action.yml');
  });
});

describe('PackageJsonExtractor', () => {
  it('extracts package identity, scripts, and entry-point references', () => {
    const source = JSON.stringify(
      {
        name: 'my-lib',
        description: 'A test library',
        main: 'dist/index.js',
        bin: { mycli: 'dist/bin/cli.js' },
        scripts: {
          build: 'tsc',
          eval: 'tsx scripts/runner.ts --all',
        },
      },
      null,
      2
    );
    const result = new PackageJsonExtractor('package.json', source).extract();

    const doc = result.nodes.find((n) => n.kind === 'document')!;
    expect(doc.signature).toBe('package-manifest');
    expect(doc.name).toBe('my-lib');
    expect(doc.docstring).toContain('A test library');

    const scripts = result.nodes.filter((n) => n.kind === 'section');
    expect(scripts.map((s) => s.name).sort()).toEqual(['build', 'eval']);
    const evalScript = scripts.find((s) => s.name === 'eval')!;
    expect(evalScript.signature).toBe('tsx scripts/runner.ts --all');
    expect(evalScript.qualifiedName).toBe('package.json#scripts.eval');
    // Line number points at the actual script line in the raw text
    expect(source.split('\n')[evalScript.startLine - 1]).toContain('"eval"');

    const names = result.unresolvedReferences.map((r) => r.referenceName);
    expect(names).toContain('dist/index.js');
    expect(names).toContain('dist/bin/cli.js');
    expect(names).toContain('scripts/runner.ts');
  });

  it('reports malformed JSON as a warning, not a crash', () => {
    const result = new PackageJsonExtractor('package.json', '{ not json').extract();
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]!.severity).toBe('warning');
    expect(result.nodes).toEqual([]);
  });
});

describe('end-to-end: artifacts in the knowledge graph', () => {
  let tmpDir: string | undefined;

  beforeAll(async () => {
    await initGrammars();
    await loadAllGrammars();
  });

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('indexes docs/skills/memory/Dockerfile and links high-confidence mentions only', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-artifacts-'));
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.mkdirSync(path.join(tmpDir, '.claude/skills/release'), { recursive: true });

    // Code: loginUser is unique; helper is ambiguous (two definitions).
    fs.writeFileSync(
      path.join(tmpDir, 'src/auth.ts'),
      'export function loginUser(name: string) { return name; }\n' +
        'export function helper() { return 1; }\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'src/util.ts'),
      'export function helper() { return 2; }\n'
    );

    fs.writeFileSync(
      path.join(tmpDir, 'README.md'),
      '# My App\n' +
        'Auth lives in [the auth module](src/auth.ts).\n' +
        '## Auth\n' +
        'Call `loginUser` to sign in. The `helper` util is ambiguous.\n'
    );
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# Project memory\nAlways run tests.\n');
    fs.writeFileSync(
      path.join(tmpDir, '.claude/skills/release/SKILL.md'),
      '---\nname: release\ndescription: Cut a release\n---\n# Steps\nBump and tag.\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'Dockerfile'),
      'FROM node:22 AS base\nCOPY package.json ./\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'e2e-app', scripts: { start: 'node src/auth.ts' } }, null, 2)
    );

    const cg = CodeGraph.initSync(tmpDir);
    await cg.indexAll();

    // Documents indexed with their semantic types
    const docs = cg.getNodesByKind('document');
    const bySig = (sig: string) => docs.filter((d) => d.signature === sig);
    expect(bySig('readme').length).toBe(1);
    expect(bySig('memory').length).toBe(1);
    expect(bySig('skill').length).toBe(1);
    expect(bySig('dockerfile').length).toBe(1);
    expect(bySig('package-manifest').length).toBe(1);

    // Skill carries its frontmatter identity
    const skill = bySig('skill')[0]!;
    expect(skill.name).toBe('release');
    expect(skill.docstring).toContain('Cut a release');

    // Sections exist (README headings + npm script + docker stage)
    const sections = cg.getNodesByKind('section');
    const authSection = sections.find((s) => s.name === 'Auth' && s.filePath === 'README.md');
    expect(authSection).toBeDefined();
    expect(sections.some((s) => s.name === 'start' && s.filePath === 'package.json')).toBe(true);
    expect(sections.some((s) => s.name === 'base' && s.filePath === 'Dockerfile')).toBe(true);

    // High-confidence doc→code edges
    const authEdges = cg.getOutgoingEdges(authSection!.id);
    const fns = cg.getNodesByKind('function');
    const loginUser = fns.find((n) => n.name === 'loginUser')!;
    const loginEdge = authEdges.find((e) => e.target === loginUser.id);
    expect(loginEdge).toBeDefined();
    expect(loginEdge!.kind).toBe('references');
    expect(loginEdge!.metadata?.resolvedBy).toBe('doc-mention');

    // Ambiguous mention (`helper` defined twice) is NOT linked
    const helperIds = new Set(fns.filter((n) => n.name === 'helper').map((n) => n.id));
    expect(helperIds.size).toBe(2);
    expect(authEdges.some((e) => helperIds.has(e.target))).toBe(false);

    // Path link README → src/auth.ts file node (the mention hangs off
    // whichever README section contains it)
    const readmeNodes = [...docs, ...sections].filter((n) => n.filePath === 'README.md');
    const fileTargets = readmeNodes
      .flatMap((n) => cg.getOutgoingEdges(n.id))
      .filter((e) => e.kind === 'references')
      .map((e) => cg.getNode(e.target)?.filePath);
    expect(fileTargets).toContain('src/auth.ts');

    // Dockerfile stage → package.json file node
    const stage = sections.find((s) => s.name === 'base')!;
    const stageTargets = cg
      .getOutgoingEdges(stage.id)
      .filter((e) => e.kind === 'references')
      .map((e) => cg.getNode(e.target)?.filePath);
    expect(stageTargets).toContain('package.json');

    cg.close();
  });

  it('indexes binary assets by name only and links doc mentions to them', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-assets-'));
    fs.mkdirSync(path.join(tmpDir, 'assets'));

    // Invalid-UTF8 bytes — proves nothing chokes on binary content
    fs.writeFileSync(
      path.join(tmpDir, 'assets/logo.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x01])
    );
    fs.writeFileSync(
      path.join(tmpDir, 'README.md'),
      '# App\nThe logo lives at ![logo](assets/logo.png).\n'
    );

    const cg = CodeGraph.initSync(tmpDir);
    await cg.indexAll();

    // Asset document node: right type, name, no content indexed
    const assetDoc = cg
      .getNodesByKind('document')
      .find((d) => d.filePath === 'assets/logo.png');
    expect(assetDoc).toBeDefined();
    expect(assetDoc!.signature).toBe('asset');
    expect(assetDoc!.name).toBe('logo.png');
    expect(assetDoc!.language).toBe('binary');
    expect(assetDoc!.docstring).toContain('content not indexed');

    // README's image link resolves to the asset's file node
    const readmeNodes = [...cg.getNodesByKind('document'), ...cg.getNodesByKind('section')]
      .filter((n) => n.filePath === 'README.md');
    const targets = readmeNodes
      .flatMap((n) => cg.getOutgoingEdges(n.id))
      .filter((e) => e.kind === 'references')
      .map((e) => cg.getNode(e.target)?.filePath);
    expect(targets).toContain('assets/logo.png');

    cg.close();
  });

  it('links a SKILL.md to its whole bundle (skill-bundle edges)', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-bundle-'));
    fs.mkdirSync(path.join(tmpDir, '.claude/skills/release/scripts'), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, '.claude/skills/release/SKILL.md'),
      '---\nname: release\ndescription: Cut a release\n---\n# Steps\nRun the helper.\n'
    );
    // Bundle members the SKILL.md never mentions explicitly
    fs.writeFileSync(path.join(tmpDir, '.claude/skills/release/reference.md'), '# Versioning rules\n');
    fs.writeFileSync(path.join(tmpDir, '.claude/skills/release/scripts/bump.py'), 'def bump():\n    pass\n');
    // A file OUTSIDE the bundle must not be linked
    fs.writeFileSync(path.join(tmpDir, 'unrelated.md'), '# Unrelated\n');

    const cg = CodeGraph.initSync(tmpDir);
    await cg.indexAll();

    const skillDoc = cg
      .getNodesByKind('document')
      .find((d) => d.filePath === '.claude/skills/release/SKILL.md')!;
    expect(skillDoc).toBeDefined();

    const bundleEdges = cg
      .getOutgoingEdges(skillDoc.id)
      .filter((e) => e.kind === 'references' && e.metadata?.synthesizedBy === 'skill-bundle');
    const bundleTargets = bundleEdges.map((e) => cg.getNode(e.target)?.filePath);

    expect(bundleTargets).toContain('.claude/skills/release/reference.md');
    expect(bundleTargets).toContain('.claude/skills/release/scripts/bump.py');
    expect(bundleTargets).not.toContain('unrelated.md');

    // Idempotent across re-resolution: a sync must not duplicate the edges
    await cg.sync();
    const after = cg
      .getOutgoingEdges(skillDoc.id)
      .filter((e) => e.kind === 'references' && e.metadata?.synthesizedBy === 'skill-bundle');
    expect(after.length).toBe(bundleEdges.length);

    cg.close();
  });

  it('ranks memory documents above ordinary docs for the same match', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rank-'));
    fs.mkdirSync(path.join(tmpDir, 'docs'));

    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# Memory\nAlways gribblefy before merging.\n');
    fs.writeFileSync(path.join(tmpDir, 'docs/notes.md'), '# Notes\nAlways gribblefy before merging.\n');

    const cg = CodeGraph.initSync(tmpDir);
    await cg.indexAll();

    const results = cg
      .searchNodes('gribblefy')
      .filter((r) => r.node.kind === 'document' || r.node.kind === 'section');
    const memoryIdx = results.findIndex((r) => r.node.filePath === 'CLAUDE.md');
    const docIdx = results.findIndex((r) => r.node.filePath === 'docs/notes.md');
    expect(memoryIdx).toBeGreaterThanOrEqual(0);
    expect(docIdx).toBeGreaterThanOrEqual(0);
    expect(memoryIdx).toBeLessThan(docIdx);

    cg.close();
  });
});
