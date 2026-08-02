import { describe, it, expect, beforeEach, afterEach, vi, type MockedFunction } from 'vitest';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { appRouter } from '../trpc/root';
import { fleetingMemories, workspaces } from '../db/schema';
import { eq } from 'drizzle-orm';

vi.mock('./qmd-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./qmd-store')>();
  return {
    ...actual,
    getStore: vi.fn(),
  };
});

import { getStore } from './qmd-store';
import { clusterReviewCandidates } from './candidate-clusters';

const mockGetStore = getStore as MockedFunction<typeof getStore>;

/**
 * Fake embedBatch keyed by exact content string, so it's immune to row-order
 * ties (createdAt collisions in fast test inserts don't guarantee query order).
 */
function fakeStore(vectorsByContent: Record<string, number[] | null>) {
  return {
    internal: {
      llm: {
        embedBatch: vi.fn(async (texts: string[]) =>
          texts.map((text) => {
            const v = vectorsByContent[text];
            return v ? { embedding: v, model: 'fake' } : null;
          }),
        ),
      },
    },
  } as unknown as Awaited<ReturnType<typeof getStore>>;
}

describe('candidate-clusters', () => {
  let ctx: TestContext;
  let workspaceSlug: string;
  let workspaceId: number;

  beforeEach(async () => {
    ctx = setupTestDb();
    delete process.env.QMD_SKIP;
    vi.clearAllMocks();
    const caller = appRouter.createCaller({ state: ctx.state });
    const ws = await caller.workspace.create({ name: 'Cluster Test WS' });
    workspaceSlug = ws.slug;
    const wsRow = ctx.db.select().from(workspaces).where(eq(workspaces.slug, workspaceSlug)).get()!;
    workspaceId = wsRow.id;
  });

  afterEach(() => {
    process.env.QMD_SKIP = '1';
    ctx.cleanup();
  });

  function insertFleeting(content: string, createdAt?: string) {
    return ctx.db
      .insert(fleetingMemories)
      .values({
        workspaceId,
        content,
        type: 'capture',
        source: 'agent',
        ...(createdAt ? { createdAt } : {}),
      })
      .returning()
      .get();
  }

  describe('[FR-MEMORY-270] threshold-based clustering', () => {
    it('should group candidates whose embeddings are above the threshold into one cluster', async () => {
      const a = insertFleeting('Fleeting A');
      const b = insertFleeting('Fleeting B — near duplicate of A');
      const c = insertFleeting('Totally unrelated fleeting C');

      mockGetStore.mockResolvedValue(
        fakeStore({
          'Fleeting A': [1, 0, 0],
          'Fleeting B — near duplicate of A': [0.999, 0.001, 0], // near-identical to A → same cluster
          'Totally unrelated fleeting C': [0, 1, 0], // orthogonal → its own cluster
        }),
      );

      const result = await clusterReviewCandidates(
        { id: workspaceId, slug: workspaceSlug, docsDir: null },
        { threshold: 0.92 },
      );

      expect(result.truncated).toBe(false);
      expect(result.clusters).toHaveLength(2);

      const merged = result.clusters.find((cl) => cl.memberCount === 2)!;
      expect(new Set(merged.ids)).toEqual(new Set([a.id, b.id]));

      const singleton = result.clusters.find((cl) => cl.memberCount === 1)!;
      expect(singleton.ids).toEqual([c.id]);
    });

    it('should not merge candidates whose similarity falls below the threshold', async () => {
      const a = insertFleeting('Fleeting A');
      const b = insertFleeting('Fleeting B — related but distinct');

      mockGetStore.mockResolvedValue(
        fakeStore({
          'Fleeting A': [1, 0, 0],
          'Fleeting B — related but distinct': [0.7, 0.7, 0], // cosine ~0.7, below 0.92 threshold
        }),
      );

      const result = await clusterReviewCandidates(
        { id: workspaceId, slug: workspaceSlug, docsDir: null },
        { threshold: 0.92 },
      );

      expect(result.clusters).toHaveLength(2);
      expect(result.clusters.every((cl) => cl.memberCount === 1)).toBe(true);
      expect(new Set(result.clusters.flatMap((cl) => cl.ids))).toEqual(new Set([a.id, b.id]));
    });

    it('should sort clusters largest-first with singletons last', async () => {
      const a = insertFleeting('A');
      const b = insertFleeting('B dup of A');
      const c = insertFleeting('C dup of A and B');
      const d = insertFleeting('D — alone');

      mockGetStore.mockResolvedValue(
        fakeStore({
          A: [1, 0, 0],
          'B dup of A': [1, 0, 0],
          'C dup of A and B': [1, 0, 0],
          'D — alone': [0, 1, 0],
        }),
      );

      const result = await clusterReviewCandidates(
        { id: workspaceId, slug: workspaceSlug, docsDir: null },
        { threshold: 0.92 },
      );

      expect(result.clusters).toHaveLength(2);
      expect(result.clusters[0].memberCount).toBe(3);
      expect(new Set(result.clusters[0].ids)).toEqual(new Set([a.id, b.id, c.id]));
      expect(result.clusters[1].memberCount).toBe(1);
      expect(result.clusters[1].ids).toEqual([d.id]);
    });

    it('should merge a realistic near-duplicate pair at the default threshold', async () => {
      const a = insertFleeting('Fleeting A');
      const b = insertFleeting('Fleeting B — same topic, different wording');

      // cosine ≈ 0.80 — the observed range for real near-duplicate captures.
      // A default tuned above this band can never cluster anything.
      mockGetStore.mockResolvedValue(
        fakeStore({
          'Fleeting A': [1, 0, 0],
          'Fleeting B — same topic, different wording': [0.8, 0.6, 0],
        }),
      );

      const result = await clusterReviewCandidates({
        id: workspaceId,
        slug: workspaceSlug,
        docsDir: null,
      });

      expect(result.clusters).toHaveLength(1);
      expect(new Set(result.clusters[0].ids)).toEqual(new Set([a.id, b.id]));
      expect(result.degraded).toBe(false);
    });

    it('should report degraded false when every candidate embedded successfully', async () => {
      insertFleeting('A');
      insertFleeting('B — unrelated');

      mockGetStore.mockResolvedValue(fakeStore({ A: [1, 0, 0], 'B — unrelated': [0, 1, 0] }));

      const result = await clusterReviewCandidates({
        id: workspaceId,
        slug: workspaceSlug,
        docsDir: null,
      });

      // All singletons, but a genuine result — the case `degraded` exists to
      // distinguish from an embedding failure that produces the same shape.
      expect(result.clusters.every((cl) => cl.memberCount === 1)).toBe(true);
      expect(result.degraded).toBe(false);
    });

    it('should report degraded false for an empty queue', async () => {
      const result = await clusterReviewCandidates({
        id: workspaceId,
        slug: workspaceSlug,
        docsDir: null,
      });

      expect(result.clusters).toHaveLength(0);
      expect(result.degraded).toBe(false);
    });

    it('should chain A and C into one cluster when both link through B', async () => {
      // Explicit timestamps: rows are processed newest-first, and this outcome
      // is order-dependent. With the bridge B seen first, A and C both join it.
      // Were B seen last it would join only A, leaving C a singleton — the
      // order-sensitivity that makes lowering the threshold risky.
      const a = insertFleeting('A', new Date(2025, 0, 1, 0, 0, 1).toISOString());
      const c = insertFleeting('C', new Date(2025, 0, 1, 0, 0, 2).toISOString());
      const b = insertFleeting('B — bridges A and C', new Date(2025, 0, 1, 0, 0, 3).toISOString());

      // sim(A,B) and sim(B,C) clear the threshold but sim(A,C) does not, so
      // single-link puts all three together. Lowering the threshold widens this
      // chaining until unrelated claims merge — the reason 0.72 was rejected.
      mockGetStore.mockResolvedValue(
        fakeStore({
          A: [1, 0, 0],
          'B — bridges A and C': [0.8, 0.6, 0], // cos(A,B) = 0.80
          C: [0.28, 0.96, 0], // cos(B,C) = 0.80, cos(A,C) = 0.28
        }),
      );

      const result = await clusterReviewCandidates({
        id: workspaceId,
        slug: workspaceSlug,
        docsDir: null,
      });

      expect(result.clusters).toHaveLength(1);
      expect(new Set(result.clusters[0].ids)).toEqual(new Set([a.id, b.id, c.id]));
    });

    it('should exclude dismissed and promoted fleeting memories from clustering', async () => {
      const pending = insertFleeting('Pending candidate');
      ctx.db
        .insert(fleetingMemories)
        .values({
          workspaceId,
          content: 'Dismissed candidate',
          type: 'capture',
          source: 'agent',
          dismissedAt: new Date().toISOString(),
        })
        .run();
      ctx.db
        .insert(fleetingMemories)
        .values({
          workspaceId,
          content: 'Promoted candidate',
          type: 'capture',
          source: 'agent',
          promoted: true,
          promotedAt: new Date().toISOString(),
        })
        .run();

      mockGetStore.mockResolvedValue(fakeStore({ 'Pending candidate': [1, 0, 0] }));

      const result = await clusterReviewCandidates({
        id: workspaceId,
        slug: workspaceSlug,
        docsDir: null,
      });

      expect(result.clusters).toHaveLength(1);
      expect(result.clusters[0].ids).toEqual([pending.id]);
    });
  });

  describe('[FR-MEMORY-270] graceful degradation', () => {
    it('should return every candidate as its own singleton cluster when QMD_SKIP=1', async () => {
      process.env.QMD_SKIP = '1';
      const a = insertFleeting('A');
      const b = insertFleeting('B');

      const result = await clusterReviewCandidates({
        id: workspaceId,
        slug: workspaceSlug,
        docsDir: null,
      });

      expect(mockGetStore).not.toHaveBeenCalled();
      expect(result.degraded).toBe(true);
      expect(result.clusters).toHaveLength(2);
      expect(result.clusters.every((cl) => cl.memberCount === 1)).toBe(true);
      expect(new Set(result.clusters.flatMap((cl) => cl.ids))).toEqual(new Set([a.id, b.id]));
    });

    it('should degrade to singleton clusters when the store has no llm', async () => {
      insertFleeting('A');
      insertFleeting('B');
      mockGetStore.mockResolvedValue({ internal: {} } as Awaited<ReturnType<typeof getStore>>);

      const result = await clusterReviewCandidates({
        id: workspaceId,
        slug: workspaceSlug,
        docsDir: null,
      });

      expect(result.clusters.every((cl) => cl.memberCount === 1)).toBe(true);
      expect(result.degraded).toBe(true);
    });

    it('should degrade to singleton clusters when getStore throws', async () => {
      insertFleeting('A');
      insertFleeting('B');
      mockGetStore.mockRejectedValue(new Error('model init failed'));

      const result = await clusterReviewCandidates({
        id: workspaceId,
        slug: workspaceSlug,
        docsDir: null,
      });

      expect(result.clusters.every((cl) => cl.memberCount === 1)).toBe(true);
      expect(result.degraded).toBe(true);
    });

    it('should treat a candidate with a null embedding as its own singleton', async () => {
      const a = insertFleeting('A');
      const b = insertFleeting('B — embed fails for this one');

      mockGetStore.mockResolvedValue(fakeStore({ A: [1, 0, 0], 'B — embed fails for this one': null }));

      const result = await clusterReviewCandidates({
        id: workspaceId,
        slug: workspaceSlug,
        docsDir: null,
      });

      expect(result.clusters).toHaveLength(2);
      expect(result.clusters.every((cl) => cl.memberCount === 1)).toBe(true);
      expect(new Set(result.clusters.flatMap((cl) => cl.ids))).toEqual(new Set([a.id, b.id]));
      expect(result.degraded).toBe(true);
    });
  });

  describe('[FR-MEMORY-270] truncation cap', () => {
    it('should cluster only the newest 200 candidates and mark truncated', async () => {
      const total = 205;
      const rows = [];
      for (let i = 0; i < total; i++) {
        const createdAt = new Date(2025, 0, 1, 0, 0, i).toISOString();
        rows.push(insertFleeting(`Candidate ${i}`, createdAt));
      }

      mockGetStore.mockResolvedValue(
        fakeStore(Object.fromEntries(rows.map((r) => [r.content, [1, 0, 0]]))),
      );

      const result = await clusterReviewCandidates({
        id: workspaceId,
        slug: workspaceSlug,
        docsDir: null,
      });

      expect(result.truncated).toBe(true);
      const clusteredCount = result.clusters.reduce((sum, cl) => sum + cl.memberCount, 0);
      expect(clusteredCount).toBe(200);

      // Newest 200 by createdAt (indices 5..204) should be the ones clustered.
      const clusteredIds = new Set(result.clusters.flatMap((cl) => cl.ids));
      expect(clusteredIds.has(rows[0].id)).toBe(false);
      expect(clusteredIds.has(rows[total - 1].id)).toBe(true);
    });
  });
});
