/**
 * Shared building blocks for artifact extractors.
 *
 * Every artifact extractor emits the same node shape:
 *
 *   file (file:<path>) ── contains ──> document ── contains ──> section*
 *
 * The `file` node keeps the artifact on the same plumbing every code file
 * uses (path resolution via matchByFilePath, file-dependency queries); the
 * `document` node carries the semantic type (signature = DocType) and the
 * sections form the content tree.
 *
 * Cross-references to code are emitted as UnresolvedReference and resolved
 * by the dedicated strict doc-mention path in the ReferenceResolver — a
 * wrong doc→code edge misleads agents, so only high-confidence mentions
 * (explicit paths, unique symbol names) ever become edges.
 */

import { Node, Edge, Language, UnresolvedReference } from '../../types';
import { generateNodeId } from '../tree-sitter-helpers';
import { DocType } from './detect';

/** Max length of the body excerpt stored on a section's docstring (FTS-indexed). */
const EXCERPT_MAX_CHARS = 400;

/** Cap on emitted doc→code references per section, so a link-dense page can't flood the resolver. */
export const MAX_REFS_PER_SECTION = 30;

export function basenameOf(filePath: string): string {
  const i = filePath.lastIndexOf('/');
  return i >= 0 ? filePath.slice(i + 1) : filePath;
}

/** Standard file node — same ID scheme as TreeSitterExtractor (`file:<path>`). */
export function createFileNode(filePath: string, source: string, language: Language): Node {
  const lines = source.split('\n');
  return {
    id: `file:${filePath}`,
    kind: 'file',
    name: basenameOf(filePath),
    qualifiedName: filePath,
    filePath,
    language,
    startLine: 1,
    endLine: lines.length,
    startColumn: 0,
    endColumn: lines[lines.length - 1]?.length || 0,
    updatedAt: Date.now(),
  };
}

/** Document node spanning the whole file; `signature` carries the DocType. */
export function createDocumentNode(
  filePath: string,
  source: string,
  language: Language,
  docType: DocType,
  options?: { name?: string; docstring?: string }
): Node {
  const lines = source.split('\n');
  return {
    id: generateNodeId(filePath, 'document', filePath, 1),
    kind: 'document',
    name: options?.name || basenameOf(filePath),
    qualifiedName: filePath,
    filePath,
    language,
    startLine: 1,
    endLine: lines.length,
    startColumn: 0,
    endColumn: lines[lines.length - 1]?.length || 0,
    signature: docType,
    docstring: options?.docstring ? excerpt(options.docstring) : undefined,
    updatedAt: Date.now(),
  };
}

export function containsEdge(sourceId: string, targetId: string, line?: number): Edge {
  return { source: sourceId, target: targetId, kind: 'contains', line };
}

/** First EXCERPT_MAX_CHARS of `text`, whitespace-collapsed — section docstrings feed FTS. */
export function excerpt(text: string): string | undefined {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) return undefined;
  return collapsed.length > EXCERPT_MAX_CHARS
    ? collapsed.slice(0, EXCERPT_MAX_CHARS) + '…'
    : collapsed;
}

/**
 * Words that look like identifiers in prose but are near-never a useful link
 * target — keeps the resolver from chewing on `true`, `npm`, `git`, …
 * (The strict unique-match rule at resolution is the real gate; this only
 * trims obvious noise.)
 */
const MENTION_STOPWORDS = new Set([
  'true', 'false', 'null', 'undefined', 'none', 'nil', 'this', 'self',
  'npm', 'npx', 'yarn', 'pnpm', 'node', 'git', 'cd', 'ls', 'docker', 'bash',
  'sh', 'curl', 'make', 'pip', 'python', 'cargo', 'go', 'string', 'number',
  'boolean', 'int', 'float', 'void', 'name', 'value', 'type', 'data', 'id',
]);

/** Path-shaped token: has a directory separator or a short file extension. */
export function looksLikePath(token: string): boolean {
  if (/^[a-z][\w+.-]*:\/\//i.test(token) || token.startsWith('mailto:')) return false;
  if (token.includes('*') || token.includes(' ')) return false;
  if (token.includes('/')) {
    // Directory-ish (`src/`) can't resolve to a file node — require a filename.
    const base = basenameOf(token);
    return /^[\w.@-]+\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(base);
  }
  return /^[\w.@-]+\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(token) && token.includes('.');
}

/** Normalize a path mention: strip `./` prefix, trailing anchors/queries. */
export function normalizePathMention(token: string): string {
  let t = token.replace(/[#?].*$/, '');
  while (t.startsWith('./')) t = t.slice(2);
  return t;
}

/**
 * Symbol-shaped token: bare identifier or `Receiver.member`, optional
 * trailing `()`. Returns the cleaned name or null.
 */
export function asSymbolMention(token: string): string | null {
  const m = token.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)(\(\))?$/);
  if (!m) return null;
  const name = m[1]!;
  if (name.length < 3) return null;
  if (MENTION_STOPWORDS.has(name.toLowerCase())) return null;
  return name;
}

/**
 * Collector that dedupes references per file and enforces the per-section cap.
 */
export class MentionCollector {
  private refs: UnresolvedReference[] = [];
  private seen = new Set<string>();
  private perSection = new Map<string, number>();

  constructor(private filePath: string, private language: Language) {}

  addPath(fromNodeId: string, rawToken: string, line: number): void {
    const token = normalizePathMention(rawToken);
    if (!token || !looksLikePath(token)) return;
    this.push(fromNodeId, token, line);
  }

  addSymbol(fromNodeId: string, rawToken: string, line: number): void {
    const name = asSymbolMention(rawToken.trim());
    if (!name) return;
    this.push(fromNodeId, name, line);
  }

  /** Path if it looks like one, otherwise symbol — for inline-code spans. */
  addAuto(fromNodeId: string, rawToken: string, line: number): void {
    const token = rawToken.trim();
    if (looksLikePath(normalizePathMention(token))) {
      this.addPath(fromNodeId, token, line);
    } else {
      this.addSymbol(fromNodeId, token, line);
    }
  }

  private push(fromNodeId: string, referenceName: string, line: number): void {
    const key = `${fromNodeId}\0${referenceName}`;
    if (this.seen.has(key)) return;
    const count = this.perSection.get(fromNodeId) || 0;
    if (count >= MAX_REFS_PER_SECTION) return;
    this.seen.add(key);
    this.perSection.set(fromNodeId, count + 1);
    this.refs.push({
      fromNodeId,
      referenceName,
      referenceKind: 'references',
      line,
      column: 0,
      filePath: this.filePath,
      language: this.language,
    });
  }

  collect(): UnresolvedReference[] {
    return this.refs;
  }
}
