'use client';

import { RiForbidLine } from '@remixicon/react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { dispatchBlockState } from './dispatch-block-state';
import { useAgentTerminals } from './use-agent-terminals';

export function TerminalDispatchBlockButton({
  activeSessionId,
}: {
  activeSessionId: string | undefined;
}) {
  const { agents, refresh } = useAgentTerminals();
  const setOptOut = trpc.terminal.setDispatchOptOut.useMutation({
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });

  const { enabled, blocked } = dispatchBlockState(agents, activeSessionId);
  const label = blocked ? 'Allow dispatch to this terminal' : 'Block dispatch to this terminal';

  function onClick() {
    if (!activeSessionId) return;
    setOptOut.mutate({ sessionId: activeSessionId, optOut: !blocked });
  }

  return (
    <button
      onClick={onClick}
      disabled={!enabled || setOptOut.isPending}
      aria-label={label}
      aria-pressed={blocked}
      title={label}
      className={cn(
        'flex h-8 w-8 items-center justify-center border-l border-border disabled:opacity-50',
        blocked
          ? 'text-red-400 hover:bg-muted'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <RiForbidLine className="size-3" />
    </button>
  );
}
