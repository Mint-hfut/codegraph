/**
 * package.json artifact extractor
 *
 * Emits a `file` + `document` node (signature `package-manifest`, named
 * after the package's `name` field) and one `section` node per npm script,
 * with references from script commands and entry-point fields
 * (main/module/types/bin) to the project files they point at.
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

/** File-looking token inside a script command. */
const SCRIPT_FILE_RE = /(?:^|[\s='"])(\.?\/?[\w./-]+\.(?:m?[jt]s|c[jt]s|sh|bash|py|sql|json|ya?ml))(?=$|[\s'"])/g;

export class PackageJsonExtractor {
  private nodes: Node[] = [];
  private edges: Edge[] = [];
  private errors: ExtractionError[] = [];
  private mentions: MentionCollector;

  constructor(private filePath: string, private source: string) {
    this.mentions = new MentionCollector(filePath, 'json');
  }

  extract(): ExtractionResult {
    const startTime = Date.now();
    try {
      this.parse();
    } catch (error) {
      this.errors.push({
        message: `package.json extraction error: ${error instanceof Error ? error.message : String(error)}`,
        filePath: this.filePath,
        severity: 'warning',
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
    const pkg = JSON.parse(this.source) as Record<string, unknown>;

    const fileNode = createFileNode(this.filePath, this.source, 'json');
    this.nodes.push(fileNode);
    const docNode = createDocumentNode(this.filePath, this.source, 'json', 'package-manifest', {
      name: typeof pkg.name === 'string' ? pkg.name : undefined,
      docstring: typeof pkg.description === 'string' ? pkg.description : undefined,
    });
    this.nodes.push(docNode);
    this.edges.push(containsEdge(fileNode.id, docNode.id, 1));

    // Entry-point fields → file references.
    for (const field of ['main', 'module', 'types', 'browser'] as const) {
      const value = pkg[field];
      if (typeof value === 'string') this.mentions.addPath(docNode.id, value, 1);
    }
    const bin = pkg.bin;
    if (typeof bin === 'string') {
      this.mentions.addPath(docNode.id, bin, 1);
    } else if (bin && typeof bin === 'object') {
      for (const value of Object.values(bin as Record<string, unknown>)) {
        if (typeof value === 'string') this.mentions.addPath(docNode.id, value, 1);
      }
    }

    // Scripts → one section per script, with line numbers from the raw text.
    const scripts = pkg.scripts;
    if (!scripts || typeof scripts !== 'object') return;
    const lines = this.source.split('\n');
    const scriptsLineIdx = lines.findIndex((l) => /^\s*"scripts"\s*:/.test(l));

    for (const [name, command] of Object.entries(scripts as Record<string, unknown>)) {
      if (typeof command !== 'string') continue;
      // Find the script's own line (first match after the "scripts" key).
      let lineNum = scriptsLineIdx >= 0 ? scriptsLineIdx + 1 : 1;
      if (scriptsLineIdx >= 0) {
        const keyRe = new RegExp(`^\\s*"${escapeRegExp(name)}"\\s*:`);
        for (let i = scriptsLineIdx + 1; i < lines.length; i++) {
          if (keyRe.test(lines[i]!)) {
            lineNum = i + 1;
            break;
          }
        }
      }

      const node: Node = {
        id: generateNodeId(this.filePath, 'section', name, lineNum),
        kind: 'section',
        name,
        qualifiedName: `${this.filePath}#scripts.${name}`,
        filePath: this.filePath,
        language: 'json',
        startLine: lineNum,
        endLine: lineNum,
        startColumn: 0,
        endColumn: lines[lineNum - 1]?.length || 0,
        signature: command.length > 200 ? command.slice(0, 200) : command,
        docstring: excerpt(`npm script: ${command}`),
        updatedAt: Date.now(),
      };
      this.nodes.push(node);
      this.edges.push(containsEdge(docNode.id, node.id, lineNum));

      for (const m of command.matchAll(SCRIPT_FILE_RE)) {
        this.mentions.addPath(node.id, m[1]!, lineNum);
      }
    }
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
