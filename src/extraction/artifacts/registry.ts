/**
 * Artifact extractor registry
 *
 * The generic knowledge-graph entry point for non-code project artifacts
 * (docs, agent knowledge files, build/CI recipes). Adding support for a new
 * artifact type is one new extractor file + one entry here — the same
 * pattern as `src/installer/targets/registry.ts`.
 *
 * Every extractor emits the shared shape (see `common.ts`):
 *   file ── contains ──> document(signature=DocType) ── contains ──> section*
 * plus UnresolvedReferences for high-confidence doc→code mentions, which the
 * ReferenceResolver's strict doc-mention path turns into `references` edges.
 *
 * `extractFromSource` consults this registry BEFORE any language dispatch,
 * so a path match here owns the file entirely.
 */

import { ExtractionResult } from '../../types';
import {
  isMarkdownPath,
  isDockerfilePath,
  isComposePath,
  isWorkflowPath,
  isPackageManifestPath,
} from './detect';
import { MarkdownExtractor } from './markdown-extractor';
import { DockerfileExtractor } from './dockerfile-extractor';
import { ComposeExtractor } from './compose-extractor';
import { WorkflowExtractor } from './workflow-extractor';
import { PackageJsonExtractor } from './package-json-extractor';

export interface ArtifactExtractorEntry {
  /** Stable name, used in diagnostics. */
  name: string;
  /** Does this extractor own the file at this (project-relative) path? */
  matches(filePath: string): boolean;
  /** Run extraction. Must never throw — errors go into the result. */
  extract(filePath: string, source: string): ExtractionResult;
}

export const ARTIFACT_EXTRACTORS: ArtifactExtractorEntry[] = [
  {
    name: 'package-manifest',
    matches: isPackageManifestPath,
    extract: (f, s) => new PackageJsonExtractor(f, s).extract(),
  },
  {
    name: 'dockerfile',
    matches: isDockerfilePath,
    extract: (f, s) => new DockerfileExtractor(f, s).extract(),
  },
  {
    name: 'compose',
    matches: isComposePath,
    extract: (f, s) => new ComposeExtractor(f, s).extract(),
  },
  {
    name: 'workflow',
    matches: isWorkflowPath,
    extract: (f, s) => new WorkflowExtractor(f, s).extract(),
  },
  {
    name: 'markdown',
    matches: isMarkdownPath,
    extract: (f, s) => new MarkdownExtractor(f, s).extract(),
  },
];

/** First registry entry that claims the path, or null. */
export function findArtifactExtractor(filePath: string): ArtifactExtractorEntry | null {
  for (const entry of ARTIFACT_EXTRACTORS) {
    if (entry.matches(filePath)) return entry;
  }
  return null;
}
