'use client';

import { useCallback, useMemo } from 'react';
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
  markdown: string;
}

export function PlanActions({ taskId, taskSlug, threads, markdown }: PlanActionsProps) {
  const { sendToTerminal, terminalActive } = useSendToTerminal();
  const { status, sessionId, isActive, isStarting, start } = useExecutionStatus('task', taskId);

  const sendFeedbackMutation = trpc.execution.sendFeedback.useMutation({
    onSuccess: () => toast.success('Feedback sent to planning session'),
    onError: (err) => toast.error('Failed to send feedback', { description: err.message }),
  });

  const pushRemoteFileMutation = trpc.execution.pushRemoteFile.useMutation();

  const planFilePath = `plans/${taskSlug}.plan.md`;
  const planningSessionActive = isActive || status === 'paused';
  const approveDisabled = planningSessionActive || isStarting || pushRemoteFileMutation.isPending;

  const buildFormattedComments = useCallback(
    () => formatCommentsForExport({ threads, markdown, filePath: planFilePath }),
    [threads, markdown, planFilePath],
  );

  const hasComments = useMemo(() => {
    for (const [, thread] of threads) {
      if (thread.deletedAt || thread.resolved) continue;
      if (thread.comments.some((c) => !c.deletedAt)) return true;
    }
    return false;
  }, [threads]);

  const pushPlanFile = useCallback(
    () => pushRemoteFileMutation.mutateAsync({ taskId, content: markdown }),
    [taskId, markdown, pushRemoteFileMutation],
  );

  const handleApproveAndImplement = useCallback(async () => {
    try {
      await pushPlanFile();
      start();
    } catch (err) {
      toast.error('Failed to start implementation', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [pushPlanFile, start]);

  const handleSendToSession = useCallback(async () => {
    if (!sessionId) return;
    const feedback = buildFormattedComments();
    if (!feedback) return;

    try {
      await pushPlanFile();
      sendFeedbackMutation.mutate({ sessionId, feedback });
    } catch (err) {
      toast.error('Failed to push plan file', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [sessionId, buildFormattedComments, pushPlanFile, sendFeedbackMutation]);

  const handleSendToTerminal = useCallback(() => {
    const feedback = buildFormattedComments();
    if (!feedback) return;
    sendToTerminal(feedback);
  }, [buildFormattedComments, sendToTerminal]);

  const canSendToSession = !!sessionId && hasComments;
  const sendToSessionDisabled =
    !canSendToSession || sendFeedbackMutation.isPending || pushRemoteFileMutation.isPending;

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
          <TooltipContent>
            {!sessionId
              ? 'No active planning session'
              : !hasComments
                ? 'No comments to send'
                : 'Send comments to the planning session'}
          </TooltipContent>
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
