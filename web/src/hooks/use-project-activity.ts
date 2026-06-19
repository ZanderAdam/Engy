'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { TerminalActivityState } from '@engy/common';
import { useOnServerEvent } from '@/contexts/events-context';

interface ProjectActivityCounts {
  active: number;
  waiting: number;
  done: number;
}

const EMPTY: ProjectActivityCounts = { active: 0, waiting: 0, done: 0 };

// Daemon-computed terminal activity, keyed by session, rolled up per project.
// Seeded once from /api/terminal/activity and kept live via the
// TERMINAL_ACTIVITY_CHANGE broadcast — so badges reflect every project's
// terminals even when they aren't mounted in the browser.
const bySession = new Map<string, { projectSlug: string; state: TerminalActivityState }>();
const listeners = new Set<() => void>();
let rollup = new Map<string, ProjectActivityCounts>();

function recompute() {
  const next = new Map<string, ProjectActivityCounts>();
  for (const { projectSlug, state } of bySession.values()) {
    if (state === 'idle') continue;
    const c = next.get(projectSlug) ?? { active: 0, waiting: 0, done: 0 };
    if (state === 'active') c.active++;
    else if (state === 'waiting') c.waiting++;
    else if (state === 'done') c.done++;
    next.set(projectSlug, c);
  }
  rollup = next;
  for (const l of listeners) l();
}

interface ActivitySnapshot {
  sessionId: string;
  projectSlug?: string;
  state: TerminalActivityState;
}

function seed(sessions: ActivitySnapshot[]): void {
  bySession.clear();
  for (const s of sessions) {
    if (s.projectSlug) bySession.set(s.sessionId, { projectSlug: s.projectSlug, state: s.state });
  }
  recompute();
}

function apply(sessionId: string, projectSlug: string, state: TerminalActivityState): void {
  bySession.set(sessionId, { projectSlug, state });
  recompute();
}

function remove(sessionId: string): void {
  if (bySession.delete(sessionId)) recompute();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Per-project activity counts for one project. Re-renders on live updates. */
export function useProjectActivity(projectSlug: string | undefined): ProjectActivityCounts {
  return useSyncExternalStore(
    subscribe,
    () => (projectSlug ? rollup.get(projectSlug) ?? EMPTY : EMPTY),
    () => EMPTY,
  );
}

/**
 * Drives the project-activity store: seed once from the snapshot endpoint, then
 * apply live deltas. Mount exactly once inside the EventsProvider (the workspace
 * layout) — every <ProjectActivityBadge> reads from the shared store.
 */
export function useProjectActivityFeed(): void {
  useEffect(() => {
    let cancelled = false;
    fetch('/api/terminal/activity')
      .then((r) => (r.ok ? r.json() : { sessions: [] }))
      .then((d: { sessions?: ActivitySnapshot[] }) => {
        if (!cancelled) seed(d.sessions ?? []);
      })
      .catch(() => {
        /* best-effort: live broadcast will still populate */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useOnServerEvent(
    'TERMINAL_ACTIVITY_CHANGE',
    useCallback((p) => {
      if (p.removed) remove(p.sessionId);
      else if (p.state && p.projectSlug) apply(p.sessionId, p.projectSlug, p.state);
    }, []),
  );
}
