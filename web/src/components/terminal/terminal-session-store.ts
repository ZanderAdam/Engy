'use client';

import { useSyncExternalStore } from 'react';
import type { TerminalTab } from './types';

interface TerminalSessionsSnapshot {
  tabs: TerminalTab[];
  activeId: string | null;
}

// The right-dock TerminalManager publishes its live tab list here (keyed by
// scope groupKey) so the always-mounted terminal rail can render the same
// sessions — with the same labels, OSC titles, and activity state — without a
// second data source. The manager stays mounted even when the dock is
// collapsed, so the rail's dots remain live.
const EMPTY: TerminalSessionsSnapshot = { tabs: [], activeId: null };
const byKey = new Map<string, TerminalSessionsSnapshot>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function publishTerminalSessions(key: string, snapshot: TerminalSessionsSnapshot): void {
  byKey.set(key, snapshot);
  emit();
}

export function clearTerminalSessions(key: string): void {
  if (!byKey.delete(key)) return;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTerminalSessions(key: string | undefined): TerminalSessionsSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => (key ? byKey.get(key) ?? EMPTY : EMPTY),
    () => EMPTY,
  );
}
