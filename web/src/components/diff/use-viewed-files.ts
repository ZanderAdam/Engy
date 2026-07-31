'use client';

import { useCallback, useMemo, useState } from 'react';

const STORAGE_KEY = 'engy:diff-viewed-files:v2';
// Bounds growth as branches and projects come and go; least recently written first.
const MAX_SCOPES = 20;

/** path → contentId the file held when it was marked viewed. */
type ViewedScope = Record<string, string>;
type ViewedStore = Record<string, ViewedScope>;

interface ViewedScopeInput {
  workspaceSlug: string | null;
  projectSlug: string | null;
  /** Effective checkout — the worktree path when one is active, else the repo. */
  dir: string | null;
  /** What is being diffed: a base branch, a commit hash, or 'latest'. */
  base: string | null;
}

export function scopeKey({
  workspaceSlug,
  projectSlug,
  dir,
  base,
}: ViewedScopeInput): string | null {
  if (!workspaceSlug || !projectSlug || !dir || !base) return null;
  return [workspaceSlug, projectSlug, dir, base].join('::');
}

export function readStore(raw: string | null): ViewedStore {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const store: ViewedStore = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const scope: ViewedScope = {};
      for (const [path, contentId] of Object.entries(value as Record<string, unknown>)) {
        if (typeof contentId === 'string') scope[path] = contentId;
      }
      store[key] = scope;
    }
    return store;
  } catch {
    return {};
  }
}

export function writeScope(store: ViewedStore, key: string, scope: ViewedScope): ViewedStore {
  // Re-insert the touched scope last so trimming drops least-recently-used keys.
  const next: ViewedStore = {};
  for (const [existingKey, existingScope] of Object.entries(store)) {
    if (existingKey !== key) next[existingKey] = existingScope;
  }
  next[key] = scope;

  const keys = Object.keys(next);
  if (keys.length <= MAX_SCOPES) return next;
  const trimmed: ViewedStore = {};
  for (const k of keys.slice(keys.length - MAX_SCOPES)) trimmed[k] = next[k];
  return trimmed;
}

/**
 * A mark holds only while the file still carries the content it had when ticked,
 * so re-editing a reviewed file makes it unreviewed again. Files whose id is
 * unknown (deleted, or hashing failed) fall back to a stable empty id.
 */
export function resolveViewedPaths(
  scope: ViewedScope,
  contentIds: Map<string, string | undefined>,
): Set<string> {
  const viewed = new Set<string>();
  for (const [path, markedId] of Object.entries(scope)) {
    if ((contentIds.get(path) ?? '') === markedId) viewed.add(path);
  }
  return viewed;
}

/**
 * Records or clears marks for a set of paths, stamping each with the content it
 * currently holds. Files with no id (deleted, directories) record an empty id,
 * which `resolveViewedPaths` treats as "still absent".
 */
export function applyViewed(
  scope: ViewedScope,
  paths: string[],
  viewed: boolean,
  contentIds: Map<string, string | undefined>,
): ViewedScope {
  const next = { ...scope };
  for (const path of paths) {
    if (viewed) {
      next[path] = contentIds.get(path) ?? '';
    } else {
      delete next[path];
    }
  }
  return next;
}

function persist(store: ViewedStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage may be full or unavailable — viewed state is not critical.
  }
}

function loadStore(): ViewedStore {
  if (typeof window === 'undefined') return {};
  return readStore(localStorage.getItem(STORAGE_KEY));
}

/**
 * Tracks which files the user has marked reviewed, scoped to workspace, project,
 * checkout and what is being diffed, and invalidated by file content.
 */
export function useViewedFiles(
  scopeInput: ViewedScopeInput,
  contentIds: Map<string, string | undefined>,
) {
  const [store, setStore] = useState<ViewedStore>(loadStore);
  const key = scopeKey(scopeInput);

  const viewedPaths = useMemo(
    () => resolveViewedPaths(key ? (store[key] ?? {}) : {}, contentIds),
    [store, key, contentIds],
  );

  const setViewed = useCallback(
    (paths: string[], viewed: boolean) => {
      if (!key || paths.length === 0) return;
      setStore((prev) => {
        const next = writeScope(prev, key, applyViewed(prev[key] ?? {}, paths, viewed, contentIds));
        persist(next);
        return next;
      });
    },
    [key, contentIds],
  );

  // Reads the current state inside the updater rather than from the memoized
  // `viewedPaths`, so the toggle stays a self-contained read-modify-write even
  // if two calls land in the same React batch.
  const toggleViewed = useCallback(
    (path: string) => {
      if (!key) return;
      setStore((prev) => {
        const scope = prev[key] ?? {};
        const isViewed = resolveViewedPaths(scope, contentIds).has(path);
        const next = writeScope(prev, key, applyViewed(scope, [path], !isViewed, contentIds));
        persist(next);
        return next;
      });
    },
    [key, contentIds],
  );

  return { viewedPaths, toggleViewed, setViewed };
}
