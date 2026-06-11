import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { eq, and, inArray, like } from 'drizzle-orm';
import { getStore } from './qmd-store';
import { getDb } from '../db/client';
import { workspaces, frontmatter, permanentMemories } from '../db/schema';
import { getWorkspaceDir } from '../engy-dir/init';
import { regenerateSystemReadmes } from '../lib/readme-index';

// Collections managed by the indexer.
const COLLECTIONS = ['system', 'docs', 'projects', 'memory'] as const;
type Collection = (typeof COLLECTIONS)[number];

// Permanent memory subtypes that live in memory/<subtype>/ and have DB mirrors.
const MEMORY_SUBTYPES = ['decisions', 'patterns', 'facts', 'conventions', 'insights'] as const;

/**
 * Aggregated per-collection counts returned by update() / forceFullReindex().
 */
export interface IndexResult {
  collection: Collection;
  indexed: number;
  updated: number;
  unchanged: number;
  removed: number;
  needsEmbedding: number;
}

/**
 * Resolve workspace by slug — throws if not found.
 */
function getWorkspace(workspaceSlug: string) {
  const db = getDb();
  const ws = db.select().from(workspaces).where(eq(workspaces.slug, workspaceSlug)).get();
  if (!ws) throw new Error(`Workspace not found: ${workspaceSlug}`);
  return ws;
}

/**
 * Normalize a filesystem path to a workspace-relative, forward-slash path.
 */
function toRelativePath(workspaceDir: string, absPath: string): string {
  return path.relative(workspaceDir, absPath).replace(/\\/g, '/');
}

/**
 * Recursively collect all .md file paths under a directory.
 * Returns absolute paths.
 */
function collectMdFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(full);
    } else if (entry.isDirectory()) {
      results.push(...collectMdFiles(full));
    }
  }
  return results;
}

/**
 * Sync the frontmatter SQLite table for a single collection.
 *
 * Strategy:
 * 1. Walk the filesystem for all .md files in the collection dir.
 * 2. INSERT OR REPLACE rows for every file found (qmd's SHA check means we trust
 *    the fs as source of truth — cheap upsert on any path qmd touched).
 * 3. DELETE rows for paths that no longer exist on disk (removed files).
 *
 * Note: qmd's update() returns only aggregate counts (indexed/updated/unchanged/removed),
 * not the list of per-file changed paths. Driving this sync from those lists is therefore
 * not possible — the full walk is the simplest correct approach until qmd exposes a
 * per-file change API.
 */
function syncFrontmatterTable(
  workspaceId: number,
  workspaceDir: string,
  collection: Collection,
): void {
  const db = getDb();
  const collectionDir = path.join(workspaceDir, collection);
  const mdFiles = collectMdFiles(collectionDir);
  const now = new Date().toISOString();

  // Upsert frontmatter for all files currently on disk.
  const activePaths: string[] = [];
  for (const absPath of mdFiles) {
    const relPath = toRelativePath(workspaceDir, absPath);
    activePaths.push(relPath);

    let data: Record<string, unknown> = {};
    try {
      const raw = fs.readFileSync(absPath, 'utf8');
      const parsed = matter(raw);
      data = parsed.data ?? {};
    } catch {
      console.warn(`[indexer] failed to parse frontmatter for ${relPath} — skipping`);
      continue;
    }

    db.insert(frontmatter)
      .values({
        workspaceId,
        collection,
        path: relPath,
        data: JSON.stringify(data),
        indexedAt: now,
      })
      .onConflictDoUpdate({
        target: [frontmatter.workspaceId, frontmatter.path],
        set: {
          collection,
          data: JSON.stringify(data),
          indexedAt: now,
        },
      })
      .run();
  }

  // Remove rows for files that no longer exist on disk.
  const existingRows = db
    .select({ path: frontmatter.path })
    .from(frontmatter)
    .where(and(eq(frontmatter.workspaceId, workspaceId), eq(frontmatter.collection, collection)))
    .all();

  const toDelete = existingRows
    .map((r) => r.path)
    .filter((p) => !activePaths.includes(p));

  if (toDelete.length > 0) {
    db.delete(frontmatter)
      .where(
        and(
          eq(frontmatter.workspaceId, workspaceId),
          inArray(frontmatter.path, toDelete),
        ),
      )
      .run();
  }
}

/**
 * Sync the permanentMemories SQLite mirror for the memory collection.
 *
 * Scans memory/{subtype}/*.md files (decisions, patterns, facts, conventions, insights)
 * and upserts DB rows keyed by filePath. Does NOT touch fleeting memories.
 */
export async function syncPermanentMemoryMirror(workspaceSlug: string): Promise<void> {
  const ws = getWorkspace(workspaceSlug);
  const workspaceDir = getWorkspaceDir(ws);
  const db = getDb();

  // supersededBy paths are resolved to ids in a second pass, after every row is
  // upserted — otherwise a forward reference (superseder file processed after the
  // superseded one, e.g. on a full rebuild) would resolve to a missing row.
  const supersededRefs: { relPath: string; supersededByPath: string }[] = [];

  for (const subtype of MEMORY_SUBTYPES) {
    const subtypeDir = path.join(workspaceDir, 'memory', subtype);
    const mdFiles = collectMdFiles(subtypeDir);

    for (const absPath of mdFiles) {
      if (path.basename(absPath).toLowerCase() === 'readme.md') continue;

      const relPath = toRelativePath(workspaceDir, absPath);

      let fm: Record<string, unknown> = {};
      let body = '';
      try {
        const raw = fs.readFileSync(absPath, 'utf8');
        const parsed = matter(raw);
        fm = parsed.data ?? {};
        body = parsed.content ?? '';
      } catch {
        continue;
      }

      const title = (fm.title as string) || path.basename(absPath, '.md');
      const dbSubtype = subtype.replace(/s$/, '') as
        | 'decision'
        | 'pattern'
        | 'fact'
        | 'convention'
        | 'insight';

      const existing = db
        .select({ id: permanentMemories.id })
        .from(permanentMemories)
        .where(
          and(
            eq(permanentMemories.workspaceId, ws.id),
            eq(permanentMemories.filePath, relPath),
          ),
        )
        .get();

      const now = new Date().toISOString();

      // Defer supersededBy resolution to the second pass below. When the file has
      // no supersededBy key, leave supersededById untouched on update (preserve the
      // DB value — it is authoritative when the file is silent).
      if (typeof fm.supersededBy === 'string' && fm.supersededBy) {
        supersededRefs.push({ relPath, supersededByPath: fm.supersededBy });
      }

      if (existing) {
        db.update(permanentMemories)
          .set({
            title,
            content: body,
            subtype: dbSubtype,
            repo: (fm.repo as string) ?? null,
            confidence: typeof fm.confidence === 'number' ? fm.confidence : null,
            keywords: Array.isArray(fm.keywords) ? (fm.keywords as string[]) : [],
            themes: Array.isArray(fm.themes) ? (fm.themes as string[]) : [],
            tags: Array.isArray(fm.tags) ? (fm.tags as string[]) : [],
            linkedMemories: Array.isArray(fm.linkedMemories)
              ? (fm.linkedMemories as string[])
              : [],
            scenarioIds: Array.isArray(fm.scenarioIds) ? (fm.scenarioIds as string[]) : [],
            sources: Array.isArray(fm.sources) ? (fm.sources as string[]) : [],
            updatedAt: now,
          })
          .where(eq(permanentMemories.id, existing.id))
          .run();
      } else {
        db.insert(permanentMemories)
          .values({
            workspaceId: ws.id,
            subtype: dbSubtype,
            title,
            content: body,
            filePath: relPath,
            repo: (fm.repo as string) ?? null,
            confidence: typeof fm.confidence === 'number' ? fm.confidence : null,
            keywords: Array.isArray(fm.keywords) ? (fm.keywords as string[]) : [],
            themes: Array.isArray(fm.themes) ? (fm.themes as string[]) : [],
            tags: Array.isArray(fm.tags) ? (fm.tags as string[]) : [],
            linkedMemories: Array.isArray(fm.linkedMemories)
              ? (fm.linkedMemories as string[])
              : [],
            scenarioIds: Array.isArray(fm.scenarioIds) ? (fm.scenarioIds as string[]) : [],
            sources: Array.isArray(fm.sources) ? (fm.sources as string[]) : [],
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
    }

    // Remove DB rows for memory files that no longer exist.
    const existingRows = db
      .select({ id: permanentMemories.id, filePath: permanentMemories.filePath })
      .from(permanentMemories)
      .where(
        and(
          eq(permanentMemories.workspaceId, ws.id),
          like(permanentMemories.filePath, `memory/${subtype}/%`),
        ),
      )
      .all();

    // Reuse the mdFiles list gathered above — avoid a second filesystem walk.
    const activePaths = new Set(mdFiles.map((p) => toRelativePath(workspaceDir, p)));

    const orphanIds = existingRows
      .filter((r) => r.filePath && !activePaths.has(r.filePath))
      .map((r) => r.id);

    if (orphanIds.length > 0) {
      db.delete(permanentMemories)
        .where(inArray(permanentMemories.id, orphanIds))
        .run();
    }
  }

  // Second pass: resolve supersededBy paths to ids now that every row exists.
  // Order-independent — a forward reference (superseder upserted after the
  // superseded row) resolves correctly here. A dangling path (superseder file
  // absent) resolves to null.
  for (const { relPath, supersededByPath } of supersededRefs) {
    const superseder = db
      .select({ id: permanentMemories.id })
      .from(permanentMemories)
      .where(
        and(
          eq(permanentMemories.workspaceId, ws.id),
          eq(permanentMemories.filePath, supersededByPath),
        ),
      )
      .get();
    db.update(permanentMemories)
      .set({ supersededById: superseder?.id ?? null })
      .where(
        and(eq(permanentMemories.workspaceId, ws.id), eq(permanentMemories.filePath, relPath)),
      )
      .run();
  }
}

/**
 * Update the qmd index and sync the frontmatter table for the given workspace.
 *
 * @param workspaceSlug - Workspace slug
 * @param collection - Optional: limit to a single collection. Defaults to all four.
 * @returns Per-collection index results.
 */
export async function update(
  workspaceSlug: string,
  collection?: Collection,
): Promise<IndexResult[]> {
  const ws = getWorkspace(workspaceSlug);
  const workspaceDir = getWorkspaceDir(ws);
  const store = await getStore(workspaceSlug);

  const targets: Collection[] = collection ? [collection] : [...COLLECTIONS];
  const results: IndexResult[] = [];

  for (const col of targets) {
    // System READMEs are skill-authored, not written through a server path, so
    // refresh their index blocks here before qmd hashes the collection.
    if (col === 'system') regenerateSystemReadmes(workspaceDir);

    const qmdResult = await store.update({ collections: [col] });

    syncFrontmatterTable(ws.id, workspaceDir, col);

    if (col === 'memory') {
      await syncPermanentMemoryMirror(workspaceSlug);
    }

    results.push({
      collection: col,
      indexed: qmdResult.indexed,
      updated: qmdResult.updated,
      unchanged: qmdResult.unchanged,
      removed: qmdResult.removed,
      needsEmbedding: qmdResult.needsEmbedding,
    });
  }

  return results;
}

/**
 * Fire-and-forget embed pass. Errors are caught and logged with an [indexer] prefix.
 * Used after a dir mutation to generate embeddings without blocking the response.
 */
function spawnEmbedPass(workspaceSlug: string): void {
  getStore(workspaceSlug)
    .then((store) => store.embed())
    .then((result) => {
      console.log(
        `[indexer] embed complete for ${workspaceSlug}: ` +
          `${result.docsProcessed} docs, ${result.chunksEmbedded} chunks`,
      );
    })
    .catch((err) => {
      console.error(`[indexer] embed error for ${workspaceSlug}:`, err);
    });
}

/**
 * Re-index a workspace from scratch by removing and re-adding each collection,
 * then running a full update.
 */
export async function forceFullReindex(workspaceSlug: string): Promise<IndexResult[]> {
  const store = await getStore(workspaceSlug);
  const ws = getWorkspace(workspaceSlug);
  const workspaceDir = getWorkspaceDir(ws);

  const results: IndexResult[] = [];

  for (const col of COLLECTIONS) {
    // Reset the collection in qmd so all content is re-hashed from scratch.
    await store.removeCollection(col);
    await store.addCollection(col, {
      path: path.join(workspaceDir, col),
      pattern: '**/*.md',
    });

    if (col === 'system') regenerateSystemReadmes(workspaceDir);

    const qmdResult = await store.update({ collections: [col] });

    syncFrontmatterTable(ws.id, workspaceDir, col);

    if (col === 'memory') {
      await syncPermanentMemoryMirror(workspaceSlug);
    }

    results.push({
      collection: col,
      indexed: qmdResult.indexed,
      updated: qmdResult.updated,
      unchanged: qmdResult.unchanged,
      removed: qmdResult.removed,
      needsEmbedding: qmdResult.needsEmbedding,
    });
  }

  return results;
}

/**
 * Run an update for the given collection and then trigger a background embed pass.
 * Returns immediately once the update (hash scan + frontmatter sync) is complete.
 * The embed pass (model inference) continues in the background.
 *
 * If update() itself throws, the error propagates to the caller.
 * If embed throws (e.g. model still downloading), it is caught and logged.
 */
export async function updateAndEmbed(
  workspaceSlug: string,
  collection?: Collection,
): Promise<IndexResult[]> {
  const results = await update(workspaceSlug, collection);
  spawnEmbedPass(workspaceSlug);
  return results;
}
