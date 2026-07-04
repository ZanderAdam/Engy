'use client';

import { useSyncExternalStore } from 'react';

// Global, cross-tab toggle: when on, every terminal sidebar (right panel) across
// all in-app project tabs shows the Command Center — the live view of every
// terminal in every project — instead of the current project's terminals. It's
// a module singleton so all mounted panels stay in sync, persisted to
// localStorage, and mirrored across browser tabs via the `storage` event.
const STORAGE_KEY = 'engy:command-center-mode:v1';

// Shared groupKey the global dock publishes its session snapshot under and the
// rail reads from while Command Center mode is on (in place of the per-project
// groupKey), so the two stay in sync across the toggle.
export const COMMAND_CENTER_GROUP_KEY = '__command_center__';

let enabled = false;
let initialized = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function ensureInit(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  enabled = window.localStorage.getItem(STORAGE_KEY) === '1';
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    const next = e.newValue === '1';
    if (next === enabled) return;
    enabled = next;
    emit();
  });
}

function subscribe(listener: () => void): () => void {
  ensureInit();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setCommandCenterMode(next: boolean): void {
  ensureInit();
  if (enabled === next) return;
  enabled = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
  } catch {
    // localStorage unavailable — in-memory toggle still works for this session.
  }
  emit();
}

export function useCommandCenterMode(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => enabled,
    () => false,
  );
}
