import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client';
import { frontmatter } from '../db/schema';

interface SubtypeAffinity {
  preferred: Set<string>;
  dispreferred: Set<string>;
}

interface AffinityHit {
  displayPath: string;
  score: number;
}

const PREFERRED_BOOST = 1.5;
const DISPREFERRED_PENALTY = 0.6;

/**
 * Detect subtype affinity from query shape. Only fires on unambiguous signals:
 *   - "why ..."        → caller wants rationale → prefer decision/insight
 *   - "where ..."      → caller wants a concrete location/value → prefer fact
 *   - UPPER_SNAKE_CASE → bare identifier → prefer canonical definition (fact/decision)
 *
 * Returns null for everything else — leave qmd ranking untouched. The rule set is
 * intentionally narrow because the boost/penalty is large enough to flip top-1.
 *
 * Background: qmd's hybridQuery blends RRF rank with reranker score at fixed
 * weights (0.75 RRF + 0.25 rerank at rank 1), which structurally protects the
 * BM25 top-1 from being dethroned by the reranker. When we know the desired
 * subtype, we boost matching hits and penalise mismatches enough to flip the
 * order when the right answer is buried at rank 2–5.
 */
function detectSubtypeAffinity(query: string): SubtypeAffinity | null {
  const trimmed = query.trim();
  if (/^why\b/i.test(trimmed)) {
    return {
      preferred: new Set(['decision', 'insight']),
      dispreferred: new Set(['pattern', 'fact', 'convention']),
    };
  }
  if (/^where\b/i.test(trimmed)) {
    return {
      preferred: new Set(['fact']),
      dispreferred: new Set(['pattern']),
    };
  }
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(trimmed)) {
    return {
      preferred: new Set(['fact', 'decision']),
      dispreferred: new Set(['convention', 'pattern']),
    };
  }
  return null;
}

/** Batch-load the `subtype` frontmatter field for a set of paths. */
function lookupSubtypes(workspaceId: number, paths: string[]): Map<string, string> {
  const subtypeByPath = new Map<string, string>();
  if (paths.length === 0) return subtypeByPath;

  const db = getDb();
  const rows = db
    .select({ path: frontmatter.path, data: frontmatter.data })
    .from(frontmatter)
    .where(and(eq(frontmatter.workspaceId, workspaceId), inArray(frontmatter.path, paths))!)
    .all();

  for (const row of rows) {
    try {
      const data = JSON.parse(row.data) as { subtype?: unknown };
      if (typeof data.subtype === 'string') {
        subtypeByPath.set(row.path, data.subtype);
      }
    } catch {
      // ignore parse errors — row has no detectable subtype
    }
  }
  return subtypeByPath;
}

/**
 * Reweight qmd hits by subtype affinity derived from the query shape and
 * resort by adjusted score. No-op when the query doesn't match a known shape.
 */
export function applySubtypeAffinity<T extends AffinityHit>(
  hits: T[],
  query: string,
  workspaceId: number,
): T[] {
  const affinity = detectSubtypeAffinity(query);
  if (!affinity) return hits;

  const subtypeByPath = lookupSubtypes(
    workspaceId,
    hits.map((h) => h.displayPath),
  );

  return hits
    .map((hit) => {
      const subtype = subtypeByPath.get(hit.displayPath);
      if (!subtype) return hit;
      if (affinity.preferred.has(subtype)) {
        return { ...hit, score: hit.score * PREFERRED_BOOST };
      }
      if (affinity.dispreferred.has(subtype)) {
        return { ...hit, score: hit.score * DISPREFERRED_PENALTY };
      }
      return hit;
    })
    .sort((a, b) => b.score - a.score);
}
