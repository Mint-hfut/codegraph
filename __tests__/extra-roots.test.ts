/**
 * Extra index roots — project knowledge outside the project tree
 * (src/extra-roots.ts): config parsing, virtual-path resolution security,
 * end-to-end indexing + sync, and watcher filtering of virtual paths.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CodeGraph } from '../src';
import { initGrammars, loadAllGrammars } from '../src/extraction/grammars';
import {
  parseExtraRoots,
  registerExtraRoots,
  getExtraRoots,
  resolveExtraRootPath,
  scanExtraRoot,
  virtualPathFor,
  EXTRA_ROOT_PREFIX,
} from '../src/extra-roots';
import { validatePathWithinRoot } from '../src/utils';
import { FileWatcher } from '../src/sync/watcher';

function mktmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('parseExtraRoots', () => {
  let dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    dirs = [];
  });

  it('accepts dirs and files, derives + dedupes names', () => {
    const project = mktmp('cg-xr-proj-');
    const ext1 = mktmp('cg-xr-skills-');
    const ext2 = mktmp('cg-xr-skills2-');
    dirs.push(project, ext1, ext2);
    const memFile = path.join(ext1, 'CLAUDE.md');
    fs.writeFileSync(memFile, '# memory\n');

    const roots = parseExtraRoots(
      {
        extraRoots: [
          { path: ext1, name: 'skills' },
          { path: ext2, name: 'skills' }, // duplicate name → suffixed
          memFile, // single file root
        ],
      },
      project
    );

    expect(roots.map((r) => r.name)).toEqual(['skills', 'skills-2', 'CLAUDE.md']);
    expect(roots[2]!.isFile).toBe(true);
  });

  it('rejects unsafe and useless roots', () => {
    const project = mktmp('cg-xr-proj-');
    dirs.push(project);
    fs.mkdirSync(path.join(project, 'docs'));

    const roots = parseExtraRoots(
      {
        extraRoots: [
          path.join(project, 'docs'), // inside the project → normal scan covers it
          path.dirname(project), // contains the project
          path.join(os.homedir(), '.ssh'), // credentials
          path.join(project, 'does-not-exist'),
        ],
      },
      project
    );
    expect(roots).toEqual([]);
  });
});

describe('virtual path resolution (security chokepoint)', () => {
  let dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    dirs = [];
  });

  it('resolves registered roots and rejects escapes / unregistered names', () => {
    const project = mktmp('cg-xr-proj-');
    const ext = mktmp('cg-xr-ext-');
    dirs.push(project, ext);
    fs.mkdirSync(path.join(ext, 'deploy'));
    fs.writeFileSync(path.join(ext, 'deploy/SKILL.md'), '# deploy\n');

    registerExtraRoots(project, [{ name: 'skills', absPath: ext, isFile: false }]);
    try {
      const ok = validatePathWithinRoot(project, `${EXTRA_ROOT_PREFIX}/skills/deploy/SKILL.md`);
      expect(ok && fs.realpathSync(ok)).toBe(fs.realpathSync(path.join(ext, 'deploy/SKILL.md')));

      // `../` escape out of the extra root
      expect(resolveExtraRootPath(project, `${EXTRA_ROOT_PREFIX}/skills/../../etc/passwd`)).toBeNull();
      // Unregistered root name
      expect(resolveExtraRootPath(project, `${EXTRA_ROOT_PREFIX}/nope/x.md`)).toBeNull();
      // The bare prefix / bare root aren't files
      expect(resolveExtraRootPath(project, EXTRA_ROOT_PREFIX)).toBeNull();
      expect(resolveExtraRootPath(project, `${EXTRA_ROOT_PREFIX}/skills`)).toBeNull();
    } finally {
      registerExtraRoots(project, []);
    }
  });

  it('resolves single-file roots only at their exact virtual path', () => {
    const project = mktmp('cg-xr-proj-');
    const ext = mktmp('cg-xr-ext-');
    dirs.push(project, ext);
    const memFile = path.join(ext, 'CLAUDE.md');
    fs.writeFileSync(memFile, '# memory\n');

    registerExtraRoots(project, [{ name: 'CLAUDE.md', absPath: memFile, isFile: true }]);
    try {
      expect(resolveExtraRootPath(project, `${EXTRA_ROOT_PREFIX}/CLAUDE.md`)).toBe(memFile);
      expect(resolveExtraRootPath(project, `${EXTRA_ROOT_PREFIX}/CLAUDE.md/extra`)).toBeNull();
    } finally {
      registerExtraRoots(project, []);
    }
  });
});

describe('scanExtraRoot', () => {
  it('maps files to virtual paths and skips VCS/dependency dirs', () => {
    const ext = mktmp('cg-xr-scan-');
    try {
      fs.mkdirSync(path.join(ext, 'deploy'));
      fs.mkdirSync(path.join(ext, '.git'));
      fs.mkdirSync(path.join(ext, 'node_modules/junk'), { recursive: true });
      fs.writeFileSync(path.join(ext, 'deploy/SKILL.md'), '# x\n');
      fs.writeFileSync(path.join(ext, '.git/config'), '');
      fs.writeFileSync(path.join(ext, 'node_modules/junk/index.js'), '');

      const files = scanExtraRoot({ name: 'skills', absPath: ext, isFile: false });
      expect(files).toEqual([virtualPathFor('skills', 'deploy/SKILL.md')]);
    } finally {
      fs.rmSync(ext, { recursive: true, force: true });
    }
  });
});

describe('end-to-end: extra roots in the knowledge graph', () => {
  let tmpDirs: string[] = [];

  beforeAll(async () => {
    await initGrammars();
    await loadAllGrammars();
  });

  afterEach(() => {
    for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
    tmpDirs = [];
  });

  it('indexes external skills + memory, classifies them, and syncs edits', async () => {
    const project = mktmp('cg-xr-e2e-');
    const external = mktmp('cg-xr-home-');
    tmpDirs.push(project, external);

    fs.writeFileSync(path.join(project, 'main.ts'), 'export function run() {}\n');

    // External "home" layout: a skills dir and a global memory file
    fs.mkdirSync(path.join(external, 'skills/deploy'), { recursive: true });
    fs.writeFileSync(
      path.join(external, 'skills/deploy/SKILL.md'),
      '---\nname: deploy\ndescription: Ship the app safely\n---\n# Steps\nDeploy carefully.\n'
    );
    fs.writeFileSync(path.join(external, 'CLAUDE.md'), '# Global memory\nAlways frobnicate twice.\n');

    // Config must exist before the instance is constructed
    fs.mkdirSync(path.join(project, '.codegraph'), { recursive: true });
    fs.writeFileSync(
      path.join(project, '.codegraph/config.json'),
      JSON.stringify({
        extraRoots: [
          { path: path.join(external, 'skills'), name: 'skills' },
          path.join(external, 'CLAUDE.md'),
        ],
      })
    );

    const cg = CodeGraph.initSync(project);
    try {
      expect(getExtraRoots(project).length).toBe(2);
      await cg.indexAll();

      const docs = cg.getNodesByKind('document');
      const skill = docs.find((d) => d.filePath === '~extra/skills/deploy/SKILL.md');
      expect(skill).toBeDefined();
      expect(skill!.signature).toBe('skill');
      expect(skill!.name).toBe('deploy'); // frontmatter name
      expect(skill!.docstring).toContain('Ship the app safely');

      const memory = docs.find((d) => d.filePath === '~extra/CLAUDE.md');
      expect(memory).toBeDefined();
      expect(memory!.signature).toBe('memory');

      // Searchable like any other node
      const hits = cg.searchNodes('frobnicate');
      expect(hits.some((h) => h.node.filePath === '~extra/CLAUDE.md')).toBe(true);

      // Edit the external memory file → sync picks it up
      fs.writeFileSync(
        path.join(external, 'CLAUDE.md'),
        '# Global memory\nAlways frobnicate twice.\nNever deploy on Fridays, zanzibar.\n'
      );
      const result = await cg.sync();
      expect(result.filesModified).toBe(1);
      const hits2 = cg.searchNodes('zanzibar');
      expect(hits2.some((h) => h.node.filePath === '~extra/CLAUDE.md')).toBe(true);

      // Delete the external skill → sync removes its nodes
      fs.rmSync(path.join(external, 'skills/deploy/SKILL.md'));
      const result2 = await cg.sync();
      expect(result2.filesRemoved).toBe(1);
      expect(
        cg.getNodesByKind('document').some((d) => d.filePath === '~extra/skills/deploy/SKILL.md')
      ).toBe(false);
    } finally {
      cg.close();
      registerExtraRoots(project, []);
    }
  });
});

describe('watcher accepts extra-root virtual paths', () => {
  it('records virtual-path events as pending and drops VCS noise', async () => {
    const project = mktmp('cg-xr-watch-');
    try {
      const watcher = new FileWatcher(project, async () => ({ filesChanged: 0, durationMs: 0 }), {
        inertForTests: true,
        debounceMs: 60_000, // never fires during the test
      });
      expect(watcher.start()).toBe(true);
      await watcher.waitUntilReady();

      watcher.ingestEventForTests('~extra/skills/deploy/SKILL.md');
      watcher.ingestEventForTests('~extra/skills/.git/notes.md'); // VCS noise → dropped
      watcher.ingestEventForTests('~extra/skills/deploy/photo.png'); // asset → source file now

      const pending = watcher.getPendingFiles().map((p) => p.path);
      expect(pending).toContain('~extra/skills/deploy/SKILL.md');
      expect(pending).toContain('~extra/skills/deploy/photo.png');
      expect(pending.some((p) => p.includes('.git'))).toBe(false);

      watcher.stop();
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});
