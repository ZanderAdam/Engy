'use client';

import { RiRobot2Line } from '@remixicon/react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { useTabId, useVirtualNavigate } from '@/components/tabs/tab-context';
import { requestTerminalFocus } from './focus-confirmation';
import { parseGroupKey } from './group-key';
import { orchestratorButtonAction } from './orchestrator-button-action';
import { useAgentTerminals } from './use-agent-terminals';
import type { TerminalScope } from './types';

export function TerminalOrchestratorButton({
  activeSessionId,
  dockSessionIds,
  scope,
}: {
  activeSessionId: string | undefined;
  dockSessionIds: readonly string[];
  scope: TerminalScope | undefined;
}) {
  const tabId = useTabId();
  const { push } = useVirtualNavigate();
  const { agents, refresh } = useAgentTerminals();

  function focus(sessionId: string) {
    requestTerminalFocus({
      sessionId,
      tabId,
      dock: 'terminal',
      onMissing: () =>
        toast.error('The orchestrator is open in another view. Open it from the terminal rail.'),
    });
  }

  const startOrchestrator = trpc.terminal.startOrchestrator.useMutation({
    onSuccess: ({ sessionId }) => {
      refresh();
      focus(sessionId);
    },
    onError: (error) => toast.error(error.message),
  });

  const action = orchestratorButtonAction(agents, {
    workspaceSlug: scope?.workspaceSlug,
    projectSlug: scope?.projectSlug,
  });
  const isOrchestratorActive = action.kind === 'focus' && action.sessionId === activeSessionId;
  const label = action.kind === 'focus' ? 'Focus orchestrator' : 'Start orchestrator';

  function onClick() {
    if (action.kind === 'focus') {
      // In split mode another worktree's dock can hold the orchestrator; the link page switches to it.
      if (dockSessionIds.includes(action.sessionId)) focus(action.sessionId);
      else push(`/t/${encodeURIComponent(action.sessionId)}`);
      return;
    }
    if (!scope?.workspaceSlug) return;
    const dockBranch = parseGroupKey(scope.groupKey)?.worktreeBranch;
    startOrchestrator.mutate({
      workspaceSlug: scope.workspaceSlug,
      projectSlug: scope.projectSlug,
      worktreeBranch: dockBranch,
      workingDir: dockBranch ? scope.workingDir : undefined,
    });
  }

  return (
    <button
      onClick={onClick}
      disabled={!scope?.workspaceSlug || startOrchestrator.isPending}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-8 w-8 items-center justify-center border-l border-border disabled:opacity-50',
        isOrchestratorActive
          ? 'text-amber-400 hover:bg-muted'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <RiRobot2Line className="size-3" />
    </button>
  );
}
