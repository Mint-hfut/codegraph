/**
 * Extra index roots — project knowledge that lives OUTSIDE the project tree.
 *
 * Agent skills and persistent memory often sit in the user's home directory
 * (`~/.claude/skills/`, `~/.claude/CLAUDE.md`) where the project indexer
 * never looks. Extra roots let a project opt in to indexing those locations:
 *
 *   .codegraph/config.json
 *   {
 *     "extraRoots": [
 *       "~/.claude/skills",
 *       { "path": "~/.claude/CLAUDE.md", "name": "global-memory" }
 *     ]
 *   }
 *
 * Files under an extra root enter the graph under a VIRTUAL path prefix —
 * `~extra/<name>/<relative-path>` — so they can't collide with project paths
 * and are visibly "from outside" in every tool output. Resolution back to an
 * absolute path happens in ONE place ({@link resolveExtraRootPath}, called
 * from `validatePathWithinRoot`), which keeps the security chokepoint
 * property: only roots explicitly registered from the project's own config
 * are ever readable, with the same lexical + realpath containment checks the
 * project root gets.
 *
 * Change detection and real-time updates need no extra machinery: scanning
 * appends the virtual paths, the (size, mtime) + hash sync pipeline treats
 * them like any other file, and the watcher installs an additional watch per
 * root mapping events back to virtual paths.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logWarn, logDebug } from './errors';

/** First segment of every virtual extra-root path. */
export const EXTRA_ROOT_PREFIX = '~extra';

/** Cap on files indexed per extra root — a misconfigured root (e.g. `~`) must not explode the graph. */
export const MAX_FILES_PER_EXTRA_ROOT = 2000;

export interface ExtraRoot {
  /** Sanitized unique name; second virtual path segment. */
  name: string;
  /** Absolute, resolved path of the root (directory or single file). */
  absPath: string;
  /** Whether the root is a single file rather than a directory. */
  isFile: boolean;
}

/**
 * Directories whose contents are credentials/keys, never project knowledge.
 * An extra root inside one of these is rejected even though the user asked.
 */
const FORBIDDEN_HOME_SUBDIRS = ['.ssh', '.gnupg', '.aws', '.kube', '.docker'];

function isForbiddenRoot(absPath: string): string | null {
  const home = os.homedir();
  for (const dir of FORBIDDEN_HOME_SUBDIRS) {
    const p = path.join(home, dir);
    if (absPath === p || absPath.startsWith(p + path.sep)) {
      return `inside sensitive directory ${p}`;
    }
  }
  if (absPath === path.parse(absPath).root) return 'filesystem root';
  if (absPath === home) return 'entire home directory';
  return null;
}

/** Case-aware (Windows) "child is parent or under it" — mirrors utils.isWithinDir. */
function isWithin(child: string, parent: string): boolean {
  let c = child;
  let p = parent;
  if (process.platform === 'win32') {
    c = c.toLowerCase();
    p = p.toLowerCase();
  }
  return c === p || c.startsWith(p + path.sep);
}

function sanitizeName(raw: string): string {
  const cleaned = raw.replace(/[^\w.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return cleaned || 'root';
}

/** Expand a leading `~` / `~/` to the user's home directory. */
export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * Parse + validate the `extraRoots` entries from a config object. Invalid
 * entries are skipped with a warning — a bad config line must never break
 * indexing of the project itself.
 */
export function parseExtraRoots(config: unknown, projectRoot: string): ExtraRoot[] {
  if (!config || typeof config !== 'object') return [];
  const raw = (config as { extraRoots?: unknown }).extraRoots;
  if (!Array.isArray(raw)) return [];

  const roots: ExtraRoot[] = [];
  const usedNames = new Set<string>();
  const resolvedProject = path.resolve(projectRoot);

  for (const entry of raw) {
    let rawPath: string | undefined;
    let rawName: string | undefined;
    if (typeof entry === 'string') {
      rawPath = entry;
    } else if (entry && typeof entry === 'object') {
      const o = entry as { path?: unknown; name?: unknown };
      if (typeof o.path === 'string') rawPath = o.path;
      if (typeof o.name === 'string') rawName = o.name;
    }
    if (!rawPath) {
      logWarn('extraRoots entry skipped: missing path', { entry: String(entry) });
      continue;
    }

    const absPath = path.resolve(resolvedProject, expandHome(rawPath));

    const forbidden = isForbiddenRoot(absPath);
    if (forbidden) {
      logWarn('extraRoots entry skipped', { path: absPath, reason: forbidden });
      continue;
    }
    // Inside the project tree → the normal scan already covers it.
    if (isWithin(absPath, resolvedProject)) {
      logWarn('extraRoots entry skipped: already inside the project root', { path: absPath });
      continue;
    }
    // Contains the project tree → would re-index the whole project (and more).
    if (isWithin(resolvedProject, absPath)) {
      logWarn('extraRoots entry skipped: contains the project root', { path: absPath });
      continue;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(absPath);
    } catch {
      logWarn('extraRoots entry skipped: path does not exist', { path: absPath });
      continue;
    }

    let name = sanitizeName(rawName || path.basename(absPath));
    let i = 2;
    while (usedNames.has(name)) name = `${sanitizeName(rawName || path.basename(absPath))}-${i++}`;
    usedNames.add(name);

    roots.push({ name, absPath, isFile: stat.isFile() });
  }

  return roots;
}

/**
 * Load extra roots from `<codegraphDir>/config.json`. Missing file or
 * malformed JSON → empty list (with a warning for the malformed case).
 */
export function loadExtraRoots(projectRoot: string, codegraphDir: string): ExtraRoot[] {
  const configPath = path.join(codegraphDir, 'config.json');
  let text: string;
  try {
    text = fs.readFileSync(configPath, 'utf-8');
  } catch {
    return []; // no config — the common case
  }
  try {
    return parseExtraRoots(JSON.parse(text), projectRoot);
  } catch (err) {
    logWarn('Failed to parse .codegraph/config.json; extra roots disabled', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Registry: projectRoot → active extra roots.
//
// Registered once per CodeGraph instance construction (re-reading the config
// each time, so edits take effect on the next open/daemon restart). Keyed by
// resolved project root so multiple instances in one process (tests, daemon
// with several projects) can't see each other's roots.
// ---------------------------------------------------------------------------

const registry = new Map<string, ExtraRoot[]>();

function registryKey(projectRoot: string): string {
  const resolved = path.resolve(projectRoot);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function registerExtraRoots(projectRoot: string, roots: ExtraRoot[]): void {
  registry.set(registryKey(projectRoot), roots);
  if (roots.length > 0) {
    logDebug('Extra roots registered', {
      projectRoot,
      roots: roots.map((r) => `${r.name} → ${r.absPath}`),
    });
  }
}

export function getExtraRoots(projectRoot: string): ExtraRoot[] {
  return registry.get(registryKey(projectRoot)) ?? [];
}

/** Whether a (project-relative) path is a virtual extra-root path. */
export function isExtraRootVirtualPath(filePath: string): boolean {
  return filePath === EXTRA_ROOT_PREFIX || filePath.startsWith(EXTRA_ROOT_PREFIX + '/');
}

/** Build the virtual path for a file inside an extra root. */
export function virtualPathFor(rootName: string, relPath: string): string {
  return relPath ? `${EXTRA_ROOT_PREFIX}/${rootName}/${relPath}` : `${EXTRA_ROOT_PREFIX}/${rootName}`;
}

/**
 * Resolve a virtual extra-root path to an absolute path, enforcing the same
 * containment guarantees `validatePathWithinRoot` gives the project root:
 * lexical `../` rejection plus a realpath check against the registered root.
 * Returns null for unregistered roots or escaping paths.
 */
export function resolveExtraRootPath(projectRoot: string, virtualPath: string): string | null {
  if (!isExtraRootVirtualPath(virtualPath)) return null;
  const rest = virtualPath.slice(EXTRA_ROOT_PREFIX.length + 1); // "<name>/<rel>" or "<name>"
  if (!rest) return null;
  const slash = rest.indexOf('/');
  const name = slash >= 0 ? rest.slice(0, slash) : rest;
  const rel = slash >= 0 ? rest.slice(slash + 1) : '';

  const root = getExtraRoots(projectRoot).find((r) => r.name === name);
  if (!root) return null;

  // Single-file roots: the virtual path IS the root; no sub-paths exist.
  if (root.isFile) {
    return rel === '' ? root.absPath : null;
  }
  if (rel === '') return null; // directory root itself is not a file

  const resolved = path.resolve(root.absPath, rel);
  if (!isWithin(resolved, root.absPath)) return null; // `../` escape

  try {
    const realRoot = fs.realpathSync(root.absPath);
    const realResolved = fs.realpathSync(resolved);
    return isWithin(realResolved, realRoot) ? realResolved : null;
  } catch (err) {
    // ENOENT: deleted-but-still-indexed file — lexical check passed, allow.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return resolved;
    return null;
  }
}

/**
 * Enumerate indexable files for one extra root, as virtual paths. The
 * isSourceFile filter is applied by the caller (extraction layer) — this
 * walks and maps. Skips dotted VCS/dependency dirs; capped at
 * {@link MAX_FILES_PER_EXTRA_ROOT}.
 */
export function scanExtraRoot(root: ExtraRoot): string[] {
  if (root.isFile) return [virtualPathFor(root.name, '')];

  const out: string[] = [];
  const SKIP_DIRS = new Set(['.git', 'node_modules', '.codegraph', '__pycache__', '.venv', 'venv']);

  const walk = (dir: string, relPrefix: string): void => {
    if (out.length >= MAX_FILES_PER_EXTRA_ROOT) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_FILES_PER_EXTRA_ROOT) {
        logWarn('Extra root file cap reached; remaining files not indexed', {
          root: root.absPath,
          cap: MAX_FILES_PER_EXTRA_ROOT,
        });
        return;
      }
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), rel);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        out.push(virtualPathFor(root.name, rel));
      }
    }
  };

  walk(root.absPath, '');
  return out;
}
