'use client';

import { useMemo } from 'react';
import { RiGitBranchLine } from '@remixicon/react';
import { trpc } from '@/lib/trpc';
import type { TerminalDropdownGroup } from './types';

export function useWorktreeSessions(workspaceSlug: string): TerminalDropdownGroup | undefined {
  const { data } = trpc.execution.getWorktreeSessions.useQuery(
    { workspaceSlug },
    { enabled: !!workspaceSlug },
  );

  return useMemo(() => {
    if (!data?.sessions.length) return undefined;

    const entries = data.sessions.map((session) => {
      const dirName = session.worktreePath.split('/').filter(Boolean).pop() ?? session.worktreePath;
      return {
        id: `worktree:${session.sessionId}`,
        label: dirName,
        tooltip: session.worktreePath,
        scope: {
          scopeType: 'worktree' as const,
          scopeLabel: dirName,
          workingDir: session.worktreePath,
          groupKey: `worktree:${workspaceSlug}`,
          workspaceSlug,
        },
        icon: RiGitBranchLine,
      };
    });

    return { label: 'Worktrees', entries };
  }, [data, workspaceSlug]);
}
