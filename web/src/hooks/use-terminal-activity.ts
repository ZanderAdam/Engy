'use client';

import { useSyncExternalStore } from 'react';
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
