'use client';

import { useCallback, useMemo, useState } from 'react';
import { RiGithubLine, RiSendPlaneLine, RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { useSendToTerminal } from '@/components/terminal/use-send-to-terminal';
import { cn } from '@/lib/utils';
import { generateGithubFeedback } from './feedback-markdown';
import {
  filterUnresolvedGithubThreads,
  getSelectedThreads,
  allGithubThreadIds,
} from './github-triage-helpers';
import { extractFilePathFromDocPath } from './use-diff-comments';
import type { DiffComment } from './use-diff-comments';

interface GithubCommentTriageProps {
  repoDir: string;
  diffComments: DiffComment[];
  sessionId?: string | null;
  onResolve: (threadId: string) => Promise<void>;
}

function getBodyText(body: unknown): string {
  if (typeof body === 'string') return body;
  return JSON.stringify(body);
}

export function GithubCommentTriage({
  repoDir,
  diffComments,
  sessionId,
  onResolve,
}: GithubCommentTriageProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);

  const { sendToTerminal, terminalActive } = useSendToTerminal();

  const sendFeedbackMutation = trpc.execution.sendFeedback.useMutation({
    onSuccess: () => toast.success('Feedback sent to agent'),
    onError: (err) => toast.error(err.message),
  });

  const githubThreads = useMemo(
    () => filterUnresolvedGithubThreads(diffComments),
    [diffComments],
  );

  const selectedThreadsList = useMemo(
    () => getSelectedThreads(diffComments, selectedIds),
    [diffComments, selectedIds],
  );

  const handleFixSelected = useCallback(() => {
    if (selectedThreadsList.length === 0) return;
    const feedback = generateGithubFeedback(
      selectedThreadsList.map((t) => ({
        documentPath: t.documentPath,
        lineNumber: t.lineNumber,
        githubAuthor: t.githubAuthor,
        githubUrl: t.githubUrl,
        comments: t.comments.map((c) => ({
          body: c.body,
          userId: c.userId,
          createdAt: c.createdAt,
        })),
      })),
      repoDir,
    );
    if (!feedback) return;

    if (sessionId) {
      sendFeedbackMutation.mutate({ sessionId, feedback });
    } else {
      sendToTerminal(feedback);
    }
  }, [selectedThreadsList, repoDir, sessionId, sendFeedbackMutation, sendToTerminal]);

  if (githubThreads.length === 0) return null;

  const selectedCount = selectedThreadsList.length;
  const canFix = selectedCount > 0 && (!!sessionId || terminalActive);

  const handleToggle = (threadId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  };

  const handleSelectAll = () => setSelectedIds(allGithubThreadIds(diffComments));
  const handleClearAll = () => setSelectedIds(new Set());

  const handleDismiss = async (threadId: string) => {
    try {
      await onResolve(threadId);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(threadId);
        return next;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to dismiss comment');
    }
  };

  const handleDismissSelected = async () => {
    try {
      for (const thread of selectedThreadsList) {
        await onResolve(thread.threadId);
      }
      setSelectedIds(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to dismiss comments');
    }
  };

  function getFixTooltip() {
    if (selectedCount === 0) return 'Select comments to fix';
    if (sessionId) return `Send ${selectedCount} comment(s) to agent`;
    if (terminalActive) return `Send ${selectedCount} comment(s) to terminal`;
    return 'No active session or terminal';
  }

  return (
    <TooltipProvider>
      <div className="border-b border-border">
        <div className="flex items-center gap-2 px-3 py-1.5">
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? (
              <RiArrowDownSLine className="size-3.5" />
            ) : (
              <RiArrowRightSLine className="size-3.5" />
            )}
            <RiGithubLine className="size-3.5" />
            <span>
              {githubThreads.length} GitHub review comment
              {githubThreads.length === 1 ? '' : 's'}
            </span>
            {selectedCount > 0 && (
              <span className="text-foreground">— {selectedCount} selected</span>
            )}
          </button>

          <div className="ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleFixSelected}
                  disabled={!canFix}
                  className="h-7 gap-1.5 px-2 text-xs"
                >
                  <RiSendPlaneLine className="size-3.5" />
                  Fix Selected
                  {selectedCount > 0 && (
                    <span className="text-muted-foreground">({selectedCount})</span>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{getFixTooltip()}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDismissSelected}
                  disabled={selectedCount === 0}
                  className="h-7 px-2 text-xs text-muted-foreground"
                >
                  Dismiss ({selectedCount})
                </Button>
              </TooltipTrigger>
              <TooltipContent>Locally dismiss selected comments (no GitHub write-back)</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {expanded && (
          <div className="border-t border-border/50 bg-muted/10">
            <div className="flex items-center gap-2 px-3 py-1 text-[10px] text-muted-foreground">
              <button type="button" onClick={handleSelectAll} className="hover:text-foreground">
                Select all
              </button>
              <span>·</span>
              <button type="button" onClick={handleClearAll} className="hover:text-foreground">
                Clear
              </button>
            </div>
            {githubThreads.map((thread) => {
              const firstComment = thread.comments[0];
              const filePath = extractFilePathFromDocPath(thread.documentPath, repoDir);
              return (
                <div
                  key={thread.threadId}
                  className={cn(
                    'flex items-start gap-2 border-t border-border/30 px-3 py-2',
                    selectedIds.has(thread.threadId) && 'bg-muted/20',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(thread.threadId)}
                    onChange={() => handleToggle(thread.threadId)}
                    className="mt-0.5 shrink-0 accent-primary cursor-pointer"
                  />
                  <div className="min-w-0 flex-1 text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <span className="truncate font-mono text-[10px]">
                        {filePath ?? thread.documentPath}
                        {thread.lineNumber > 0 ? `:${thread.lineNumber}` : ''}
                      </span>
                      {thread.githubAuthor && (
                        <span className="shrink-0 text-[10px]">by {thread.githubAuthor}</span>
                      )}
                      {thread.githubUrl && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <a
                              href={thread.githubUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 text-[10px] text-blue-400 hover:text-blue-300"
                              onClick={(e) => e.stopPropagation()}
                            >
                              ↗
                            </a>
                          </TooltipTrigger>
                          <TooltipContent>View on GitHub</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    {firstComment && (
                      <div className="mt-0.5 truncate text-foreground/80">
                        {getBodyText(firstComment.body)}
                      </div>
                    )}
                    {thread.comments.length > 1 && (
                      <div className="mt-0.5 text-[10px] text-muted-foreground/70">
                        +{thread.comments.length - 1} repl
                        {thread.comments.length === 2 ? 'y' : 'ies'}
                      </div>
                    )}
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDismiss(thread.threadId)}
                        className="h-6 shrink-0 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        Dismiss
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Locally dismiss (no GitHub write-back)</TooltipContent>
                  </Tooltip>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
