'use client';

import { useCallback, useMemo, useState } from 'react';

const STORAGE_KEY = 'engy:diff-viewed-files';
// Bounds growth as branches come and go; oldest scopes are dropped first.
const MAX_SCOPES = 20;

type ViewedStore = Record<string, string[]>;

/**
 * `dir` is the effective checkout (worktree path when one is active, else the
 * repo). Two worktrees of the same repo are separate reviews even on the same
 * base, so the checkout has to be part of the key.
 */
export function scopeKey(dir: string | null, base: string | null): string | null {
  if (!dir || !base) return null;
  return `${dir}::${base}`;
}

export function readStore(raw: string | null): ViewedStore {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const store: ViewedStore = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(value)) store[key] = value.filter((v): v is string => typeof v === 'string');
    }
    return store;
  } catch {
    return {};
  }
}

export function writeScope(store: ViewedStore, key: string, paths: string[]): ViewedStore {
  // Re-insert the touched scope last so trimming drops least-recently-used keys.
  const next: ViewedStore = {};
  for (const [existingKey, existingPaths] of Object.entries(store)) {
    if (existingKey !== key) next[existingKey] = existingPaths;
  }
  next[key] = paths;
  const keys = Object.keys(next);
  if (keys.length <= MAX_SCOPES) return next;
  const trimmed: ViewedStore = {};
  for (const k of keys.slice(keys.length - MAX_SCOPES)) trimmed[k] = next[k];
  return trimmed;
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
 * Tracks which files the user has marked reviewed, scoped to a checkout + base
 * ref so switching branches or worktrees doesn't inherit another review's
 * progress.
 */
export function useViewedFiles(dir: string | null, base: string | null) {
  const [store, setStore] = useState<ViewedStore>(loadStore);
  const key = scopeKey(dir, base);

  const viewedPaths = useMemo(
    () => new Set(key ? (store[key] ?? []) : []),
    [store, key],
  );

  const setViewed = useCallback(
    (paths: string[]) => {
      if (!key) return;
      setStore((prev) => {
        const next = writeScope(prev, key, paths);
        persist(next);
        return next;
      });
    },
    [key],
  );

  const toggleViewed = useCallback(
    (path: string) => {
      const next = new Set(viewedPaths);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      setViewed([...next]);
    },
    [viewedPaths, setViewed],
  );

  return { viewedPaths, toggleViewed };
}
