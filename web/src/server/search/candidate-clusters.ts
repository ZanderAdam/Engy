import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db/client';
import { fleetingMemories } from '../db/schema';
import { getStore } from './qmd-store';

type FleetingMemory = typeof fleetingMemories.$inferSelect;

export interface ReviewCluster {
  ids: number[];
  memberCount: number;
  members: FleetingMemory[];
}

export interface ClusterReviewCandidatesResult {
  clusters: ReviewCluster[];
  truncated: boolean;
}

// Empirically (embeddinggemma-300M on raw unformatted content): a reworded
// near-duplicate pair measured 0.9158 cosine while unrelated captures measured
// ~0.42, so 0.88 catches paraphrase-level duplicates with a wide margin.
const DEFAULT_THRESHOLD = 0.88;
const MAX_CANDIDATES = 200;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Greedy single-link clustering: a candidate joins the first existing cluster
 * containing any member above the similarity threshold, else starts a new one.
 * A null embedding (degraded mode) never joins — it always starts its own cluster.
 */
function greedyCluster(
  rows: FleetingMemory[],
  embeddings: (number[] | null)[],
  threshold: number,
): ReviewCluster[] {
  const clusters: number[][] = [];

  for (let i = 0; i < rows.length; i++) {
    const embedding = embeddings[i];
    const target = embedding
      ? clusters.find((cluster) =>
          cluster.some((j) => {
            const other = embeddings[j];
            return other !== null && cosineSimilarity(embedding, other) >= threshold;
          }),
        )
      : undefined;

    if (target) {
      target.push(i);
    } else {
      clusters.push([i]);
    }
  }

  return clusters
    .map((indices) => ({
      ids: indices.map((i) => rows[i].id),
      memberCount: indices.length,
      members: indices.map((i) => rows[i]),
    }))
    .sort((a, b) => b.memberCount - a.memberCount);
}

/**
 * Clusters pending (non-dismissed, non-promoted) fleeting memories by embedding
 * cosine similarity, computed ad-hoc — nothing is persisted to the search index.
 * Degrades to one singleton cluster per memory (today's one-by-one review) when
 * QMD_SKIP=1 or the embedded LLM is unavailable, so the feature never errors.
 */
export async function clusterReviewCandidates(
  ws: { id: number; slug: string; docsDir: string | null },
  options: { threshold?: number } = {},
): Promise<ClusterReviewCandidatesResult> {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const db = getDb();

  const pending = db
    .select()
    .from(fleetingMemories)
    .where(
      and(
        eq(fleetingMemories.workspaceId, ws.id),
        eq(fleetingMemories.promoted, false),
        isNull(fleetingMemories.dismissedAt),
      ),
    )
    .orderBy(desc(fleetingMemories.createdAt))
    .all();

  const truncated = pending.length > MAX_CANDIDATES;
  const rows = truncated ? pending.slice(0, MAX_CANDIDATES) : pending;

  let embeddings: (number[] | null)[] = rows.map(() => null);
  if (process.env.QMD_SKIP !== '1' && rows.length > 0) {
    try {
      const store = await getStore(ws);
      const llm = store.internal.llm;
      if (llm) {
        // Raw content, not qmd's formatDocForEmbedding — that helper isn't exported
        // from the package root. Fine for candidate-vs-candidate comparison; the
        // default threshold is tuned against these unformatted embeddings.
        const results = await llm.embedBatch(rows.map((r) => r.content));
        embeddings = results.map((r) => r?.embedding ?? null);
      }
    } catch {
      // Embedding unavailable — fall through to singleton clusters.
    }
  }

  return { clusters: greedyCluster(rows, embeddings, threshold), truncated };
}
