'use client';

import { useSyncExternalStore } from 'react';

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

function handleEvent(e: Event) {
  const { sessionId, activityState } = (e as CustomEvent<ActivityChangeDetail>).detail;
  if (stateMap.get(sessionId) === activityState) return;
  stateMap.set(sessionId, activityState);
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') {
  window.addEventListener('terminal:activity-changed', handleEvent);
}

const PRIORITY: Record<TerminalActivityState, number> = { idle: 0, active: 1, waiting: 2 };

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
