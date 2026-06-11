/**
 * Docker Compose artifact extractor
 *
 * Emits a `file` + `document` node (signature `compose`) and one `section`
 * node per service under the top-level `services:` key, with references to
 * the Dockerfiles (`build.dockerfile`) and env files the services use.
 * Parsing is indentation-based — enough for the services tree without
 * pulling in a YAML dependency.
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

export class ComposeExtractor {
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
        message: `Compose extraction error: ${error instanceof Error ? error.message : String(error)}`,
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
    const fileNode = createFileNode(this.filePath, this.source, 'yaml');
    this.nodes.push(fileNode);
    const docNode = createDocumentNode(this.filePath, this.source, 'yaml', 'compose');
    this.nodes.push(docNode);
    this.edges.push(containsEdge(fileNode.id, docNode.id, 1));

    const lines = this.source.split('\n');
    let inServices = false;
    let serviceIndent = -1;
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
        inServices = /^services\s*:\s*$/.test(line.trim());
        serviceIndent = -1;
        continue;
      }
      if (!inServices) continue;

      const keyMatch = line.match(/^(\s+)([\w.-]+)\s*:\s*(.*)$/);
      if (keyMatch && (serviceIndent === -1 || keyMatch[1]!.length === serviceIndent) && keyMatch[3] === '') {
        // A service definition (first-level child of services:)
        if (serviceIndent === -1) serviceIndent = keyMatch[1]!.length;
        if (keyMatch[1]!.length === serviceIndent) {
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
            signature: `service ${name}`,
            updatedAt: Date.now(),
          };
          this.nodes.push(node);
          this.edges.push(containsEdge(docNode.id, node.id, lineNum));
          current = { node, summary: [] };
          continue;
        }
      }

      if (!current) continue;
      const trimmed = line.trim();
      // Capture the descriptive lines for the section excerpt.
      if (/^(image|build|command|ports?)\s*:/.test(trimmed)) {
        current.summary.push(trimmed);
      }
      // File references: explicit dockerfile + env files.
      const dockerfileRef = trimmed.match(/^dockerfile\s*:\s*(\S+)/);
      if (dockerfileRef) this.mentions.addPath(current.node.id, dockerfileRef[1]!, lineNum);
      const envRef = trimmed.match(/^env_file\s*:\s*(\S+)/) || trimmed.match(/^-\s*(\S*\.env[\w.]*)$/);
      if (envRef && envRef[1]) this.mentions.addPath(current.node.id, envRef[1], lineNum);
    }
    closeCurrent(lines.length);
  }
}
