/**
 * Skill-bundle edge synthesis.
 *
 * Files inside one skill directory are strongly associated by construction —
 * a skill is a self-contained bundle (SKILL.md + scripts + reference docs).
 * Static extraction only links what SKILL.md explicitly mentions; this pass
 * adds a `references` edge from the SKILL.md document node to EVERY indexed
 * file in its directory subtree, so `codegraph_explore "release skill"`
 * surfaces the whole bundle (the helper script, the reference doc) without
 * the agent listing the directory.
 *
 * Deterministic, not heuristic: same-directory membership is a fact, so the
 * edges carry `metadata.synthesizedBy: 'skill-bundle'` but no
 * `provenance: 'heuristic'`. Anchored on the SKILL.md document only (other
 * markdown in the bundle classifies as docType 'skill' too, but a star from
 * the canonical anchor is enough — pairwise linking would explode edges).
 */

import type { Edge } from '../types';
import type { QueryBuilder } from '../db/queries';

/** Cap per bundle — a runaway skill dir must not flood the graph. */
const MAX_BUNDLE_FILES = 100;

export function synthesizeSkillBundleEdges(queries: QueryBuilder): number {
  const skillDocs = queries
    .getNodesByKind('document')
    .filter((d) => d.signature === 'skill' && /(^|\/)skill\.md$/i.test(d.filePath));
  if (skillDocs.length === 0) return 0;

  const allPaths = queries.getAllFilePaths();
  const edges: Edge[] = [];

  for (const doc of skillDocs) {
    const slash = doc.filePath.lastIndexOf('/');
    if (slash < 0) continue; // SKILL.md at the very root has no bundle dir
    const dirPrefix = doc.filePath.slice(0, slash + 1);

    const existingTargets = new Set(
      queries.getOutgoingEdges(doc.id, ['references']).map((e) => e.target)
    );

    let added = 0;
    for (const p of allPaths) {
      if (added >= MAX_BUNDLE_FILES) break;
      if (p === doc.filePath || !p.startsWith(dirPrefix)) continue;
      const target = `file:${p}`;
      if (existingTargets.has(target)) continue;
      edges.push({
        source: doc.id,
        target,
        kind: 'references',
        metadata: { synthesizedBy: 'skill-bundle' },
      });
      added++;
    }
  }

  if (edges.length > 0) queries.insertEdges(edges);
  return edges.length;
}
