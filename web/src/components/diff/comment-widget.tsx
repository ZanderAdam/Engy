'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { RiGithubLine, RiRobot2Line } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSendToTerminal } from '@/components/terminal/use-send-to-terminal';
import { cn } from '@/lib/utils';
import { AGENT_USER_ID } from '@/lib/comment-feedback';
import { commentBodyText, SEVERITY_PRESENTATION } from './agent-findings';
import { buildProvePrompt } from './prove-prompt';
import { diffDocFilePath } from '@/lib/diff-doc-path';
import { commentOrigin } from './review-drafts';
import { useReviewWrite } from './review-write-context';
import type { DiffComment } from './use-diff-comments';

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface CommentWidgetProps {
  comment?: DiffComment;
  /** Recovers the finding's file path from `comment.documentPath` for "Prove it". Required, not optional: an omitted prop silently disables the button. */
  repoDir: string | null;
  onSave: (text: string) => void;
  onReply?: (threadId: string, text: string) => void;
  onResolve?: (threadId: string) => void;
  onDelete?: (threadId: string) => void;
  onDeleteComment?: (threadId: string, commentId: string) => void;
  onCancel: () => void;
  onAddDraft?: (text: string) => void;
  draftBlockedReason?: string | null;
}

function LocalOnlyBadge() {
  return (
    <span className="border border-border px-1.5 text-[10px] font-medium text-muted-foreground">
      Local only
    </span>
  );
}

export function CommentWidget({
  comment,
  repoDir,
  onSave,
  onReply,
  onDelete,
  onDeleteComment,
  onCancel,
  onResolve,
  onAddDraft,
  draftBlockedReason = null,
}: CommentWidgetProps) {
  const [text, setText] = useState('');
  const [pendingReplies, setPendingReplies] = useState<string[]>([]);
  const [resolvedOverride, setResolvedOverride] = useState<boolean | null>(null);
  const { sendToTerminal, terminalActive } = useSendToTerminal();
  const reviewWrite = useReviewWrite();

  const isGithub = comment?.source === 'github';
  const isDraft = comment?.githubDraft === true;
  const isAgent = comment?.source === 'agent';
  const githubWrite = isGithub ? reviewWrite : null;
  const isLocalOnly = !!reviewWrite && !!comment && commentOrigin(comment) === 'engy';
  const resolved = resolvedOverride ?? comment?.resolved ?? false;
  const severity = comment?.severity ? SEVERITY_PRESENTATION[comment.severity] : undefined;

  const replyOnGithub = async (threadId: string, body: string) => {
    if (!githubWrite) return;
    setPendingReplies((pending) => [...pending, body]);
    try {
      await githubWrite.replyToThread(threadId, body);
    } catch (error) {
      setText(body);
      toast.error(error instanceof Error ? error.message : 'Could not post the reply');
    } finally {
      setPendingReplies((pending) => pending.filter((reply) => reply !== body));
    }
  };

  const changeResolved = async (threadId: string, next: boolean) => {
    if (!githubWrite) return;
    setResolvedOverride(next);
    try {
      await githubWrite.setThreadResolved(threadId, next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the thread');
    } finally {
      setResolvedOverride(null);
    }
  };

  const submitText = () => {
    const body = text.trim();
    if (!body) return;
    if (comment && githubWrite) {
      setText('');
      void replyOnGithub(comment.threadId, body);
      return;
    }
    if (comment && onReply) {
      onReply(comment.threadId, body);
    } else {
      onSave(body);
    }
    setText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submitText();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const handleAddDraft = () => {
    if (!text.trim() || !onAddDraft) return;
    onAddDraft(text.trim());
    setText('');
  };

  const handleProveIt = () => {
    if (!comment || !repoDir) return;
    const filePath = diffDocFilePath(comment.documentPath);
    if (!filePath) return;
    sendToTerminal(
      buildProvePrompt({
        threadId: comment.threadId,
        repoDir,
        filePath,
        lineNumber: comment.lineNumber,
        findingBody: commentBodyText(comment.comments[0]?.body),
      }),
    );
  };

  function commentLabel(c: DiffComment['comments'][number], i: number): string {
    if (isGithub) return c.userId ?? comment?.githubAuthor ?? 'GitHub';
    if (i === 0) return isAgent ? 'Finding' : 'Comment';
    return c.userId === AGENT_USER_ID ? 'Agent' : 'Reply';
  }

  return (
    <TooltipProvider>
      <div
        data-thread-id={comment?.threadId}
        className={cn(
          'border border-border bg-background p-3',
          isGithub && 'border-l-2 border-l-muted-foreground/30',
          isAgent && 'border-l-2 border-l-primary/50',
        )}
      >
        {comment && comment.comments.length > 0 && (
          <div className="mb-2">
            {isDraft && (
              <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <RiGithubLine className="size-3.5 shrink-0" />
                <span className="font-medium">GitHub review comment</span>
                <span className="border border-amber-400/30 bg-amber-400/10 px-1.5 text-[10px] font-medium text-amber-400">
                  Pending
                </span>
              </div>
            )}
            {isGithub && (
              <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <RiGithubLine className="size-3.5 shrink-0" />
                <span className="font-medium">{comment.githubAuthor ?? 'GitHub'}</span>
                {comment.githubUrl && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <a
                        href={comment.githubUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto text-[10px] text-muted-foreground/60 hover:text-foreground"
                      >
                        View on GitHub ↗
                      </a>
                    </TooltipTrigger>
                    <TooltipContent>Open this comment on GitHub</TooltipContent>
                  </Tooltip>
                )}
              </div>
            )}
            {isLocalOnly && !isAgent && (
              <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-medium">Note</span>
                <LocalOnlyBadge />
              </div>
            )}
            {isAgent && (
              <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <RiRobot2Line className="size-3.5 shrink-0" />
                <span className="font-medium">{comment.agentType ?? 'Agent'}</span>
                {isLocalOnly && <LocalOnlyBadge />}
                {severity && (
                  <span
                    className={cn(
                      'ml-auto text-[10px] font-medium uppercase tracking-wide',
                      severity.className,
                    )}
                  >
                    {severity.label}
                  </span>
                )}
              </div>
            )}
            {comment.comments.map((c, i) => (
              <div
                key={c.id}
                className={cn(
                  'group/comment py-1.5 text-xs',
                  i > 0 && 'border-t border-border/50 ml-3',
                  resolved && 'opacity-50',
                )}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="font-medium text-muted-foreground">{commentLabel(c, i)}</span>
                  {c.createdAt && (
                    <span className="text-[10px] text-muted-foreground/60">
                      {formatRelativeTime(c.createdAt)}
                    </span>
                  )}
                  {i > 0 && onDeleteComment && !isGithub && (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="ml-auto text-destructive hover:text-destructive opacity-0 group-hover/comment:opacity-100"
                      onClick={() => onDeleteComment(comment.threadId, c.id)}
                    >
                      Delete
                    </Button>
                  )}
                </div>
                <span className={cn('whitespace-pre-wrap', resolved && 'line-through')}>
                  {commentBodyText(c.body)}
                </span>
              </div>
            ))}
            {pendingReplies.map((body, i) => (
              <div
                key={`pending-${i}`}
                className="ml-3 border-t border-border/50 py-1.5 text-xs opacity-60"
              >
                <div className="mb-0.5 flex items-center gap-1.5 font-medium text-muted-foreground">
                  You
                  <span className="text-[10px] font-normal">Sending…</span>
                </div>
                <span className="whitespace-pre-wrap">{body}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5 pt-1">
              {isAgent && !resolved && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={handleProveIt}
                      disabled={!terminalActive}
                    >
                      Prove it
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {terminalActive
                      ? 'Send this finding to the terminal and ask the agent to verify it'
                      : 'No active terminal to send this to'}
                  </TooltipContent>
                </Tooltip>
              )}
              {githubWrite && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => void changeResolved(comment.threadId, !resolved)}
                >
                  {resolved ? 'Unresolve' : 'Resolve'}
                </Button>
              )}
              {!githubWrite && onResolve && !resolved && !isDraft && (
                <Button variant="ghost" size="xs" onClick={() => onResolve(comment.threadId)}>
                  {isGithub ? 'Dismiss' : 'Resolve'}
                </Button>
              )}
              {onDelete && !isGithub && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onDelete(comment.threadId)}
                >
                  Delete thread
                </Button>
              )}
            </div>
          </div>
        )}

        {((!isGithub && !isDraft) || githubWrite) && (
          <>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                githubWrite ? 'Reply on GitHub...' : comment ? 'Reply...' : 'Add a comment...'
              }
              className="min-h-[60px] resize-none text-xs"
              autoFocus
            />
            <div className="mt-1.5 flex items-center justify-end">
              <div className="flex gap-1">
                <Button variant="ghost" size="xs" onClick={onCancel}>
                  Cancel
                </Button>
                {onAddDraft && !comment && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={draftBlockedReason ? 0 : undefined}>
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={handleAddDraft}
                          disabled={!text.trim() || draftBlockedReason !== null}
                        >
                          <RiGithubLine className="size-3" />
                          Add to GitHub review
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {draftBlockedReason ??
                        'Saved as a pending comment. Sent when you submit the review.'}
                    </TooltipContent>
                  </Tooltip>
                )}
                <Button size="xs" onClick={submitText} disabled={!text.trim()}>
                  {comment ? 'Reply' : onAddDraft ? 'Add note' : 'Comment'}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
