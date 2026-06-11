/**
 * Dockerfile / Containerfile artifact extractor
 *
 * Emits a `file` + `document` node (signature `dockerfile`), one `section`
 * node per build stage (`FROM <image> [AS <name>]`), and high-confidence
 * references from COPY/ADD sources and script invocations in
 * RUN/ENTRYPOINT/CMD to the project files they touch — connecting the build
 * recipe to the code it packages.
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

/** Script-looking token inside RUN/ENTRYPOINT/CMD lines. */
const SCRIPT_TOKEN_RE = /(?:^|[\s='"[])(\.?\/?[\w./-]+\.(?:sh|bash|py|js|mjs|cjs|ts|rb|pl|ps1))(?=$|[\s'"\],])/g;

interface LogicalLine {
  text: string;
  line: number; // 1-indexed line of the instruction start
}

export class DockerfileExtractor {
  private nodes: Node[] = [];
  private edges: Edge[] = [];
  private errors: ExtractionError[] = [];
  private mentions: MentionCollector;

  constructor(private filePath: string, private source: string) {
    this.mentions = new MentionCollector(filePath, 'dockerfile');
  }

  extract(): ExtractionResult {
    const startTime = Date.now();
    try {
      this.parse();
    } catch (error) {
      this.errors.push({
        message: `Dockerfile extraction error: ${error instanceof Error ? error.message : String(error)}`,
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
    const fileNode = createFileNode(this.filePath, this.source, 'dockerfile');
    this.nodes.push(fileNode);
    const docNode = createDocumentNode(this.filePath, this.source, 'dockerfile', 'dockerfile');
    this.nodes.push(docNode);
    this.edges.push(containsEdge(fileNode.id, docNode.id, 1));

    let currentStage: Node | null = null;
    let stageIndex = 0;

    for (const logical of joinContinuations(this.source)) {
      const text = logical.text.trim();
      if (!text || text.startsWith('#')) continue;

      const instrMatch = text.match(/^([A-Za-z]+)\s+([\s\S]*)$/);
      if (!instrMatch) continue;
      const instruction = instrMatch[1]!.toUpperCase();
      const args = instrMatch[2]!.trim();
      const fromNodeId = currentStage ? currentStage.id : docNode.id;

      if (instruction === 'FROM') {
        if (currentStage) currentStage.endLine = logical.line - 1;
        const fromMatch = args.match(/^(?:--platform=\S+\s+)?(\S+)(?:\s+[Aa][Ss]\s+(\S+))?/);
        const baseImage = fromMatch?.[1] || args;
        const stageName = fromMatch?.[2] || `stage-${stageIndex}`;
        currentStage = {
          id: generateNodeId(this.filePath, 'section', stageName, logical.line),
          kind: 'section',
          name: stageName,
          qualifiedName: `${this.filePath}#${stageName}`,
          filePath: this.filePath,
          language: 'dockerfile',
          startLine: logical.line,
          endLine: this.source.split('\n').length,
          startColumn: 0,
          endColumn: 0,
          signature: `FROM ${baseImage}`,
          docstring: excerpt(`Build stage based on ${baseImage}`),
          updatedAt: Date.now(),
        };
        stageIndex++;
        this.nodes.push(currentStage);
        this.edges.push(containsEdge(docNode.id, currentStage.id, logical.line));
        continue;
      }

      if (instruction === 'COPY' || instruction === 'ADD') {
        // `COPY --from=<stage>` copies from another stage's fs, not the repo.
        if (/--from=/.test(args)) continue;
        const tokens = args.split(/\s+/).filter((t) => !t.startsWith('--'));
        // Last token is the destination; the rest are sources in the build context.
        for (const src of tokens.slice(0, -1)) {
          this.mentions.addPath(fromNodeId, src, logical.line);
        }
        continue;
      }

      if (instruction === 'RUN' || instruction === 'ENTRYPOINT' || instruction === 'CMD') {
        for (const m of args.matchAll(SCRIPT_TOKEN_RE)) {
          this.mentions.addPath(fromNodeId, m[1]!, logical.line);
        }
      }
    }
  }
}

/** Join `\`-continued physical lines into logical instructions. */
function joinContinuations(source: string): LogicalLine[] {
  const lines = source.split('\n');
  const out: LogicalLine[] = [];
  let buffer = '';
  let startLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (buffer === '') startLine = i + 1;
    if (/\\\s*$/.test(line)) {
      buffer += line.replace(/\\\s*$/, ' ');
      continue;
    }
    buffer += line;
    out.push({ text: buffer, line: startLine });
    buffer = '';
  }
  if (buffer) out.push({ text: buffer, line: startLine });
  return out;
}
