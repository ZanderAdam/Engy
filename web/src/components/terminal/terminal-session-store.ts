'use client';

import { useSyncExternalStore } from 'react';
import { railOrder, railSections } from './rail-order';
import type { TerminalTab } from './types';
import { readCollapsedRailGroups, subscribeCollapsedRailGroups } from './use-collapsed-rail-groups';
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
  collapsed: readonly string[] | undefined;
  tabs: TerminalTab[];
} = {
  snapshot: undefined,
  byWorktree: true,
  collapsed: undefined,
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
  const collapsed = readCollapsedRailGroups();
  if (
    visible === numberedCache.snapshot &&
    byWorktree === numberedCache.byWorktree &&
    collapsed === numberedCache.collapsed
  ) {
    return numberedCache.tabs;
  }
  const tabs = visible
    ? railOrder(railSections(visible.tabs, visible.commandCenter, byWorktree), collapsed)
    : [];
  numberedCache = { snapshot: visible, byWorktree, collapsed, tabs };
  return tabs;
}

function subscribeNumbered(listener: () => void): () => void {
  const unsubscribers = [
    subscribe(listener),
    subscribeWorktreeGrouping(listener),
    subscribeCollapsedRailGroups(listener),
  ];
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}

export function useNumberedTerminals(): TerminalTab[] {
  return useSyncExternalStore(subscribeNumbered, readNumberedTerminals, () => EMPTY.tabs);
}

let openTerminalsCache: TerminalTab[] = [];

/**
 * Every open terminal across all scopes and app tabs, each session once.
 * `useSyncExternalStore` compares snapshots by identity, so the flattened
 * array is cached and only rebuilt when its contents change.
 */
export function readOpenTerminals(): TerminalTab[] {
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

export function useOpenTerminals(): TerminalTab[] {
  return useSyncExternalStore(subscribe, readOpenTerminals, () => openTerminalsCache);
}

/** The 1-based number spoken as "focus terminal N", or null when not numbered. */
export function terminalOrdinal(tabs: TerminalTab[], sessionId: string): number | null {
  const index = tabs.findIndex((tab) => tab.sessionId === sessionId);
  return index === -1 ? null : index + 1;
}
