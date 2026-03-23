'use client';

import { useCallback } from 'react';
import { RiSendPlaneLine, RiFileCopyLine, RiCodeLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSendToTerminal } from '@/components/terminal/use-send-to-terminal';
import { useExecutionStatus } from '@/hooks/use-execution-status';
import { trpc } from '@/lib/trpc';
import { generateDiffFeedback } from './feedback-markdown';
import type { DiffComment } from './use-diff-comments';

interface ReviewActionsProps {
  repoDir: string | null;
  diffComments: DiffComment[];
  taskId?: number;
}

export function ReviewActions({ repoDir, diffComments, taskId }: ReviewActionsProps) {
  const { sendToTerminal, terminalActive } = useSendToTerminal();
  const { status: sessionStatus, sessionId } = useExecutionStatus(
    'task',
    taskId ?? 0,
  );

  const runnerActive = taskId != null && (sessionStatus === 'active' || sessionStatus === 'paused');

  const sendFeedbackMutation = trpc.execution.sendFeedback.useMutation();

  const unresolvedThreads = diffComments.filter((c) => !c.resolved);

  const buildFeedback = useCallback(() => {
    if (!repoDir) return '';
    const threads = unresolvedThreads.map((c) => ({
      documentPath: c.documentPath,
      metadata: { lineNumber: c.lineNumber, codeLine: c.codeLine },
      resolved: c.resolved,
      comments: c.comments.map((cm) => ({
        body: cm.body,
        userId: cm.userId ?? undefined,
        createdAt: cm.createdAt ?? undefined,
      })),
    }));
    return generateDiffFeedback(threads, repoDir);
  }, [repoDir, unresolvedThreads]);

  const handleSendFeedback = useCallback(() => {
    const feedback = buildFeedback();
    if (!feedback) return;

    if (runnerActive && sessionId) {
      sendFeedbackMutation.mutate({ sessionId, feedback });
    } else {
      sendToTerminal(feedback);
    }
  }, [buildFeedback, runnerActive, sessionId, sendFeedbackMutation, sendToTerminal]);

  const handleCopyFeedback = useCallback(async () => {
    const feedback = buildFeedback();
    if (!feedback) return;
    await navigator.clipboard.writeText(feedback);
  }, [buildFeedback]);

  const handleOpenInVSCode = useCallback(() => {
    if (!repoDir) return;
    window.open(`vscode://file/${repoDir}`, '_blank');
  }, [repoDir]);

  const canSend = runnerActive ? !!sessionId : terminalActive;
  const sendLabel = runnerActive ? 'Send to Agent' : 'Send Feedback';

  function getSendTooltip() {
    if (unresolvedThreads.length === 0) return 'No unresolved comments to send';
    if (runnerActive) return `Send ${unresolvedThreads.length} comment(s) to runner agent`;
    if (!terminalActive) return 'No active terminal';
    return `Send ${unresolvedThreads.length} comment(s) to terminal`;
  }

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSendFeedback}
              disabled={unresolvedThreads.length === 0 || !canSend}
              className="h-7 gap-1.5 px-2 text-xs"
            >
              <RiSendPlaneLine className="size-3.5" />
              {sendLabel}
              {unresolvedThreads.length > 0 && (
                <span className="text-muted-foreground">({unresolvedThreads.length})</span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{getSendTooltip()}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyFeedback}
              disabled={unresolvedThreads.length === 0}
              className="h-7 w-7 p-0"
            >
              <RiFileCopyLine className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy feedback to clipboard</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleOpenInVSCode}
              disabled={!repoDir}
              className="h-7 w-7 p-0"
            >
              <RiCodeLine className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open in VS Code</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
