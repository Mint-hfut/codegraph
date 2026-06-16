/**
 * Markdown artifact extractor
 *
 * Handles README/docs, agent skills (SKILL.md), and agent memory files
 * (CLAUDE.md / AGENTS.md / .mdc rules). Emits:
 *
 *   - a `file` node + a `document` node (signature = readme/skill/memory/doc)
 *   - a `section` node per ATX heading, nested by heading level via `contains`
 *   - high-confidence doc→code mentions as UnresolvedReference:
 *       · markdown link targets that are relative file paths
 *       · inline-code spans that are file paths or identifier-shaped symbols
 *
 * YAML frontmatter `name:`/`description:` (the SKILL.md convention) feed the
 * document node's name/docstring so skills are searchable by what they do. For
 * skills and slash commands the rest of the frontmatter — the trigger clause
 * split out of the description, plus `allowed-tools`/`argument-hint`/`model` —
 * is folded into the searchable docstring with explicit labels, so an agent
 * file carries its structure, not just a markdown blurb.
 */

import { Node, ExtractionResult, ExtractionError, Edge, UnresolvedReference } from '../../types';
import { generateNodeId } from '../tree-sitter-helpers';
import { classifyMarkdownDocType, DocType } from './detect';
import {
  createFileNode,
  createDocumentNode,
  containsEdge,
  excerpt,
  MentionCollector,
} from './common';

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^(```|~~~)/;
const LINK_RE = /\[[^\]]*\]\(([^()\s]+)\)/g;
const INLINE_CODE_RE = /`([^`\n]+)`/g;

interface OpenSection {
  node: Node;
  level: number;
  bodyLines: string[];
}

export class MarkdownExtractor {
  private nodes: Node[] = [];
  private edges: Edge[] = [];
  private errors: ExtractionError[] = [];
  private mentions: MentionCollector;

  constructor(private filePath: string, private source: string) {
    this.mentions = new MentionCollector(filePath, 'markdown');
  }

  extract(): ExtractionResult {
    const startTime = Date.now();
    let unresolvedReferences: UnresolvedReference[] = [];

    try {
      unresolvedReferences = this.parse();
    } catch (error) {
      this.errors.push({
        message: `Markdown extraction error: ${error instanceof Error ? error.message : String(error)}`,
        filePath: this.filePath,
        severity: 'error',
        code: 'parse_error',
      });
    }

    return {
      nodes: this.nodes,
      edges: this.edges,
      unresolvedReferences,
      errors: this.errors,
      durationMs: Date.now() - startTime,
    };
  }

  private parse(): UnresolvedReference[] {
    const lines = this.source.split('\n');
    const docType = classifyMarkdownDocType(this.filePath);

    // --- frontmatter (--- ... ---) ---
    const { bodyStart, fields: fm } = parseFrontmatter(lines);
    const fmName = fm['name'];
    const fmDocstring = composeDocstring(docType, fm);

    const fileNode = createFileNode(this.filePath, this.source, 'markdown');
    this.nodes.push(fileNode);

    const docNode = createDocumentNode(this.filePath, this.source, 'markdown', docType, {
      name: fmName,
      docstring: fmDocstring,
    });
    this.nodes.push(docNode);
    this.edges.push(containsEdge(fileNode.id, docNode.id, 1));

    // --- headings → section tree ---
    const stack: OpenSection[] = [];
    const preambleLines: string[] = [];
    let inFence = false;

    const closeTo = (level: number, endLine: number): void => {
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
        const closed = stack.pop()!;
        closed.node.endLine = endLine;
        this.finishSection(closed);
      }
    };

    for (let i = bodyStart; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      if (FENCE_RE.test(line.trimStart())) {
        inFence = !inFence;
        this.currentBody(stack, preambleLines).push(line);
        continue;
      }
      if (inFence) {
        this.currentBody(stack, preambleLines).push(line);
        continue;
      }

      const heading = line.match(HEADING_RE);
      if (heading) {
        const level = heading[1]!.length;
        const title = heading[2]!.trim();
        closeTo(level, lineNum - 1);

        const parent = stack.length > 0 ? stack[stack.length - 1]!.node : docNode;
        const parentQn = parent.kind === 'document' ? this.filePath : parent.qualifiedName;
        const node: Node = {
          id: generateNodeId(this.filePath, 'section', title, lineNum),
          kind: 'section',
          name: title.length > 120 ? title.slice(0, 120) : title,
          qualifiedName: `${parentQn}#${title}`,
          filePath: this.filePath,
          language: 'markdown',
          startLine: lineNum,
          endLine: lines.length, // adjusted when the section closes
          startColumn: 0,
          endColumn: line.length,
          signature: `${heading[1]} ${title}`,
          updatedAt: Date.now(),
        };
        this.nodes.push(node);
        this.edges.push(containsEdge(parent.id, node.id, lineNum));
        stack.push({ node, level, bodyLines: [] });
        continue;
      }

      this.currentBody(stack, preambleLines).push(line);
      this.scanMentions(
        stack.length > 0 ? stack[stack.length - 1]!.node.id : docNode.id,
        line,
        lineNum
      );
    }

    closeTo(1, lines.length);

    // Preamble (text before the first heading) describes the document itself.
    if (!docNode.docstring) {
      docNode.docstring = excerpt(stripMarkdown(preambleLines.join(' ')));
    }

    return this.mentions.collect();
  }

  private currentBody(stack: OpenSection[], preamble: string[]): string[] {
    return stack.length > 0 ? stack[stack.length - 1]!.bodyLines : preamble;
  }

  private finishSection(section: OpenSection): void {
    section.node.docstring = excerpt(stripMarkdown(section.bodyLines.join(' ')));
  }

  /** Emit high-confidence mentions found on one line of prose. */
  private scanMentions(fromNodeId: string, line: string, lineNum: number): void {
    for (const m of line.matchAll(LINK_RE)) {
      this.mentions.addPath(fromNodeId, m[1]!, lineNum);
    }
    for (const m of line.matchAll(INLINE_CODE_RE)) {
      this.mentions.addAuto(fromNodeId, m[1]!, lineNum);
    }
  }
}

/** Light prose cleanup for excerpts: drop link/code syntax, keep the words. */
function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_>#]/g, '')
    .trim();
}

function stripYamlQuotes(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

/**
 * Minimal YAML-frontmatter reader: pulls every top-level `key: value` pair out
 * of a leading `--- … ---` block. Scalars, flow lists (`[a, b]`), and block
 * lists (`key:` followed by `- item` lines) are all flattened to a
 * comma-joined string. Not a full YAML parser — just enough for the agent
 * knowledge-file conventions (name/description/allowed-tools/argument-hint/model).
 */
function parseFrontmatter(lines: string[]): {
  bodyStart: number;
  fields: Record<string, string>;
} {
  const fields: Record<string, string> = {};
  if (lines[0]?.trim() !== '---') return { bodyStart: 0, fields };

  let bodyStart = 0;
  let listKey: string | null = null;
  let listItems: string[] = [];
  const flushList = (): void => {
    if (listKey && listItems.length) fields[listKey] = listItems.join(', ');
    listKey = null;
    listItems = [];
  };

  for (let i = 1; i < Math.min(lines.length, 200); i++) {
    const line = lines[i]!;
    if (line.trim() === '---') {
      bodyStart = i + 1;
      break;
    }
    const item = line.match(/^\s*-\s+(.+)$/);
    if (item && listKey) {
      listItems.push(stripYamlQuotes(item[1]!));
      continue;
    }
    const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    flushList();
    const key = kv[1]!.toLowerCase();
    const raw = kv[2]!.trim();
    if (raw === '') {
      // Either an empty value or the header of a block list on following lines.
      listKey = key;
      continue;
    }
    if (raw.startsWith('[') && raw.endsWith(']')) {
      fields[key] = raw
        .slice(1, -1)
        .split(',')
        .map((s) => stripYamlQuotes(s))
        .filter(Boolean)
        .join(', ');
    } else {
      fields[key] = stripYamlQuotes(raw);
    }
  }
  flushList();
  return { bodyStart, fields };
}

/**
 * Split a skill/command `description` into what-it-does vs. when-to-invoke. The
 * Claude Code convention puts the trigger in a trailing "Use when …" clause
 * ("… benchmark a codegraph version. Use when the user runs /agent-eval …").
 */
function splitTrigger(description: string): { summary: string; trigger?: string } {
  const idx = description.search(/\bUse\s+(?:this\s+\w+\s+)?(?:when|for|to)\b/i);
  if (idx < 0) return { summary: description };
  const summary = description.slice(0, idx).replace(/[\s.]+$/, '').trim();
  const trigger = description.slice(idx).trim();
  return { summary, trigger };
}

/**
 * Build the document node's docstring (FTS-indexed). For agent skills and slash
 * commands the structured frontmatter — trigger condition, allowed tools,
 * argument hint, model — is folded into the searchable text with explicit
 * labels, so these files carry more than a plain markdown blurb. For every
 * other doc type the raw `description` (if any) is used as-is.
 */
function composeDocstring(docType: DocType, fm: Record<string, string>): string | undefined {
  const description = fm['description'];
  if (docType !== 'skill' && docType !== 'command') return description;

  const tools = fm['allowed-tools'] ?? fm['tools'];
  const args = fm['argument-hint'] ?? fm['argument_hint'];
  const model = fm['model'];

  const parts: string[] = [];
  if (description) {
    const { summary, trigger } = splitTrigger(description);
    if (summary) parts.push(summary);
    if (trigger) parts.push(`Trigger: ${trigger}`);
  }
  if (tools) parts.push(`Tools: ${tools}`);
  if (args) parts.push(`Arguments: ${args}`);
  if (model) parts.push(`Model: ${model}`);

  return parts.length ? parts.join('\n') : undefined;
}
