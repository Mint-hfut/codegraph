/**
 * GitHub Actions workflow artifact extractor
 *
 * Emits a `file` + `document` node (signature `workflow`, named after the
 * workflow's `name:`), one `section` node per job under `jobs:`, and
 * references from `run:` script invocations and local `uses: ./...` actions
 * to the project files they execute — connecting CI to the code it runs.
 */

import { Node, Edge, ExtractionResult, ExtractionError } from '../../types';
import { generateNodeId } from '../tree-sitter-helpers';
import {
  createFileNode,
  createDocumentNode,
  containsEdge,
  excerpt,
  MentionCollector,
} from './common';

/** Script-looking token inside run: lines. */
const SCRIPT_TOKEN_RE = /(?:^|[\s='"[])(\.?\/?[\w./-]+\.(?:sh|bash|py|js|mjs|cjs|ts|rb|pl|ps1))(?=$|[\s'"\],])/g;

export class WorkflowExtractor {
  private nodes: Node[] = [];
  private edges: Edge[] = [];
  private errors: ExtractionError[] = [];
  private mentions: MentionCollector;

  constructor(private filePath: string, private source: string) {
    this.mentions = new MentionCollector(filePath, 'yaml');
  }

  extract(): ExtractionResult {
    const startTime = Date.now();
    try {
      this.parse();
    } catch (error) {
      this.errors.push({
        message: `Workflow extraction error: ${error instanceof Error ? error.message : String(error)}`,
        filePath: this.filePath,
        severity: 'error',
        code: 'parse_error',
      });
    }
    return {
      nodes: this.nodes,
      edges: this.edges,
      unresolvedReferences: this.mentions.collect(),
      errors: this.errors,
      durationMs: Date.now() - startTime,
    };
  }

  private parse(): void {
    const lines = this.source.split('\n');
    const workflowName = lines
      .find((l) => /^name\s*:/.test(l))
      ?.replace(/^name\s*:\s*/, '')
      .trim()
      .replace(/^['"]|['"]$/g, '');

    const fileNode = createFileNode(this.filePath, this.source, 'yaml');
    this.nodes.push(fileNode);
    const docNode = createDocumentNode(this.filePath, this.source, 'yaml', 'workflow', {
      name: workflowName || undefined,
    });
    this.nodes.push(docNode);
    this.edges.push(containsEdge(fileNode.id, docNode.id, 1));

    let inJobs = false;
    let jobIndent = -1;
    let current: { node: Node; summary: string[] } | null = null;

    const closeCurrent = (endLine: number): void => {
      if (!current) return;
      current.node.endLine = endLine;
      current.node.docstring = excerpt(current.summary.join(' '));
      current = null;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const indent = line.length - line.trimStart().length;

      if (indent === 0) {
        closeCurrent(lineNum - 1);
        inJobs = /^jobs\s*:\s*$/.test(line.trim());
        jobIndent = -1;
        continue;
      }
      if (!inJobs) continue;

      const keyMatch = line.match(/^(\s+)([\w.-]+)\s*:\s*$/);
      if (keyMatch && (jobIndent === -1 || keyMatch[1]!.length === jobIndent)) {
        if (jobIndent === -1) jobIndent = keyMatch[1]!.length;
        if (keyMatch[1]!.length === jobIndent) {
          closeCurrent(lineNum - 1);
          const name = keyMatch[2]!;
          const node: Node = {
            id: generateNodeId(this.filePath, 'section', name, lineNum),
            kind: 'section',
            name,
            qualifiedName: `${this.filePath}#${name}`,
            filePath: this.filePath,
            language: 'yaml',
            startLine: lineNum,
            endLine: lines.length,
            startColumn: 0,
            endColumn: line.length,
            signature: `job ${name}`,
            updatedAt: Date.now(),
          };
          this.nodes.push(node);
          this.edges.push(containsEdge(docNode.id, node.id, lineNum));
          current = { node, summary: [] };
          continue;
        }
      }

      const fromNodeId = current ? current.node.id : docNode.id;
      const trimmed = line.trim();
      if (current && /^(runs-on|name)\s*:/.test(trimmed)) {
        current.summary.push(trimmed);
      }
      // Local composite actions: `uses: ./.github/actions/foo`
      const usesLocal = trimmed.match(/^(?:-\s*)?uses\s*:\s*(\.\/\S+)/);
      if (usesLocal) {
        this.mentions.addPath(fromNodeId, `${usesLocal[1]!.replace(/\/$/, '')}/action.yml`, lineNum);
      }
      // Scripts invoked from run: lines (incl. block-scalar continuation lines).
      if (/(^|-\s*)run\s*:/.test(trimmed) || current) {
        for (const m of trimmed.matchAll(SCRIPT_TOKEN_RE)) {
          this.mentions.addPath(fromNodeId, m[1]!, lineNum);
        }
      }
    }
    closeCurrent(lines.length);
  }
}
