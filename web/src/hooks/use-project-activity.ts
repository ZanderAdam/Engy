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

export function useProjectActivity(
  workspaceSlug: string | undefined,
  projectSlug: string | undefined,
): ProjectActivityCounts {
  return useSyncExternalStore(
    subscribe,
    () =>
      workspaceSlug && projectSlug ? getProjectCounts(workspaceSlug, projectSlug) : EMPTY_COUNTS,
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
 * are lost, so the snapshot is the only way to heal. Mount once per workspace
 * layout: every <ProjectActivityBadge> reads from the shared store.
 */
export function useProjectActivityFeed(): void {
  useEffect(seedFromSnapshot, []);
  useOnEventsConnect(seedFromSnapshot);

  useOnServerEvent(
    'TERMINAL_ACTIVITY_CHANGE',
    useCallback((p) => {
      if (p.removed) {
        remove(p.sessionId);
        return;
      }
      if (p.state && p.sessionWorkspaceSlug && p.projectSlug) {
        apply(p.sessionId, p.sessionWorkspaceSlug, p.projectSlug, p.state);
      }
    }, []),
  );
}
