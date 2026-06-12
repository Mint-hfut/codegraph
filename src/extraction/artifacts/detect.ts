/**
 * Artifact path detection
 *
 * Filename/path predicates for the artifact extractors (markdown docs,
 * agent knowledge files, Dockerfile/compose, CI workflows, package
 * manifests). Kept as a dependency-free leaf so both `grammars.ts`
 * (indexing selection / language detection) and the artifact registry can
 * share one source of truth without import cycles.
 */

/** Semantic type of a document, stored on the document node's `signature`. */
export type DocType =
  | 'readme'
  | 'skill'
  | 'memory'
  | 'doc'
  | 'dockerfile'
  | 'compose'
  | 'workflow'
  | 'package-manifest'
  | 'asset';

function basenameOf(filePath: string): string {
  const i = filePath.lastIndexOf('/');
  return i >= 0 ? filePath.slice(i + 1) : filePath;
}

/** Markdown family: .md / .markdown / .mdx, plus Cursor rule files (.mdc). */
export function isMarkdownPath(filePath: string): boolean {
  return /\.(md|markdown|mdx|mdc)$/i.test(filePath);
}

/** Dockerfile / Containerfile — extensionless or suffixed (`Dockerfile.dev`, `app.dockerfile`). */
export function isDockerfilePath(filePath: string): boolean {
  const base = basenameOf(filePath);
  return (
    /^(Dockerfile|Containerfile)(\.[\w.-]+)?$/i.test(base) ||
    /\.dockerfile$/i.test(base)
  );
}

/** Docker Compose file: docker-compose.yml / compose.yaml (+ profile variants). */
export function isComposePath(filePath: string): boolean {
  return /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/i.test(basenameOf(filePath));
}

/** GitHub Actions workflow under .github/workflows/. */
export function isWorkflowPath(filePath: string): boolean {
  return /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i.test(filePath);
}

/** npm/yarn/pnpm package manifest. */
export function isPackageManifestPath(filePath: string): boolean {
  return basenameOf(filePath) === 'package.json';
}

/**
 * Binary asset extensions tracked by NAME ONLY — the file's content is never
 * read (no utf-8 decode, no parse, no size cap). The graph gets a
 * `file → document(signature='asset')` pair so docs/code that mention the
 * asset by path can link to it and agents can find it by name.
 */
const ASSET_EXTENSIONS = new Set([
  // Images
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'tiff', 'avif',
  // Video / audio
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'mp3', 'wav', 'ogg', 'flac', 'm4a',
  // Documents
  'pdf',
  // Fonts
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  // Archives
  'zip', 'tar', 'gz', 'tgz', '7z',
]);

/** Binary asset (image / video / audio / PDF / font / archive) — name-only indexing. */
export function isAssetPath(filePath: string): boolean {
  const base = basenameOf(filePath);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return false;
  return ASSET_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
}

/** Any path handled by an artifact extractor that ISN'T already an indexed extension. */
export function isExtraArtifactSourceFile(filePath: string): boolean {
  // Markdown / compose / workflow extensions are added to EXTENSION_MAP (or
  // already there for YAML); the extensionless / JSON / binary-asset cases
  // need this.
  return isDockerfilePath(filePath) || isPackageManifestPath(filePath) || isAssetPath(filePath);
}

/**
 * Classify a markdown file's semantic role. Agent knowledge files (project
 * memory, skills) get their own types so `kind:document` searches can be
 * narrowed by signature, and agents can ask for "skills" or "memory"
 * explicitly.
 */
export function classifyMarkdownDocType(filePath: string): DocType {
  const base = basenameOf(filePath);
  // Skills: SKILL.md convention (Claude Code / opencode), or any markdown
  // living under a tool's skills/ directory. `[~.]?` admits the `~extra`
  // virtual prefix (extra index roots) alongside dotted dirs (`.claude`).
  if (/^SKILL\.md$/i.test(base) || /(^|\/)[~.]?[\w-]+\/skills\//.test(filePath)) {
    return 'skill';
  }
  // Long-term agent memory / instruction files.
  if (
    /^(CLAUDE|AGENTS|GEMINI)(\.local)?\.md$/i.test(base) ||
    /^copilot-instructions\.md$/i.test(base) ||
    /\.mdc$/i.test(base) ||
    /(^|\/)\.claude\/memory\//.test(filePath)
  ) {
    return 'memory';
  }
  if (/^README(\.[\w-]+)?\.(md|markdown|mdx)$/i.test(base)) {
    return 'readme';
  }
  return 'doc';
}
