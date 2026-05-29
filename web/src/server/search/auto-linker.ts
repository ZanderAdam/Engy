import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { simpleGit } from 'simple-git';
import { getDb } from '../db/client';
import { workspaces, permanentMemories } from '../db/schema';
import { eq, and, ne } from 'drizzle-orm';
import { getWorkspaceDir } from '../engy-dir/init';
import { getStore } from './qmd-store';
import type { HybridQueryResult } from '@tobilu/qmd';
import { validateLinkedMemoryPath, escapeIndexMarkers } from '../lib/memory-files';

// ── Tunables ─────────────────────────────────────────────────────────

/** Minimum hybrid score for a candidate to receive a bidirectional link. */
export const SIMILARITY_THRESHOLD = 0.75;

/** Maximum number of relates_to links written per autoLink invocation. */
export const MAX_LINKS = 5;

// ── Helpers ───────────────────────────────────────────────────────────

function collectionFromVirtualPath(virtualPath: string): string {
  const match = /^qmd:\/\/([^/]+)/.exec(virtualPath);
  return match ? match[1] : 'memory';
}

/**
 * Read an existing memory file's frontmatter and body without validation errors.
 * Returns null if the file doesn't exist or can't be parsed.
 */
function readMemoryFileSafe(absPath: string): {
  fm: Record<string, unknown>;
  body: string;
} | null {
  if (!fs.existsSync(absPath)) return null;
  try {
    const raw = fs.readFileSync(absPath, 'utf8');
    const parsed = matter(raw);
    return { fm: parsed.data as Record<string, unknown>, body: parsed.content };
  } catch {
    return null;
  }
}

/**
 * Write a memory file's frontmatter back to disk, preserving the body.
 * Pushes the touched relative path into touchedPaths for later batched commit.
 */
function updateLinkedMemoriesInFile(
  workspaceDir: string,
  relFilePath: string,
  newLinkedMemories: string[],
  touchedPaths: string[],
): void {
  const absPath = path.isAbsolute(relFilePath)
    ? relFilePath
    : path.join(workspaceDir, relFilePath);

  const file = readMemoryFileSafe(absPath);
  if (!file) return;

  const updatedFm = { ...file.fm, linkedMemories: newLinkedMemories };
  const safeBody = escapeIndexMarkers(file.body);
  const fileContent = matter.stringify(safeBody, updatedFm);
  fs.writeFileSync(absPath, fileContent, 'utf8');

  const relPath = path.relative(workspaceDir, absPath).replace(/\\/g, '/');
  if (!touchedPaths.includes(relPath)) {
    touchedPaths.push(relPath);
  }
}

/**
 * Union a new path into an existing linkedMemories array (set semantics).
 */
function unionLinks(existing: string[], newPath: string): string[] {
  if (existing.includes(newPath)) return existing;
  return [...existing, newPath];
}

// ── Tag/theme co-linking ──────────────────────────────────────────────

/** Subtypes that are anchor documents rather than zettels — excluded from tag pass. */
const ANCHOR_SUBTYPES = new Set(['sources', 'references']);

/**
 * Count the number of overlapping items between two string arrays.
 */
function sharedCount(a: string[], b: string[]): number {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  const setB = new Set(b);
  return a.filter((item) => setB.has(item)).length;
}

/**
 * Secondary co-linking pass: find permanent memories in the same workspace
 * that share at least 2 tags or themes with the given memory.
 *
 * Returns candidates sorted by (shared count desc, updatedAt desc), limited to
 * `limit` entries. Excludes self, already-linked memories, and anchor subtypes.
 */
function findTagThemeSiblings(
  memoryId: number,
  workspaceId: number,
  tags: string[],
  themes: string[],
  alreadyLinked: string[],
  limit: number,
): Array<{ filePath: string; id: number; title: string; updatedAt: string }> {
  if (limit <= 0) return [];
  if (tags.length === 0 && themes.length === 0) return [];

  const db = getDb();
  const alreadyLinkedSet = new Set(alreadyLinked);

  const candidates = db
    .select({
      id: permanentMemories.id,
      filePath: permanentMemories.filePath,
      title: permanentMemories.title,
      subtype: permanentMemories.subtype,
      tags: permanentMemories.tags,
      themes: permanentMemories.themes,
      updatedAt: permanentMemories.updatedAt,
    })
    .from(permanentMemories)
    .where(and(eq(permanentMemories.workspaceId, workspaceId), ne(permanentMemories.id, memoryId)))
    .all();

  return candidates
    .flatMap((row) => {
      if (!row.filePath) return [];
      if (ANCHOR_SUBTYPES.has(row.subtype)) return [];
      if (alreadyLinkedSet.has(row.filePath)) return [];

      const shared =
        sharedCount(tags, (row.tags as string[]) ?? []) +
        sharedCount(themes, (row.themes as string[]) ?? []);
      if (shared < 2) return [];

      return [{ id: row.id, filePath: row.filePath, title: row.title, updatedAt: row.updatedAt, shared }];
    })
    .sort((a, b) => b.shared - a.shared || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)
    .map(({ filePath, id, title, updatedAt }) => ({ filePath, id, title, updatedAt }));
}

// ── Auto-link ─────────────────────────────────────────────────────────

/**
 * On memory creation or promotion, search the workspace's memory collection
 * for related memories and write bidirectional relates_to links.
 *
 * Fire-and-forget: catch all errors internally so callers are never blocked.
 */
export async function autoLink(memoryId: number, workspaceSlug: string): Promise<void> {
  const db = getDb();
  const memory = db.select().from(permanentMemories).where(eq(permanentMemories.id, memoryId)).get();
  if (!memory || !memory.filePath) return;

  const ws = db.select().from(workspaces).where(eq(workspaces.id, memory.workspaceId)).get();
  if (!ws) return;

  const workspaceDir = getWorkspaceDir(ws);
  const ownFilePath = memory.filePath;

  // ── Pass 1: similarity-based links ────────────────────────────────────
  // Skipped when QMD_SKIP=1 (e.g. during tests that only exercise the tag pass).

  const toLink: HybridQueryResult[] = [];

  if (process.env.QMD_SKIP !== '1') {
    const queryText = [memory.title, memory.content.slice(0, 500)].join(' ');

    let store;
    try {
      store = await getStore(workspaceSlug);
    } catch {
      // If the store fails to init, fall through to the tag pass only.
    }

    if (store) {
      let candidates: HybridQueryResult[] = [];
      try {
        candidates = await store.search({
          query: queryText,
          collection: 'memory',
          limit: 20,
          rerank: false,
        });
      } catch {
        candidates = [];
      }

      // Filter: above threshold, not self
      const eligible = candidates.filter((hit) => {
        if (hit.score < SIMILARITY_THRESHOLD) return false;
        const col = collectionFromVirtualPath(hit.file);
        const candidatePath = `${col}/${hit.displayPath}`;
        const normalizedOwn = ownFilePath.replace(/^memory\//, '');
        const normalizedCandidate = candidatePath.replace(/^memory\//, '');
        return normalizedOwn !== normalizedCandidate;
      });

      toLink.push(...eligible.slice(0, MAX_LINKS));
    }
  }

  const touchedPaths: string[] = [];

  for (const hit of toLink) {
    const col = collectionFromVirtualPath(hit.file);
    const candidateRelPath = `${col}/${hit.displayPath}`;

    // Validate both paths before touching any files
    let candidateAbsPath: string;
    try {
      validateLinkedMemoryPath(ownFilePath, workspaceDir);
      validateLinkedMemoryPath(candidateRelPath, workspaceDir);
      candidateAbsPath = path.join(workspaceDir, candidateRelPath);
    } catch {
      continue;
    }

    if (!fs.existsSync(candidateAbsPath)) continue;

    // Update source memory's linkedMemories (DB + file)
    const existingSrcLinks = (memory.linkedMemories as string[]) ?? [];
    const updatedSrcLinks = unionLinks(existingSrcLinks, candidateRelPath);

    if (updatedSrcLinks.length > existingSrcLinks.length) {
      try {
        updateLinkedMemoriesInFile(workspaceDir, ownFilePath, updatedSrcLinks, touchedPaths);
        db.update(permanentMemories)
          .set({ linkedMemories: updatedSrcLinks, updatedAt: new Date().toISOString() })
          .where(eq(permanentMemories.id, memoryId))
          .run();
        // Keep local state in sync for next iteration
        memory.linkedMemories = updatedSrcLinks;
      } catch {
        // non-fatal
      }
    }

    // Update candidate memory's linkedMemories (DB + file)
    const candidateRow = db
      .select()
      .from(permanentMemories)
      .where(eq(permanentMemories.filePath, candidateRelPath))
      .get();

    const existingCandLinks = (candidateRow?.linkedMemories as string[]) ?? [];
    const updatedCandLinks = unionLinks(existingCandLinks, ownFilePath);

    if (updatedCandLinks.length > existingCandLinks.length) {
      try {
        updateLinkedMemoriesInFile(workspaceDir, candidateRelPath, updatedCandLinks, touchedPaths);
        if (candidateRow) {
          db.update(permanentMemories)
            .set({ linkedMemories: updatedCandLinks, updatedAt: new Date().toISOString() })
            .where(eq(permanentMemories.id, candidateRow.id))
            .run();
        }
      } catch {
        // non-fatal
      }
    }
  }

  // ── Secondary pass: tag/theme siblings ────────────────────────────────
  // If the similarity pass left room under MAX_LINKS, fill with thematic siblings.

  const currentLinks = (memory.linkedMemories as string[]) ?? [];
  const remaining = MAX_LINKS - currentLinks.length;

  if (remaining > 0) {
    const srcTags = (memory.tags as string[]) ?? [];
    const srcThemes = (memory.themes as string[]) ?? [];
    const tagSiblings = findTagThemeSiblings(
      memoryId,
      memory.workspaceId,
      srcTags,
      srcThemes,
      currentLinks,
      remaining,
    );

    for (const sibling of tagSiblings) {
      // Validate path before touching files
      let siblingAbsPath: string;
      try {
        validateLinkedMemoryPath(sibling.filePath, workspaceDir);
        siblingAbsPath = path.join(workspaceDir, sibling.filePath);
      } catch {
        continue;
      }

      if (!fs.existsSync(siblingAbsPath)) continue;

      // Update source memory
      const latestSrcLinks = (memory.linkedMemories as string[]) ?? [];
      const updatedSrcLinks = unionLinks(latestSrcLinks, sibling.filePath);

      if (updatedSrcLinks.length > latestSrcLinks.length) {
        try {
          updateLinkedMemoriesInFile(workspaceDir, ownFilePath, updatedSrcLinks, touchedPaths);
          db.update(permanentMemories)
            .set({ linkedMemories: updatedSrcLinks, updatedAt: new Date().toISOString() })
            .where(eq(permanentMemories.id, memoryId))
            .run();
          memory.linkedMemories = updatedSrcLinks;
        } catch {
          // non-fatal
        }
      }

      // Update sibling memory
      const siblingRow = db
        .select()
        .from(permanentMemories)
        .where(eq(permanentMemories.id, sibling.id))
        .get();

      const existingSiblingLinks = (siblingRow?.linkedMemories as string[]) ?? [];
      const updatedSiblingLinks = unionLinks(existingSiblingLinks, ownFilePath);

      if (updatedSiblingLinks.length > existingSiblingLinks.length) {
        try {
          updateLinkedMemoriesInFile(workspaceDir, sibling.filePath, updatedSiblingLinks, touchedPaths);
          db.update(permanentMemories)
            .set({ linkedMemories: updatedSiblingLinks, updatedAt: new Date().toISOString() })
            .where(eq(permanentMemories.id, sibling.id))
            .run();
        } catch {
          // non-fatal
        }
      }
    }
  }

  // ── Batched commit ────────────────────────────────────────────────────
  if (touchedPaths.length > 0) {
    const git = simpleGit(workspaceDir);
    await git.add(touchedPaths);
    await git.commit(`memory(autolink): link ${memory.title}`);
  }
}
