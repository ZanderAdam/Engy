import path from 'node:path';
import type { WebSocket } from 'ws';
import { getDb } from '../db/client';
import { workspaces } from '../db/schema';
import { eq } from 'drizzle-orm';
import { getWorkspaceDir } from '../engy-dir/init';
import type { AppState } from '../trpc/context';

export const WATCH_SYNC_DEBOUNCE_MS = 300;

interface SubscribePayload {
  subscriptions: Array<{ workspaceSlug: string; paths: string[] }>;
}

function isAbsoluteNoTraversal(p: string): boolean {
  if (!path.isAbsolute(p)) return false;
  const segments = p.split(path.sep);
  return !segments.includes('..');
}

function resolveDocsDir(slug: string): string | null {
  try {
    const db = getDb();
    const workspace = db.select().from(workspaces).where(eq(workspaces.slug, slug)).get();
    if (!workspace) return null;
    return getWorkspaceDir(workspace);
  } catch {
    return null;
  }
}

function isUnderDocsDir(p: string, docsDir: string): boolean {
  const normalizedDocs = path.resolve(docsDir);
  const normalizedPath = path.resolve(p);
  return (
    normalizedPath === normalizedDocs ||
    normalizedPath.startsWith(normalizedDocs + path.sep)
  );
}

export function handleWatchSubscribe(
  state: AppState,
  ws: WebSocket,
  payload: unknown,
): void {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !Array.isArray((payload as SubscribePayload).subscriptions)
  ) {
    return;
  }

  const subscriptions = (payload as SubscribePayload).subscriptions;

  const validatedSubs = new Map<string, Set<string>>();

  for (const entry of subscriptions) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof entry.workspaceSlug !== 'string' ||
      !Array.isArray(entry.paths)
    ) {
      continue;
    }

    const { workspaceSlug, paths } = entry as { workspaceSlug: string; paths: unknown[] };

    const docsDir = resolveDocsDir(workspaceSlug);
    if (!docsDir) continue;

    const validPaths = new Set<string>();
    for (const p of paths) {
      if (typeof p !== 'string') continue;
      if (!isAbsoluteNoTraversal(p)) continue;
      if (!isUnderDocsDir(p, docsDir)) continue;
      validPaths.add(p);
    }

    if (validPaths.size > 0) {
      validatedSubs.set(workspaceSlug, validPaths);
    }
  }

  state.watchSubscriptions.set(ws, validatedSubs);
  scheduleWatchSync(state);
}

export function dropWatchSocket(state: AppState, ws: WebSocket): void {
  state.watchSubscriptions.delete(ws);
  scheduleWatchSync(state);
}

export function computeWatchUnion(
  state: AppState,
): Array<{ slug: string; paths: string[] }> {
  const union = new Map<string, Set<string>>();

  for (const socketSubs of state.watchSubscriptions.values()) {
    for (const [slug, paths] of socketSubs) {
      let existing = union.get(slug);
      if (!existing) {
        existing = new Set<string>();
        union.set(slug, existing);
      }
      for (const p of paths) {
        existing.add(p);
      }
    }
  }

  return Array.from(union.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, paths]) => ({
      slug,
      paths: Array.from(paths).sort(),
    }));
}

function scheduleWatchSync(state: AppState): void {
  if (state.watchSyncTimer !== null) {
    clearTimeout(state.watchSyncTimer);
  }
  state.watchSyncTimer = setTimeout(() => {
    state.watchSyncTimer = null;
    sendWatchPathsSync(state);
  }, WATCH_SYNC_DEBOUNCE_MS);
}

export function sendWatchPathsSync(
  state: AppState,
  opts?: { force?: boolean },
): void {
  if (!state.daemon || state.daemon.readyState !== state.daemon.OPEN) return;

  const union = computeWatchUnion(state);
  const serialized = JSON.stringify(union);

  if (!opts?.force && serialized === state.lastSentWatchPaths) return;

  state.lastSentWatchPaths = serialized;
  state.daemon.send(
    JSON.stringify({
      type: 'WATCH_PATHS_SYNC',
      payload: { workspaces: union },
    }),
  );
}
