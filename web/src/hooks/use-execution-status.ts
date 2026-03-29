'use client';

import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';

type Scope = 'task' | 'taskGroup' | 'milestone';

export function useExecutionStatus(scope: Scope, id: number | string) {
  const utils = trpc.useUtils();

  const { data } = trpc.execution.getSessionStatus.useQuery(
    { scope, id },
    {
      refetchInterval: (query) => {
        const s = query.state.data?.status;
        if (s === 'active') return 10_000;
        // Brief poll for submitted sessions waiting for completionSummary
        if (s === 'submitted' && !query.state.data?.completionSummary) return 3_000;
        return false;
      },
    },
  );

  const status = data?.status ?? null;
  const sessionId = data?.sessionId ?? null;
  const completionSummary = data?.completionSummary ?? null;
  const isActive = status === 'active';
  const isSubmitted = status === 'submitted';

  const startMutation = trpc.execution.startExecution.useMutation({
    onSuccess: () => {
      utils.execution.getSessionStatus.invalidate({ scope, id });
    },
    onError: (err) => {
      toast.error('Failed to start execution', { description: err.message });
      utils.execution.getSessionStatus.invalidate({ scope, id });
    },
  });

  const stopMutation = trpc.execution.stopExecution.useMutation({
    onSuccess: () => {
      utils.execution.getSessionStatus.invalidate({ scope, id });
    },
    onError: (err) => {
      toast.error('Failed to stop execution', { description: err.message });
      utils.execution.getSessionStatus.invalidate({ scope, id });
    },
  });

  function start(options?: { remote?: boolean }) {
    startMutation.mutate({ scope, id, remote: options?.remote });
  }

  function stop() {
    if (sessionId) {
      stopMutation.mutate({ sessionId });
    }
  }

  return {
    status,
    sessionId,
    completionSummary,
    isActive,
    isSubmitted,
    isStarting: startMutation.isPending,
    isStopping: stopMutation.isPending,
    start,
    stop,
  };
}
