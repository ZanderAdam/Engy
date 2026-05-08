import fs from 'node:fs';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { getDb } from '../db/client';
import { workspaces } from '../db/schema';
import { eq } from 'drizzle-orm';
import { getWorkspaceDir, initMemoryDirs } from './init';
import { update as indexerUpdate } from '../search/indexer';

/**
 * Ensures an existing pre-M7 workspace has the full M7 directory and README
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

  initMemoryDirs(workspaceDir);

  // Commit any newly created files if inside a git repo
  const git = simpleGit(workspaceDir);
  const status = await git.status();
  if (status.files.length > 0) {
    await git.add('.');
    await git.commit('memory(init): backfill M7 directories');
  }

  // Populate the qmd store and frontmatter table for this workspace.
  try {
    await indexerUpdate(workspaceSlug);
  } catch (err) {
    console.error(`[backfillM7] indexer update failed for ${workspaceSlug}:`, err);
  }
}

/**
 * Returns true if the workspace looks like it was created before M7
 * (has a memory/ dir but no memory/README.md).
 */
export function needsM7Backfill(workspaceDir: string): boolean {
  const memoryDir = path.join(workspaceDir, 'memory');
  const memoryReadme = path.join(memoryDir, 'README.md');
  return fs.existsSync(memoryDir) && !fs.existsSync(memoryReadme);
}

