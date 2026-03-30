'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

export interface TaskTerminalSession {
  sessionId: string;
  scopeLabel: string;
  taskId: number;
}

interface SessionResponse {
  sessionId: string;
  scopeType: string;
  scopeLabel: string;
  workingDir: string;
  command?: string;
  groupKey?: string;
  workspaceSlug?: string;
  taskId?: number;
  status: 'active' | 'suspended';
  browserCount: number;
}

export function useTaskTerminals(groupKey: string | undefined) {
  const { data: sessions } = useQuery({
    queryKey: ['terminal-sessions', groupKey],
    queryFn: async () => {
      const params = new URLSearchParams({ groupKey: groupKey! });
      const res = await fetch(`/api/terminal/sessions?${params}`);
      if (!res.ok) return [];
      const data = (await res.json()) as { sessions: SessionResponse[] };
      return data.sessions;
    },
    enabled: !!groupKey,
    refetchInterval: 5_000,
  });

  return useMemo(() => {
    const map = new Map<number, TaskTerminalSession[]>();
    if (!sessions) return map;

    for (const s of sessions) {
      if (s.taskId == null) continue;
      const entry: TaskTerminalSession = {
        sessionId: s.sessionId,
        scopeLabel: s.scopeLabel,
        taskId: s.taskId,
      };
      const existing = map.get(s.taskId);
      if (existing) {
        existing.push(entry);
      } else {
        map.set(s.taskId, [entry]);
      }
    }

    return map;
  }, [sessions]);
}
