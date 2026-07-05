import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { workspaces, frontmatter } from '../../db/schema';
import { runQmdSearch, isReadme } from '../../search/qmd-search';
import { applySubtypeAffinity } from '../../search/subtype-affinity';
import { getSupersededMemoryPaths } from '../../search/memory-queries';
import { traceWorkspace } from '../../search/trace';
import { chooseRepoAdapter } from '../../search/repo-adapter';
import { resolveWorktreeRoots } from './shared';
import {
  type SearchResult,
  type SearchResultGroup,
  titleFromPath,
  extractTitle,
  buildFrontmatterWhereCondition,
  groupFrontmatterRows,
  collectionFromVirtualPath,
  searchTasksByQuery,
  filterTasksByStatus,
  resolveDisplayMeta,
} from '../../search/frontmatter-filter';

const filtersSchema = z.object({
  type: z.string().optional(),
  subtype: z.string().optional(),
  repo: z.string().optional(),
  tags: z.array(z.string()).optional(),
  themes: z.array(z.string()).optional(),
  scenarioIds: z.array(z.string()).optional(),
  sources: z.array(z.string()).optional(),
  linkedMemories: z.array(z.string()).optional(),
  status: z.string().optional(),
});

const searchModeSchema = z.enum(['hybrid', 'lex', 'vector']);

const queryInput = z.object({
  workspaceSlug: z.string().min(1),
  query: z.string().optional(),
  collection: z.string().optional(),
  filters: filtersSchema.optional(),
  limit: z.number().min(1).max(500).default(50),
  mode: searchModeSchema.optional(),
  intent: z.string().optional(),
});

type SearchMode = z.infer<typeof searchModeSchema>;

type SearchFilters = z.infer<typeof filtersSchema>;

function resolveWorkspace(workspaceSlug: string) {
  const db = getDb();
  const ws = db.select().from(workspaces).where(eq(workspaces.slug, workspaceSlug)).get();
  if (!ws) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `Workspace "${workspaceSlug}" not found` });
  }
  return ws;
}

export const searchRouter = router({
  query: publicProcedure.input(queryInput).query(async ({ input }) => {
    const ws = resolveWorkspace(input.workspaceSlug);
    const { query, collection, filters, limit, intent } = input;
    // Lex is the default: hybrid runs local LLM inference (query expansion +
    // rerank) that can take minutes on CPU-only hardware, so it is opt-in.
    const mode: SearchMode = input.mode ?? 'lex';

    const hasQuery = typeof query === 'string' && query.trim().length > 0;
    const hasFilters =
      filters !== undefined && Object.values(filters).some((v) => v !== undefined);

    if (hasQuery && !hasFilters) {
      return queryOnlyMode(ws, query!, collection, limit, mode, intent);
    }

    if (!hasQuery && hasFilters) {
      return filtersOnlyMode(ws.id, filters!, collection, limit);
    }

    if (hasQuery && hasFilters) {
      return queryWithFiltersMode(ws, query!, filters!, collection, limit, mode, intent);
    }

    return [];
  }),

  trace: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string().min(1),
        fr: z.string().optional(),
        file: z.string().optional(),
        sessionId: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const ws = resolveWorkspace(input.workspaceSlug);
      const codeRootsOverride = resolveWorktreeRoots(input.sessionId);
      const adapter = chooseRepoAdapter(ctx.state);
      return await traceWorkspace(ws, { fr: input.fr, file: input.file }, codeRootsOverride, adapter);
    }),
});

/**
 * Maps qmd/store errors to typed TRPCErrors so clients can display
 * meaningful messages instead of a generic 500 or indefinite spinner.
 */
function mapSearchError(err: unknown): TRPCError {
  if (err instanceof TRPCError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('Hybrid search timed out')) {
    return new TRPCError({ code: 'TIMEOUT', message });
  }
  if (message.includes('download') || message.includes('model')) {
    return new TRPCError({
      code: 'PRECONDITION_FAILED',
      message:
        'Embedding model is not yet available. Run `engy:reindex` to initialise the search index.',
    });
  }
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: `Search index unavailable: ${message}. Run \`/engy:reindex\` to rebuild or check server logs.`,
    cause: err,
  });
}

async function queryOnlyMode(
  ws: { id: number; slug: string; docsDir: string | null },
  query: string,
  collection: string | undefined,
  limit: number,
  mode: SearchMode,
  intent: string | undefined,
): Promise<SearchResultGroup[]> {
  const groups: SearchResultGroup[] = [];

  // Always search tasks via SQLite LIKE — fast, no model needed.
  if (!collection || collection === 'tasks') {
    const taskResults = searchTasksByQuery(ws.id, query, limit);
    if (taskResults.length > 0) {
      groups.push({ collection: 'tasks', results: taskResults });
    }
  }

  // qmd search — skipped when QMD_SKIP=1 (test environments without models).
  if (process.env.QMD_SKIP === '1') {
    return groups;
  }

  try {
    const rawHits = await runQmdSearch(ws, query, collection, limit, mode, intent);
    const qmdResults = applySubtypeAffinity(rawHits, query, ws.id);
    const supersededPaths = getSupersededMemoryPaths(ws.id);

    const visibleHits = qmdResults.filter((hit) => !supersededPaths.has(hit.displayPath));
    const fmMeta = resolveDisplayMeta(
      ws.id,
      visibleHits.map((h) => h.displayPath),
    );

    const byCollection = new Map<string, SearchResult[]>();
    for (const hit of visibleHits) {
      const col = collectionFromVirtualPath(hit.file);
      const meta = fmMeta.get(hit.displayPath);
      const group = byCollection.get(col) ?? [];
      group.push({
        path: hit.displayPath,
        title: meta?.title || hit.title || titleFromPath(hit.displayPath),
        snippet: hit.snippet,
        score: hit.score,
        subtype: meta?.subtype,
        tags: meta?.tags,
      });
      byCollection.set(col, group);
    }

    for (const [col, results] of byCollection.entries()) {
      groups.push({ collection: col, results });
    }
  } catch (err) {
    throw mapSearchError(err);
  }

  return groups;
}

/**
 * Returns true when every set filter key is task-only (status).
 * Used to skip the frontmatter query entirely when no file-collection
 * filter is present — prevents a status-only query from returning
 * arbitrary non-task documents.
 */
function hasOnlyTaskFilters(filters: SearchFilters): boolean {
  const { status, ...rest } = filters;
  return Object.values(rest).every((v) => v === undefined);
}

async function filtersOnlyMode(
  workspaceId: number,
  filters: SearchFilters,
  collection: string | undefined,
  limit: number,
): Promise<SearchResultGroup[]> {
  const db = getDb();
  const groups: SearchResultGroup[] = [];

  // File collections: frontmatter JSON1 filter.
  // Skip entirely when the only filter is status (a task-only field) — running
  // the frontmatter query with no JSON1 conditions on data would return all rows.
  const skipFrontmatter = hasOnlyTaskFilters(filters);

  if (!skipFrontmatter && (!collection || collection !== 'tasks')) {
    const condition = buildFrontmatterWhereCondition(workspaceId, filters, collection);
    const rows = db
      .select({
        collection: frontmatter.collection,
        path: frontmatter.path,
        data: frontmatter.data,
      })
      .from(frontmatter)
      .where(condition)
      .limit(limit)
      .all();

    const supersededPaths = getSupersededMemoryPaths(workspaceId);
    groups.push(
      ...groupFrontmatterRows(
        rows.filter((r) => !supersededPaths.has(r.path) && !isReadme(r.path)),
      ),
    );
  }

  // Tasks collection: status filter
  if (filters.status && (!collection || collection === 'tasks')) {
    const taskResults = filterTasksByStatus(workspaceId, filters.status, limit);
    if (taskResults.length > 0) {
      groups.push({ collection: 'tasks', results: taskResults });
    }
  }

  return groups;
}

async function queryWithFiltersMode(
  ws: { id: number; slug: string; docsDir: string | null },
  query: string,
  filters: SearchFilters,
  collection: string | undefined,
  limit: number,
  mode: SearchMode,
  intent: string | undefined,
): Promise<SearchResultGroup[]> {
  const db = getDb();
  const groups: SearchResultGroup[] = [];

  // Always apply task status filter — fast SQLite, no model needed.
  if (filters.status && (!collection || collection === 'tasks')) {
    const taskResults = filterTasksByStatus(ws.id, filters.status, limit);
    if (taskResults.length > 0) {
      groups.push({ collection: 'tasks', results: taskResults });
    }
  }

  // qmd hybrid search — skipped when QMD_SKIP=1 (test environments without models).
  if (process.env.QMD_SKIP === '1') {
    return groups;
  }

  try {
    // Fetch more candidates so filters have room to narrow.
    // With a subtype filter the relevant subset is small (≤ corpus size for that subtype),
    // so go wide enough to almost always intersect.
    const candidateLimit = filters.subtype ? Math.min(500, limit * 8) : limit * 2;
    const rawHits = await runQmdSearch(ws, query, collection, candidateLimit, mode, intent);
    const qmdResults = applySubtypeAffinity(rawHits, query, ws.id);
    const supersededPaths = getSupersededMemoryPaths(ws.id);

    // Build a set of workspace-relative paths from qmd results (skip superseded)
    const scoreByFrontmatterPath = new Map<string, number>();
    for (const hit of qmdResults) {
      if (supersededPaths.has(hit.displayPath)) continue;
      scoreByFrontmatterPath.set(hit.displayPath, hit.score);
    }

    // Always run the frontmatter filter so the response includes filter-matching docs
    // even when qmd missed them entirely (e.g. when subtype is the dominant signal).
    const condition = buildFrontmatterWhereCondition(ws.id, filters, collection);
    const filteredRows = db
      .select({
        collection: frontmatter.collection,
        path: frontmatter.path,
        data: frontmatter.data,
      })
      .from(frontmatter)
      .where(condition)
      .all()
      .filter((r) => !supersededPaths.has(r.path) && !isReadme(r.path));

    const byCollection = new Map<string, SearchResult[]>();
    for (const row of filteredRows) {
      const group = byCollection.get(row.collection) ?? [];
      group.push({
        path: row.path,
        title: extractTitle(row.data, row.path),
        score: scoreByFrontmatterPath.get(row.path),
      });
      byCollection.set(row.collection, group);
    }

    // Sort each group: scored rows by score desc, unscored rows after (by path for stability),
    // then truncate to limit.
    for (const [col, results] of byCollection.entries()) {
      groups.push({
        collection: col,
        results: results
          .sort((a, b) => {
            const aScored = typeof a.score === 'number';
            const bScored = typeof b.score === 'number';
            if (aScored && bScored) return (b.score ?? 0) - (a.score ?? 0);
            if (aScored) return -1;
            if (bScored) return 1;
            return a.path.localeCompare(b.path);
          })
          .slice(0, limit),
      });
    }
  } catch (err) {
    throw mapSearchError(err);
  }

  return groups;
}
