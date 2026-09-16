'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { TerminalActivityState } from '@/components/terminal/types';

interface ActivityChangeDetail {
  sessionId: string;
  activityState: TerminalActivityState;
}

type Listener = () => void;

const stateMap = new Map<string, TerminalActivityState>();
const listeners = new Set<Listener>();

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setActivity(sessionId: string, activityState: TerminalActivityState): void {
  if (stateMap.get(sessionId) === activityState) return;
  stateMap.set(sessionId, activityState);
  for (const listener of listeners) listener();
}

function handleEvent(e: Event) {
  const { sessionId, activityState } = (e as CustomEvent<ActivityChangeDetail>).detail;
  setActivity(sessionId, activityState);
}

if (typeof window !== 'undefined') {
  window.addEventListener('terminal:activity-changed', handleEvent);
}

/**
 * Feeds a server-broadcast (TERMINAL_ACTIVITY_CHANGE) activity state into this
 * store. This is a hook-driven session's only path in — TerminalManager
 * suppresses its local-tracker emission for those sessions rather than
 * racing this with the heuristic's own verdict.
 */
export function applyServerActivity(sessionId: string, activityState: TerminalActivityState): void {
  setActivity(sessionId, activityState);
}

// Rollup urgency (after herdr's Blocked > Working > Done > Idle ordering):
// a waiting (blocked) session dominates, then active work, then done/unseen.
const PRIORITY: Record<TerminalActivityState, number> = { idle: 0, done: 1, active: 2, waiting: 3 };

function getHighestPriority(sessionIds: string[]): TerminalActivityState {
  let highest: TerminalActivityState = 'idle';
  for (const id of sessionIds) {
    const state = stateMap.get(id) ?? 'idle';
    if (PRIORITY[state] > PRIORITY[highest]) highest = state;
  }
  return highest;
}

export function useTerminalActivity(sessionIds: string[]): TerminalActivityState {
  return useSyncExternalStore(
    subscribe,
    () => getHighestPriority(sessionIds),
    () => 'idle' as const,
  );
}

function buildActivities(sessionIds: string[]): Record<string, TerminalActivityState> {
  const out: Record<string, TerminalActivityState> = {};
  for (const id of sessionIds) out[id] = stateMap.get(id) ?? 'idle';
  return out;
}

export function useTerminalActivities(
  sessionIds: string[],
): Record<string, TerminalActivityState> {
  const key = sessionIds.join('|');
  const [snapshot, setSnapshot] = useState(() => buildActivities(sessionIds));

  useEffect(() => {
    const ids = key ? key.split('|') : [];
    function rebuild() {
      setSnapshot((prev) => {
        const next = buildActivities(ids);
        const prevKeys = Object.keys(prev);
        if (prevKeys.length !== ids.length) return next;
        for (const id of ids) {
          if (prev[id] !== next[id]) return next;
        }
        return prev;
      });
    }
    rebuild();
    listeners.add(rebuild);
    return () => {
      listeners.delete(rebuild);
    };
  }, [key]);

  return snapshot;
}
