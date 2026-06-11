import fs from 'node:fs';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { getDb } from '../db/client';
import { workspaces } from '../db/schema';
import { eq } from 'drizzle-orm';
import { getWorkspaceDir, initMemoryDirs } from './init';
import { update as indexerUpdate } from '../search/indexer';

/**
 * Ensures a workspace has the full knowledge-layer directory and README
 * structure. Creates anything missing using the same logic as fresh init, then
 * commits the additions. Safe to run on already-migrated workspaces — it skips
 * directories and READMEs that already exist.
 */
export async function backfillM7(workspaceSlug: string): Promise<void> {
  const db = getDb();
  const workspace = db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, workspaceSlug))
    .get();

  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceSlug}`);
  }

  const workspaceDir = getWorkspaceDir(workspace);

  if (!fs.existsSync(workspaceDir)) {
    throw new Error(`Workspace directory does not exist: ${workspaceDir}`);
  }

  // Ensure the qmd binary search store is not committed to the workspace git repo.
  const gitignorePath = path.join(workspaceDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, '.qmd/\n', 'utf8');
  } else {
    const existing = fs.readFileSync(gitignorePath, 'utf8');
    if (!existing.includes('.qmd')) {
      fs.writeFileSync(gitignorePath, `${existing}.qmd/\n`, 'utf8');
    }
  }

  // Capture untracked/modified paths before init so we know exactly what to stage.
  // --untracked-files=all expands untracked directories so files inside a new
  // memory/ dir are listed individually rather than collapsed to one entry.
  const git = simpleGit(workspaceDir);
  const beforeStatus = await git.status(['--untracked-files=all']);
  const beforePaths = new Set(beforeStatus.files.map((f) => f.path));

  initMemoryDirs(workspaceDir);

  // Populate the qmd store and frontmatter table for this workspace. This also
  // (re)generates the system/ README index files, so it must run BEFORE the
  // commit — otherwise those README writes are left uncommitted and a second
  // backfill run would commit them, breaking idempotency.
  try {
    await indexerUpdate(workspaceSlug);
  } catch (err) {
    console.error(`[backfillM7] indexer update failed for ${workspaceSlug}:`, err);
  }

  // Stage only the paths created/modified by this backfill, not any pre-existing user changes.
  const afterStatus = await git.status(['--untracked-files=all']);
  const newPaths = afterStatus.files
    .map((f) => f.path)
    .filter((p) => !beforePaths.has(p));

  if (newPaths.length > 0) {
    await git.add(newPaths);
    await git.commit('memory(init): backfill knowledge-layer directories');
  }
}

/**
 * Returns true if memory/README.md is absent — regardless of whether memory/ exists.
 * This catches both pre-M7 workspaces that already have a memory/ dir and fresh
 * workspaces that never had one (both need the backfill).
 */
export function needsM7Backfill(workspaceDir: string): boolean {
  const memoryReadme = path.join(workspaceDir, 'memory', 'README.md');
  return !fs.existsSync(memoryReadme);
}

