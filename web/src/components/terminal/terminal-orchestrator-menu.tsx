'use client';

import { RiRobot2Line } from '@remixicon/react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { useOnServerEvent } from '@/contexts/events-context';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function TerminalOrchestratorMenu({
  activeSessionId,
  workspaceSlug,
}: {
  activeSessionId: string | undefined;
  workspaceSlug: string | undefined;
}) {
  const utils = trpc.useUtils();
  const { data: agents } = trpc.terminal.listWorkers.useQuery();
  useOnServerEvent('TERMINAL_WORKERS_CHANGE', () => {
    void utils.terminal.listWorkers.invalidate();
  });
  useOnServerEvent('TERMINAL_SESSIONS_CHANGE', () => {
    void utils.terminal.listWorkers.invalidate();
  });
  const refresh = () => utils.terminal.listWorkers.invalidate();
  const onError = (error: { message: string }) => toast.error(error.message);
  const setOrchestrator = trpc.terminal.setOrchestrator.useMutation({
    onSuccess: refresh,
    onError,
  });
  const setOptOut = trpc.terminal.setDispatchOptOut.useMutation({ onSuccess: refresh, onError });
  const startOrchestrator = trpc.terminal.startOrchestrator.useMutation({
    onSuccess: refresh,
    onError,
  });

  const active = agents?.find((agent) => agent.sessionId === activeSessionId);
  const orchestratorExists = agents?.some((agent) => agent.orchestrator) ?? false;
  const canToggle = active !== undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Orchestrator and dispatch settings"
          title="Orchestrator and dispatch settings"
          className={cn(
            'flex h-8 w-8 items-center justify-center border-l border-border',
            active?.orchestrator
              ? 'text-amber-400 hover:bg-muted'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <RiRobot2Line className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuCheckboxItem
          disabled={!canToggle}
          checked={active?.orchestrator === true}
          onCheckedChange={(enabled) =>
            activeSessionId && setOrchestrator.mutate({ sessionId: activeSessionId, enabled })
          }
        >
          Orchestrator (may dispatch to any agent terminal)
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          disabled={!canToggle}
          checked={active?.dispatchOptOut === true}
          onCheckedChange={(optOut) =>
            activeSessionId && setOptOut.mutate({ sessionId: activeSessionId, optOut })
          }
        >
          Block dispatch to this terminal
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!workspaceSlug || startOrchestrator.isPending}
          onClick={() => workspaceSlug && startOrchestrator.mutate({ workspaceSlug })}
        >
          {orchestratorExists
            ? 'Start a new orchestrator (replaces current)'
            : 'Start orchestrator'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
