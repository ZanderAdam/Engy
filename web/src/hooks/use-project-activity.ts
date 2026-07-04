'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useOnEventsConnect, useOnServerEvent } from '@/contexts/events-context';
import {
  EMPTY_COUNTS,
  apply,
  getProjectCounts,
  remove,
  seed,
  subscribe,
  type ActivitySnapshot,
  type ProjectActivityCounts,
} from './project-activity-store';

/** Per-project activity counts for one project. Re-renders on live updates. */
export function useProjectActivity(projectSlug: string | undefined): ProjectActivityCounts {
  return useSyncExternalStore(
    subscribe,
    () => (projectSlug ? getProjectCounts(projectSlug) : EMPTY_COUNTS),
    () => EMPTY_COUNTS,
  );
}

function seedFromSnapshot(): void {
  fetch('/api/terminal/activity')
    .then((r) => (r.ok ? r.json() : { sessions: [] }))
    .then((d: { sessions?: ActivitySnapshot[] }) => {
      seed(d.sessions ?? []);
    })
    .catch(() => {
      /* best-effort: live broadcast will still populate */
    });
}

/**
 * Drives the project-activity store: seed from the snapshot endpoint on mount
 * and on every events-socket (re)connect — deltas broadcast while disconnected
 * are lost, so the snapshot is the only way to heal. Mount exactly once inside
 * the EventsProvider (the workspace layout) — every <ProjectActivityBadge>
 * reads from the shared store.
 */
export function useProjectActivityFeed(): void {
  useEffect(seedFromSnapshot, []);
  useOnEventsConnect(seedFromSnapshot);

  useOnServerEvent(
    'TERMINAL_ACTIVITY_CHANGE',
    useCallback((p) => {
      if (p.removed) remove(p.sessionId);
      else if (p.state && p.projectSlug) apply(p.sessionId, p.projectSlug, p.state);
    }, []),
  );
}
