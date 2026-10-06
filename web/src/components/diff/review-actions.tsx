'use client';

import { useCallback, useMemo } from 'react';
import { RiSendPlaneLine, RiFileCopyLine, RiCodeLine, RiRobot2Line } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSendToTerminal } from '@/components/terminal/use-send-to-terminal';
import { LiveCommentsToggle } from '@/components/terminal/live-comments-toggle';
import { useExecutionStatus } from '@/hooks/use-execution-status';
import { useCommentDelivery } from '@/hooks/use-comment-delivery';
import { isPendingComment } from '@/lib/comment-feedback';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/clipboard';
import { generateDiffFeedback } from '@/lib/diff-feedback';
import { buildReviewPrompt } from '@/lib/review-prompt';
import type { DiffComment } from './use-diff-comments';
import type { GitPatchSpec } from '@engy/common';

interface ReviewActionsProps {
  repoDir: string | null;
  /** Thread path prefix of the branch under review; empty when unknown. */
  scopePrefix: string;
  diffComments: DiffComment[];
  taskId?: number;
  /**
   * The whole diff on screen, so the agent reviews what you see. Leave it out
   * where there is no reviewable scope, which hides "Review diff".
   */
  reviewSpec?: GitPatchSpec | null;
  worktreePath?: string;
  coderWorkspace?: string;
  projectId?: number;
}

export function ReviewActions({
  repoDir,
  scopePrefix,
  diffComments,
  taskId,
  reviewSpec,
  worktreePath,
  coderWorkspace,
  projectId,
}: ReviewActionsProps) {
  const { sendToTerminal, terminalActive } = useSendToTerminal();
  const { status: sessionStatus, sessionId } = useExecutionStatus('task', taskId ?? 0);

  const runnerActive = taskId != null && (sessionStatus === 'active' || sessionStatus === 'paused');

  const utils = trpc.useUtils();
  const sendFeedbackMutation = trpc.execution.sendFeedback.useMutation();
  const markSentMutation = trpc.comment.markSent.useMutation();

  const { data: reviewGuide } = trpc.project.reviewGuide.useQuery(
    { projectId: projectId ?? 0 },
    { enabled: projectId != null },
  );

  const unresolvedThreads = useMemo(() => diffComments.filter((c) => !c.resolved), [diffComments]);

  const scope = useMemo(
    () => (scopePrefix ? { documentPath: scopePrefix, prefix: true } : null),
    [scopePrefix],
  );
  const delivery = useCommentDelivery(scope);

  const { pendingThreadIds, pendingCount } = useMemo(() => {
    const ids: string[] = [];
    let count = 0;
    for (const thread of unresolvedThreads) {
      const pending = thread.comments.filter((c, i) => isPendingComment(c, i === 0)).length;
      if (pending === 0) continue;
      ids.push(thread.threadId);
      count += pending;
    }
    return { pendingThreadIds: ids, pendingCount: count };
  }, [unresolvedThreads]);

  const buildFeedback = useCallback(() => {
    if (!repoDir) return '';
    const threads = unresolvedThreads.map((c) => ({
      id: c.threadId,
      documentPath: c.documentPath,
      metadata: { lineNumber: c.lineNumber, codeLine: c.codeLine },
      resolved: c.resolved,
      comments: c.comments,
    }));
    return generateDiffFeedback(threads);
  }, [repoDir, unresolvedThreads]);

  const sendToRunner = useCallback(
    async (runnerSessionId: string) => {
      if (!scope) return;
      try {
        const { text, commentIds } = await utils.comment.pendingFeedback.fetch(
          {
            scope,
            threadIds: pendingThreadIds,
          },
          { staleTime: 0 },
        );
        if (!text) {
          toast.info('No new comments to send');
          return;
        }
        await sendFeedbackMutation.mutateAsync({ sessionId: runnerSessionId, feedback: text });
        await markSentMutation.mutateAsync({ commentIds });
        toast.success('Feedback sent to agent');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    [scope, utils, pendingThreadIds, sendFeedbackMutation, markSentMutation],
  );

  const handleSendFeedback = useCallback(() => {
    if (runnerActive && sessionId) {
      void sendToRunner(sessionId);
    } else {
      delivery.send({ threadIds: pendingThreadIds });
    }
  }, [runnerActive, sessionId, sendToRunner, delivery, pendingThreadIds]);

  const handleCopyFeedback = useCallback(async () => {
    const feedback = buildFeedback();
    if (!feedback) return;
    const ok = await copyToClipboard(feedback);
    if (!ok) toast.error('Copy failed — clipboard unavailable');
  }, [buildFeedback]);

  const canReview = !!repoDir && !!reviewSpec && !coderWorkspace && terminalActive;

  const handleReviewDiff = useCallback(() => {
    if (!repoDir || !reviewSpec) return;
    sendToTerminal(
      buildReviewPrompt({
        repoDir,
        worktreePath,
        spec: reviewSpec,
        reviewGuide: reviewGuide?.path ?? undefined,
      }),
    );
  }, [repoDir, worktreePath, reviewSpec, reviewGuide, sendToTerminal]);

  function getReviewTooltip() {
    if (coderWorkspace) return 'Review is not available for Coder workspaces';
    if (!reviewSpec) return 'Nothing to review yet — pick a commit or wait for the diff to load';
    if (!terminalActive) return 'No active terminal';
    return 'Review the diff on screen and leave findings on the lines';
  }

  const handleOpenInVSCode = useCallback(() => {
    if (!repoDir) return;
    window.open(`vscode://file/${repoDir}`, '_blank');
  }, [repoDir]);

  const canSend = runnerActive ? !!sessionId : terminalActive;
  const sendLabel = runnerActive ? 'Send to Agent' : 'Send Feedback';

  function getSendTooltip() {
    if (pendingCount === 0) return 'No new comments to send';
    if (runnerActive) return `Send ${pendingCount} new comment(s) to runner agent`;
    if (!terminalActive) return 'No active terminal';
    return `Send ${pendingCount} new comment(s) to terminal`;
  }

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1">
        {reviewSpec !== undefined && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReviewDiff}
                  disabled={!canReview}
                  className="h-7 gap-1.5 px-2 text-xs"
                >
                  <RiRobot2Line className="size-3.5" />
                  Review diff
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{getReviewTooltip()}</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSendFeedback}
              disabled={pendingCount === 0 || !canSend || !scope || delivery.isSending}
              className="h-7 gap-1.5 px-2 text-xs"
            >
              <RiSendPlaneLine className="size-3.5" />
              {sendLabel}
              {pendingCount > 0 && <span className="text-muted-foreground">({pendingCount})</span>}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{getSendTooltip()}</TooltipContent>
        </Tooltip>

        {scope && (
          <LiveCommentsToggle
            live={!!delivery.liveSessionId}
            liveLabel={delivery.liveLabel}
            terminalActive={terminalActive}
            busy={delivery.isTogglingLive}
            onToggle={() => delivery.toggleLive()}
            withText
          />
        )}

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
