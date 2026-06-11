import { and, eq, like, or, sql } from 'drizzle-orm';
import { jsonObjectArrayContains } from '../db/json';
import { getDb } from '../db/client';
import { frontmatter, tasks, projects } from '../db/schema';

// ── Shared types ─────────────────────────────────────────────────────

export interface SearchResult {
  path: string;
  title: string;
  snippet?: string;
  score?: number;
}

export interface SearchResultGroup {
  collection: string;
  results: SearchResult[];
}

// ── Title helpers ─────────────────────────────────────────────────────

export function titleFromPath(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  return base.replace(/\.md$/, '').replace(/[-_]/g, ' ');
}

export function extractTitle(dataJson: string, filePath: string): string {
  try {
    const data = JSON.parse(dataJson) as Record<string, unknown>;
    if (typeof data.title === 'string' && data.title) return data.title;
  } catch {
    // ignore parse errors
  }
  return titleFromPath(filePath);
}

// ── Frontmatter WHERE condition builder ──────────────────────────────

/**
 * Build a SQLite WHERE condition for the frontmatter table using JSON1 ops.
 * Array fields use EXISTS + json_each for membership checks.
 * Scalar fields use json_extract for equality.
 * All filters AND together.
 *
 * Accepts a generic Record so both typed SearchFilters (tRPC) and the
 * untyped filters object (MCP) can call through without casting.
 */
export function buildFrontmatterWhereCondition(
  workspaceId: number,
  filters: Record<string, unknown>,
  collection?: string,
) {
  const conditions: ReturnType<typeof eq>[] = [
    eq(frontmatter.workspaceId, workspaceId) as ReturnType<typeof eq>,
  ];

  if (collection && collection !== 'tasks') {
    conditions.push(
      eq(
        frontmatter.collection,
        collection as 'system' | 'docs' | 'projects' | 'memory',
      ) as ReturnType<typeof eq>,
    );
  }

  for (const scalar of ['type', 'subtype', 'repo'] as const) {
    const val = filters[scalar];
    if (typeof val === 'string' && val) {
      conditions.push(
        sql`json_extract(${frontmatter.data}, '$.' || ${scalar}) = ${val}` as ReturnType<typeof eq>,
      );
    }
  }

  for (const field of ['tags', 'themes', 'scenarioIds', 'sources', 'linkedMemories'] as const) {
    const values = filters[field];
    if (Array.isArray(values) && values.length > 0) {
      for (const value of values as string[]) {
        conditions.push(jsonObjectArrayContains(frontmatter.data, field, value));
      }
    }
  }

  return and(...conditions)!;
}

// ── Result grouping ──────────────────────────────────────────────────

export function groupFrontmatterRows(
  rows: Array<{ collection: string; path: string; data: string }>,
): SearchResultGroup[] {
  const byCollection = new Map<string, SearchResult[]>();
  for (const row of rows) {
    const group = byCollection.get(row.collection) ?? [];
    group.push({ path: row.path, title: extractTitle(row.data, row.path) });
    byCollection.set(row.collection, group);
  }
  return Array.from(byCollection.entries()).map(([col, results]) => ({ collection: col, results }));
}

// ── Task search helpers ───────────────────────────────────────────────

export function searchTasksByQuery(
  workspaceId: number,
  query: string,
  limit: number,
): SearchResult[] {
  const db = getDb();
  const pattern = `%${query}%`;
  const rows = db
    .select({ id: tasks.id, title: tasks.title, description: tasks.description })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        or(like(tasks.title, pattern), like(tasks.description, pattern))!,
      ),
    )
    .limit(limit)
    .all();
  return rows.map((t) => ({
    path: `task:${t.id}`,
    title: t.title,
    snippet: t.description ? t.description.slice(0, 150) : undefined,
  }));
}

export function filterTasksByStatus(
  workspaceId: number,
  status: string,
  limit: number,
): SearchResult[] {
  const db = getDb();
  const rows = db
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        eq(tasks.status, status as (typeof tasks.status)['_']['data']),
      ),
    )
    .limit(limit)
    .all();
  return rows.map((t) => ({ path: `task:${t.id}`, title: t.title }));
}

// ── Virtual path helpers ─────────────────────────────────────────────

export function collectionFromVirtualPath(virtualPath: string): string {
  const match = /^qmd:\/\/([^/]+)/.exec(virtualPath);
  return match ? match[1] : 'docs';
}
