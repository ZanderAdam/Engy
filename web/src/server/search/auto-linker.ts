import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { simpleGit } from 'simple-git';
import { getDb } from '../db/client';
import { workspaces, permanentMemories } from '../db/schema';
import { eq } from 'drizzle-orm';
import { getWorkspaceDir } from '../engy-dir/init';
import { getStore } from './qmd-store';
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
 * Write a memory file's frontmatter back to disk and commit, preserving the body.
 * Used to update linkedMemories without touching timestamps or filenames.
 */
async function updateLinkedMemoriesInFile(
  workspaceDir: string,
  relFilePath: string,
  newLinkedMemories: string[],
  title: string,
): Promise<void> {
  const absPath = path.isAbsolute(relFilePath)
    ? relFilePath
    : path.join(workspaceDir, relFilePath);

  const file = readMemoryFileSafe(absPath);
  if (!file) return;

  const updatedFm = { ...file.fm, linkedMemories: newLinkedMemories };
  const safeBody = escapeIndexMarkers(file.body);
  const fileContent = matter.stringify(safeBody, updatedFm);
  fs.writeFileSync(absPath, fileContent, 'utf8');

  const git = simpleGit(workspaceDir);
  const relPath = path.relative(workspaceDir, absPath).replace(/\\/g, '/');
  await git.add([relPath]);
  await git.commit(`memory(autolink): ${title}\n\nmemory_id: ${relPath}`, {
    '--allow-empty': null,
  });
}

/**
 * Union a new path into an existing linkedMemories array (set semantics).
 */
function unionLinks(existing: string[], newPath: string): string[] {
  if (existing.includes(newPath)) return existing;
  return [...existing, newPath];
}

// ── Auto-link ─────────────────────────────────────────────────────────

/**
 * On memory creation or promotion, search the workspace's memory collection
 * for related memories and write bidirectional relates_to links.
 *
 * Fire-and-forget: catch all errors internally so callers are never blocked.
 */
export async function autoLink(memoryId: number, workspaceSlug: string): Promise<void> {
  if (process.env.QMD_SKIP === '1') return;

  const db = getDb();
  const memory = db.select().from(permanentMemories).where(eq(permanentMemories.id, memoryId)).get();
  if (!memory || !memory.filePath) return;

  const ws = db.select().from(workspaces).where(eq(workspaces.id, memory.workspaceId)).get();
  if (!ws) return;

  const workspaceDir = getWorkspaceDir(ws);

  // Build a query from title + first 500 chars of content for relevance
  const queryText = [memory.title, memory.content.slice(0, 500)].join(' ');

  let store;
  try {
    store = await getStore(workspaceSlug);
  } catch {
    return;
  }

  let candidates;
  try {
    candidates = await store.search({
      query: queryText,
      collection: 'memory',
      limit: 20,
      rerank: false,
    });
  } catch {
    return;
  }

  const ownFilePath = memory.filePath;

  // Filter: above threshold, not self
  const eligible = candidates.filter((hit) => {
    if (hit.score < SIMILARITY_THRESHOLD) return false;
    const col = collectionFromVirtualPath(hit.file);
    const candidatePath = `${col}/${hit.displayPath}`;
    // Normalize both to avoid mismatch with leading memory/ prefix
    const normalizedOwn = ownFilePath.replace(/^memory\//, '');
    const normalizedCandidate = candidatePath.replace(/^memory\//, '');
    return normalizedOwn !== normalizedCandidate;
  });

  const toLink = eligible.slice(0, MAX_LINKS);

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
        await updateLinkedMemoriesInFile(workspaceDir, ownFilePath, updatedSrcLinks, memory.title);
        db.update(permanentMemories)
          .set({ linkedMemories: updatedSrcLinks, updatedAt: new Date().toISOString() })
          .where(eq(permanentMemories.id, memoryId))
          .run();
        // Keep local state in sync for next iteration
        (memory.linkedMemories as string[]) = updatedSrcLinks;
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
        const candidateTitle = candidateRow?.title ?? hit.title ?? 'memory';
        await updateLinkedMemoriesInFile(
          workspaceDir,
          candidateRelPath,
          updatedCandLinks,
          candidateTitle,
        );
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
}
