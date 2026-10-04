'use client';

import { useSyncExternalStore } from 'react';
import { railOrder, railSections } from './rail-order';
import type { TerminalTab } from './types';
import { readWorktreeGrouping, subscribeWorktreeGrouping } from './use-worktree-grouping';

interface TerminalSessionsSnapshot {
  tabs: TerminalTab[];
  activeId: string | null;
  /** The publishing dock's app tab is the one on screen. */
  visible: boolean;
  commandCenter: boolean;
}

// The right-dock TerminalManager publishes its live tab list here (keyed by
// scope groupKey) so the always-mounted terminal rail can render the same
// sessions — with the same labels, OSC titles, and activity state — without a
// second data source. The manager stays mounted even when the dock is
// collapsed, so the rail's dots remain live.
const EMPTY: TerminalSessionsSnapshot = {
  tabs: [],
  activeId: null,
  visible: false,
  commandCenter: false,
};
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

let numberedCache: {
  snapshot: TerminalSessionsSnapshot | undefined;
  byWorktree: boolean;
  tabs: TerminalTab[];
} = {
  snapshot: undefined,
  byWorktree: true,
  tabs: [],
};

/**
 * The terminals that carry numbers ("focus terminal 2", Ctrl+Alt+2): the ones
 * the visible rail lists, top to bottom. Inactive app tabs stay mounted and keep
 * publishing, so only the visible snapshot counts — otherwise their terminals
 * would offset and gap the numbers the user sees.
 *
 * `useSyncExternalStore` compares snapshots by identity, so the result is
 * cached and only rebuilt when its inputs change.
 */
export function readNumberedTerminals(): TerminalTab[] {
  let visible: TerminalSessionsSnapshot | undefined;
  for (const snapshot of byKey.values()) {
    if (snapshot.visible) {
      visible = snapshot;
      break;
    }
  }
  const byWorktree = readWorktreeGrouping();
  if (visible === numberedCache.snapshot && byWorktree === numberedCache.byWorktree) {
    return numberedCache.tabs;
  }
  const tabs = visible
    ? railOrder(railSections(visible.tabs, visible.commandCenter, byWorktree))
    : [];
  numberedCache = { snapshot: visible, byWorktree, tabs };
  return tabs;
}

function subscribeNumbered(listener: () => void): () => void {
  const unsubscribeSessions = subscribe(listener);
  const unsubscribeGrouping = subscribeWorktreeGrouping(listener);
  return () => {
    unsubscribeSessions();
    unsubscribeGrouping();
  };
}

export function useNumberedTerminals(): TerminalTab[] {
  return useSyncExternalStore(subscribeNumbered, readNumberedTerminals, () => EMPTY.tabs);
}

/** The 1-based number spoken as "focus terminal N", or null when not numbered. */
export function terminalOrdinal(tabs: TerminalTab[], sessionId: string): number | null {
  const index = tabs.findIndex((tab) => tab.sessionId === sessionId);
  return index === -1 ? null : index + 1;
}
