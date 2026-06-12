import path from 'node:path';
import fs from 'node:fs';
import { createStore, type QMDStore } from '@tobilu/qmd';
import { getWorkspaceDir } from '../engy-dir/init';

const storeCache = new Map<string, QMDStore>();
const inflightCreations = new Map<string, Promise<QMDStore>>();

/**
 * Context descriptions for each collection — used at store creation and when
 * restoring contexts after forceFullReindex.
 */
export const COLLECTION_CONTEXTS: Record<string, string> = {
  system:
    'System documentation: architectural decisions, technical overviews, feature specifications, and workspace-level design docs.',
  docs: 'Shared reference docs: guides, runbooks, API references, and team knowledge not tied to a specific project.',
  projects:
    'Project documents: specs, vision docs, implementation plans, milestone breakdowns, and project context notes.',
  memory:
    'Permanent memory notes: decisions with rationale, patterns, conventions, facts, insights, and source references.',
};

/**
 * Returns the qmd store for the given workspace, creating it lazily on first access.
 * One store per workspace slug, cached for the process lifetime.
 *
 * The qmd database lives at {workspaceDir}/.qmd/qmd.db, where workspaceDir
 * honors the workspace's docsDir (custom path or default {ENGY_DIR}/{slug}).
 * Collections are scoped to the workspace directory with path-specific context
 * descriptions that steer hybrid search relevance.
 *
 * Concurrent first-accesses for the same slug share a single creation promise
 * to prevent opening the same SQLite file twice.
 */
export async function getStore(workspace: {
  slug: string;
  docsDir: string | null;
}): Promise<QMDStore> {
  const workspaceSlug = workspace.slug;

  if (storeCache.has(workspaceSlug)) {
    return storeCache.get(workspaceSlug)!;
  }

  if (inflightCreations.has(workspaceSlug)) {
    return inflightCreations.get(workspaceSlug)!;
  }

  const workspaceDir = getWorkspaceDir(workspace);
  const qmdDir = path.join(workspaceDir, '.qmd');
  const dbPath = path.join(qmdDir, 'qmd.db');

  fs.mkdirSync(qmdDir, { recursive: true });

  const creation = createStore({
    dbPath,
    config: {
      collections: {
        system: {
          path: path.join(workspaceDir, 'system'),
          pattern: '**/*.md',
          context: { '.': COLLECTION_CONTEXTS.system },
        },
        docs: {
          path: path.join(workspaceDir, 'docs'),
          pattern: '**/*.md',
          context: { '.': COLLECTION_CONTEXTS.docs },
        },
        projects: {
          path: path.join(workspaceDir, 'projects'),
          pattern: '**/*.md',
          context: { '.': COLLECTION_CONTEXTS.projects },
        },
        memory: {
          path: path.join(workspaceDir, 'memory'),
          pattern: '**/*.md',
          context: { '.': COLLECTION_CONTEXTS.memory },
        },
      },
    },
  }).then(
    (store) => {
      storeCache.set(workspaceSlug, store);
      inflightCreations.delete(workspaceSlug);
      return store;
    },
    (err) => {
      inflightCreations.delete(workspaceSlug);
      throw err;
    },
  );

  inflightCreations.set(workspaceSlug, creation);
  return creation;
}

/**
 * Returns the path to the qmd database for the given workspace.
 * Useful for diagnostics and integration tests.
 */
export function getQmdDbPath(workspace: { slug: string; docsDir: string | null }): string {
  const workspaceDir = getWorkspaceDir(workspace);
  return path.join(workspaceDir, '.qmd', 'qmd.db');
}

/**
 * Removes the cached store for a workspace and closes it to release DB resources.
 * The next call to getStore will re-initialize.
 * Call this after renaming or deleting a workspace.
 *
 * Also cancels any in-flight creation so a store opened concurrently with the
 * eviction is closed immediately instead of being re-populated into the cache.
 */
export function evictStore(workspaceSlug: string): void {
  const store = storeCache.get(workspaceSlug);
  storeCache.delete(workspaceSlug);
  if (store) {
    store.close().catch((err) => {
      console.warn(`[qmd-store] failed to close evicted store for "${workspaceSlug}":`, err);
    });
  }

  const inflight = inflightCreations.get(workspaceSlug);
  inflightCreations.delete(workspaceSlug);
  if (inflight) {
    inflight.then(
      (s) => {
        // The creation's own .then may have already re-populated the cache;
        // remove it so a post-eviction getStore gets a fresh store.
        storeCache.delete(workspaceSlug);
        s.close().catch(() => undefined);
      },
      () => undefined,
    );
  }
}

// Exposed for tests that need to reset state between runs.
export function _resetStoreCache(): void {
  for (const store of storeCache.values()) {
    store.close().catch(() => undefined);
  }
  storeCache.clear();
  inflightCreations.clear();
}
