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

// Keyed by tab + scope so two browser tabs viewing the same scope (same
// groupKey) each get their own entry — otherwise one tab's unmount would clear
// the rail for the other.
export function terminalRailKey(tabId: string | null, groupKey: string): string {
  return `${tabId ?? 'default'}:${groupKey}`;
}

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
    () => (key ? (byKey.get(key) ?? EMPTY) : EMPTY),
    () => EMPTY,
  );
}

let openTerminalsCache: TerminalTab[] = [];

/**
 * Every open terminal across all scopes, in a stable order — the list voice
 * numbers against ("focus terminal 2"). Deliberately not the server's session
 * registry: focusing works by activating a dockview panel, so a session with
 * no open panel cannot be focused and must not take a number.
 *
 * `useSyncExternalStore` compares snapshots by identity, so the flattened
 * array is cached and only rebuilt when its contents actually change.
 */
function readOpenTerminals(): TerminalTab[] {
  const seen = new Set<string>();
  const next: TerminalTab[] = [];
  for (const snapshot of byKey.values()) {
    for (const tab of snapshot.tabs) {
      if (seen.has(tab.sessionId)) continue;
      seen.add(tab.sessionId);
      next.push(tab);
    }
  }

  const unchanged =
    next.length === openTerminalsCache.length &&
    next.every((tab, i) => tab === openTerminalsCache[i]);
  if (!unchanged) openTerminalsCache = next;
  return openTerminalsCache;
}

/** The flattening and its identity caching are what voice numbering rests
 * on; exported so both can be asserted without a React renderer. */
export const readOpenTerminalsForTest = readOpenTerminals;

export function useOpenTerminals(): TerminalTab[] {
  return useSyncExternalStore(subscribe, readOpenTerminals, () => openTerminalsCache);
}

/** The 1-based number spoken as "focus terminal N", or null when not open. */
export function terminalOrdinal(tabs: TerminalTab[], sessionId: string): number | null {
  const index = tabs.findIndex((tab) => tab.sessionId === sessionId);
  return index === -1 ? null : index + 1;
}
