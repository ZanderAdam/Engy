'use client';

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOnEventsConnect, useOnServerEvent } from '@/contexts/events-context';
import type { SessionListItem } from '@/components/terminal/session-to-tab';
import { projectTerminals } from '@/components/terminal/terminal-board-model';

const ALL_SESSIONS_KEY = ['terminal-sessions', 'all'];

async function fetchAllSessions(): Promise<SessionListItem[]> {
  const res = await fetch('/api/terminal/sessions?all=1');
  if (!res.ok) throw new Error(`Failed to load terminal sessions: ${res.status}`);
  const data = (await res.json()) as { sessions: SessionListItem[] };
  return data.sessions;
}

export function useProjectTerminals(
  workspaceSlug: string,
  projectSlug: string,
): SessionListItem[] | undefined {
  const queryClient = useQueryClient();
  const { data: sessions } = useQuery({
    queryKey: ALL_SESSIONS_KEY,
    queryFn: fetchAllSessions,
    // Events sent while this hook is unmounted are lost, so a cached list is never fresh.
    staleTime: 0,
  });

  // needsAttention has no broadcast of its own, so an activity event also refetches the list.
  const refetch = () => {
    void queryClient.invalidateQueries({ queryKey: ALL_SESSIONS_KEY });
  };
  useOnServerEvent('TERMINAL_SESSIONS_CHANGE', refetch);
  useOnServerEvent('TERMINAL_ACTIVITY_CHANGE', (payload) => {
    if (payload.projectSlug && payload.projectSlug !== projectSlug) return;
    refetch();
  });
  useOnEventsConnect(refetch);

  return useMemo(
    () => sessions && projectTerminals(sessions, workspaceSlug, projectSlug),
    [sessions, workspaceSlug, projectSlug],
  );
}
