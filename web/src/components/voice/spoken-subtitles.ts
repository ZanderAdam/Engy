import { useSyncExternalStore } from 'react';

const lastSpoken = new Map<string, string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function recordSpoken(sessionId: string, text: string): void {
  lastSpoken.set(sessionId, text);
  notify();
}

export function dismissSpoken(sessionId: string): void {
  if (lastSpoken.delete(sessionId)) notify();
}

export function readSpoken(sessionId: string): string | null {
  return lastSpoken.get(sessionId) ?? null;
}

export function useLastSpoken(sessionId: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => readSpoken(sessionId),
    () => null,
  );
}
