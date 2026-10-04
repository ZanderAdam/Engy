'use client';

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'engy:terminal-rail-collapsed-groups:v1';
const EMPTY: ReadonlySet<string> = new Set();

let collapsed: ReadonlySet<string> = EMPTY;
let initialized = false;
const listeners = new Set<() => void>();

function ensureInit(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(ids)) collapsed = new Set(ids.filter((id) => typeof id === 'string'));
  } catch {
    collapsed = EMPTY;
  }
}

export function subscribeCollapsedRailGroups(listener: () => void): () => void {
  ensureInit();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readCollapsedRailGroups(): ReadonlySet<string> {
  ensureInit();
  return collapsed;
}

/**
 * Which rail groups are collapsed. Kept per browser: a phone and a laptop can
 * show the same groups open or closed independently.
 */
export function toggleRailGroupCollapsed(groupId: string): void {
  ensureInit();
  const next = new Set(collapsed);
  if (!next.delete(groupId)) next.add(groupId);
  collapsed = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // localStorage unavailable — the in-memory state still works for this session.
  }
  for (const listener of listeners) listener();
}

export function useCollapsedRailGroups(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeCollapsedRailGroups, readCollapsedRailGroups, () => EMPTY);
}
