'use client';

import { useCallback, useMemo, useRef } from 'react';
import { RiCheckLine, RiChat3Line, RiTerminalLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useExecutionStatus } from '@/hooks/use-execution-status';
import { useCommentDelivery } from '@/hooks/use-comment-delivery';
import type { CommentScopeInput } from '@/lib/comment-feedback';
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
  /** Project-relative path of the plan file, resolved by useTaskHasPlan. */
  planFilePath: string;
  threads: Map<string, ThreadLike>;
  /** Where the plan's comment threads live; null until the thread store exists. */
  commentScope: CommentScopeInput | null;
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
  planFilePath,
  threads,
  commentScope,
  threadsReady,
  getMarkdown,
}: PlanActionsProps) {
  const delivery = useCommentDelivery(commentScope);
  const { terminalActive } = delivery;
  const { status, sessionId, isActive, isStarting, start } = useExecutionStatus('task', taskId);

  const utils = trpc.useUtils();
  const sendFeedbackMutation = trpc.execution.sendFeedback.useMutation();
  const markSentMutation = trpc.comment.markSent.useMutation();

  const pushRemoteFileMutation = trpc.execution.pushRemoteFile.useMutation();

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

  const approveDisabled = planningSessionActive || isStarting || pushRemoteFileMutation.isPending;
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
    if (busyRef.current || !sessionId || !commentScope) return;
    busyRef.current = true;
    try {
      const markdown = getMarkdown();
      const { text, commentIds } = await utils.comment.pendingFeedback.fetch(
        {
          scope: commentScope,
          markdown,
          filePath: planFilePath,
        },
        { staleTime: 0 },
      );
      if (!text) {
        toast.info('No new comments to send');
        return;
      }
      await pushRemoteFileMutation.mutateAsync({ taskId, content: markdown });
      await sendFeedbackMutation.mutateAsync({ sessionId, feedback: text });
      await markSentMutation.mutateAsync({ commentIds });
      toast.success('Feedback sent to planning session');
    } catch (err) {
      toast.error('Failed to send feedback', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      busyRef.current = false;
    }
  }, [
    sessionId,
    commentScope,
    getMarkdown,
    utils,
    planFilePath,
    pushRemoteFileMutation,
    taskId,
    sendFeedbackMutation,
    markSentMutation,
  ]);

  const handleSendToTerminal = useCallback(() => {
    delivery.send({ markdown: getMarkdown(), filePath: planFilePath });
  }, [delivery, getMarkdown, planFilePath]);

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
              disabled={!terminalActive || !commentScope || delivery.isSending}
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
