'use client';

import { useCallback, useState } from 'react';
import { RiGithubLine, RiRobot2Line } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSendToTerminal } from '@/components/terminal/use-send-to-terminal';
import { cn } from '@/lib/utils';
import { AGENT_USER_ID } from '@/lib/comment-feedback';
import { SEVERITY_PRESENTATION } from './agent-findings';
import { buildProvePrompt } from './prove-prompt';
import { extractFilePathFromDocPath, type DiffComment } from './use-diff-comments';

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
}: CommentWidgetProps) {
  const [text, setText] = useState('');
  const { sendToTerminal, terminalActive } = useSendToTerminal();

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (!text.trim()) return;
        if (comment && onReply) {
          onReply(comment.threadId, text.trim());
        } else {
          onSave(text.trim());
        }
        setText('');
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    },
    [text, comment, onReply, onSave, onCancel],
  );

  const handleSubmit = () => {
    if (!text.trim()) return;
    if (comment && onReply) {
      onReply(comment.threadId, text.trim());
    } else {
      onSave(text.trim());
    }
    setText('');
  };

  const isGithub = comment?.source === 'github';
  const isAgent = comment?.source === 'agent';
  const severity = comment?.severity ? SEVERITY_PRESENTATION[comment.severity] : undefined;

  const handleProveIt = () => {
    if (!comment || !repoDir) return;
    const filePath = extractFilePathFromDocPath(comment.documentPath, repoDir);
    if (!filePath) return;
    const findingBody = comment.comments[0]?.body;
    sendToTerminal(
      buildProvePrompt({
        threadId: comment.threadId,
        filePath,
        lineNumber: comment.lineNumber,
        findingBody: typeof findingBody === 'string' ? findingBody : JSON.stringify(findingBody),
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
        className={cn(
          'border border-border bg-background p-3',
          isGithub && 'border-l-2 border-l-muted-foreground/30',
          isAgent && 'border-l-2 border-l-primary/50',
        )}
      >
        {comment && comment.comments.length > 0 && (
          <div className="mb-2">
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
            {isAgent && (
              <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <RiRobot2Line className="size-3.5 shrink-0" />
                <span className="font-medium">{comment.agentType ?? 'Agent'}</span>
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
                  comment.resolved && 'opacity-50',
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
                <span className={cn('whitespace-pre-wrap', comment.resolved && 'line-through')}>
                  {typeof c.body === 'string' ? c.body : JSON.stringify(c.body)}
                </span>
              </div>
            ))}
            <div className="flex items-center gap-1.5 pt-1">
              {isAgent && !comment.resolved && (
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
              {onResolve && !comment.resolved && (
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

        {!isGithub && (
          <>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={comment ? 'Reply...' : 'Add a comment...'}
              className="min-h-[60px] resize-none text-xs"
              autoFocus
            />
            <div className="mt-1.5 flex items-center justify-end">
              <div className="flex gap-1">
                <Button variant="ghost" size="xs" onClick={onCancel}>
                  Cancel
                </Button>
                <Button size="xs" onClick={handleSubmit} disabled={!text.trim()}>
                  {comment ? 'Reply' : 'Comment'}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
