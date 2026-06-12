/**
 * Binary asset extractor — NAME-ONLY indexing.
 *
 * Images, video, audio, PDFs, fonts, and archives get a
 * `file → document(signature='asset')` pair so they're findable by name and
 * linkable from docs/code that mention them by path — but their content is
 * never read. The "source" this extractor receives is a small placeholder
 * string the indexer synthesizes from fs.stat (see ASSET_PLACEHOLDER_PREFIX):
 * it encodes size+mtime so the content-hash change detection still works
 * without ever decoding the binary.
 */

import { ExtractionResult, Node, Edge } from '../../types';
import { createFileNode, createDocumentNode, containsEdge, basenameOf } from './common';

/**
 * Placeholder "content" for binary assets: `codegraph-binary-asset:<size>:<mtime>`.
 * Synthesized by the indexer instead of reading the file; hashing it gives
 * change detection (size or mtime moved → re-extract) with zero I/O on the
 * asset bytes.
 */
export const ASSET_PLACEHOLDER_PREFIX = 'codegraph-binary-asset:';

export function assetPlaceholder(size: number, mtimeMs: number): string {
  return `${ASSET_PLACEHOLDER_PREFIX}${size}:${Math.floor(mtimeMs)}`;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export class AssetExtractor {
  constructor(private filePath: string, private source: string) {}

  extract(): ExtractionResult {
    const start = Date.now();
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    const base = basenameOf(this.filePath);
    const ext = base.slice(base.lastIndexOf('.') + 1).toLowerCase();

    let sizeNote = '';
    if (this.source.startsWith(ASSET_PLACEHOLDER_PREFIX)) {
      const size = Number(this.source.slice(ASSET_PLACEHOLDER_PREFIX.length).split(':')[0]);
      if (Number.isFinite(size)) sizeNote = `, ${humanSize(size)}`;
    }

    const fileNode = createFileNode(this.filePath, this.source, 'binary');
    nodes.push(fileNode);

    const doc = createDocumentNode(this.filePath, this.source, 'binary', 'asset', {
      docstring: `Binary asset (${ext}${sizeNote}) — content not indexed`,
    });
    nodes.push(doc);
    edges.push(containsEdge(fileNode.id, doc.id));

    return {
      nodes,
      edges,
      unresolvedReferences: [],
      errors: [],
      durationMs: Date.now() - start,
    };
  }
}
