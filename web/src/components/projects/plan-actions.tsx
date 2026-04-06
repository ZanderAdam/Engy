'use client';

import { useCallback, useMemo, useRef } from 'react';
import { RiCheckLine, RiChat3Line, RiTerminalLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSendToTerminal } from '@/components/terminal/use-send-to-terminal';
import { useExecutionStatus } from '@/hooks/use-execution-status';
import { formatCommentsForExport } from '@/components/editor/format-comments';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

interface ThreadLike {
  resolved: boolean;
  deletedAt?: Date | null;
  metadata?: Record<string, unknown>;
  comments: Array<{ deletedAt?: Date | null; body: unknown }>;
}

interface PlanActionsProps {
  taskId: number;
  taskSlug: string;
  threads: Map<string, ThreadLike>;
  /** False until the thread store has finished its initial DB load. */
  threadsReady: boolean;
  /**
   * Returns the latest plan markdown synchronously. Callers should flush any
   * pending debounced autosave in the implementation so actions always operate
   * on fresh content even right after a keystroke.
   */
  getMarkdown: () => string;
}

export function PlanActions({
  taskId,
  taskSlug,
  threads,
  threadsReady,
  getMarkdown,
}: PlanActionsProps) {
  const { sendToTerminal, terminalActive } = useSendToTerminal();
  const { status, sessionId, isActive, isStarting, start } = useExecutionStatus('task', taskId);

  const sendFeedbackMutation = trpc.execution.sendFeedback.useMutation({
    onSuccess: () => toast.success('Feedback sent to planning session'),
    onError: (err) => toast.error('Failed to send feedback', { description: err.message }),
  });

  const pushRemoteFileMutation = trpc.execution.pushRemoteFile.useMutation();

  const planFilePath = `plans/${taskSlug}.plan.md`;
  const planningSessionActive = isActive || status === 'paused';

  // Ref-based re-entry guard. Disabled-state checks reading React state can let
  // two same-frame clicks through before a re-render propagates.
  const busyRef = useRef(false);

  const hasComments = useMemo(() => {
    for (const [, thread] of threads) {
      if (thread.deletedAt || thread.resolved) continue;
      if (thread.comments.some((c) => !c.deletedAt)) return true;
    }
    return false;
  }, [threads]);

  const approveDisabled =
    planningSessionActive || isStarting || pushRemoteFileMutation.isPending;
  const sendToSessionDisabled =
    !sessionId ||
    !threadsReady ||
    !hasComments ||
    sendFeedbackMutation.isPending ||
    pushRemoteFileMutation.isPending;

  let sendToSessionTooltip: string;
  if (!sessionId) {
    sendToSessionTooltip = 'No active planning session';
  } else if (!threadsReady) {
    sendToSessionTooltip = 'Loading comments\u2026';
  } else if (!hasComments) {
    sendToSessionTooltip = 'No comments to send';
  } else {
    sendToSessionTooltip = 'Send comments to the planning session';
  }

  const handleApproveAndImplement = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await pushRemoteFileMutation.mutateAsync({ taskId, content: getMarkdown() });
      start();
    } catch (err) {
      toast.error('Failed to start implementation', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      busyRef.current = false;
    }
  }, [pushRemoteFileMutation, taskId, getMarkdown, start]);

  const handleSendToSession = useCallback(async () => {
    if (busyRef.current || !sessionId) return;
    const markdown = getMarkdown();
    const feedback = formatCommentsForExport({ threads, markdown, filePath: planFilePath });
    if (!feedback) return;

    busyRef.current = true;
    try {
      await pushRemoteFileMutation.mutateAsync({ taskId, content: markdown });
      sendFeedbackMutation.mutate({ sessionId, feedback });
    } catch (err) {
      toast.error('Failed to push plan file', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      busyRef.current = false;
    }
  }, [
    sessionId,
    threads,
    planFilePath,
    getMarkdown,
    pushRemoteFileMutation,
    taskId,
    sendFeedbackMutation,
  ]);

  const handleSendToTerminal = useCallback(() => {
    const markdown = getMarkdown();
    const feedback = formatCommentsForExport({ threads, markdown, filePath: planFilePath });
    if (!feedback) return;
    sendToTerminal(feedback);
  }, [getMarkdown, threads, planFilePath, sendToTerminal]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleApproveAndImplement}
              disabled={approveDisabled}
              className="h-7 gap-1.5 px-2 text-xs"
            >
              <RiCheckLine className="size-3.5" />
              Approve &amp; Implement
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {planningSessionActive
              ? 'Planning session is still active'
              : 'Start implementation from this plan'}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSendToSession}
              disabled={sendToSessionDisabled}
              className="h-7 gap-1.5 px-2 text-xs"
            >
              <RiChat3Line className="size-3.5" />
              Send to Task Session
            </Button>
          </TooltipTrigger>
          <TooltipContent>{sendToSessionTooltip}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSendToTerminal}
              disabled={!terminalActive}
              className="h-7 gap-1.5 px-2 text-xs"
            >
              <RiTerminalLine className="size-3.5" />
              Send to Active Terminal
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {terminalActive ? 'Send comments to terminal' : 'No active terminal'}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
