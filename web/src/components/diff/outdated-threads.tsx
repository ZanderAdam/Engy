'use client';

import { useState } from 'react';
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react';
import { diffDocFilePath } from '@/lib/diff-doc-path';
import { CommentWidget } from './comment-widget';
import type { DiffComment } from './use-diff-comments';

interface OutdatedThreadsProps {
  threads: DiffComment[];
  repoDir: string | null;
  onReply: (threadId: string, text: string) => void;
  onResolve: (threadId: string) => void;
  onDelete: (threadId: string) => void;
  onDeleteComment: (threadId: string, commentId: string) => void;
}

export function OutdatedThreads({
  threads,
  repoDir,
  onReply,
  onResolve,
  onDelete,
  onDeleteComment,
}: OutdatedThreadsProps) {
  const [expanded, setExpanded] = useState(false);
  if (threads.length === 0) return null;

  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full cursor-pointer items-center gap-1 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        {expanded ? (
          <RiArrowDownSLine className="size-3.5" />
        ) : (
          <RiArrowRightSLine className="size-3.5" />
        )}
        <span className="font-medium">Outdated</span>
        <span className="tabular-nums">({threads.length})</span>
        <span className="text-muted-foreground/60">threads on files no longer in the diff</span>
      </button>
      {expanded && (
        <div className="max-h-72 space-y-2 overflow-auto px-3 pb-2">
          {threads.map((thread) => (
            <div key={thread.threadId}>
              <p className="pb-0.5 font-mono text-[10px] text-muted-foreground/70">
                {diffDocFilePath(thread.documentPath)}:{thread.lineNumber}
              </p>
              <CommentWidget
                comment={thread}
                repoDir={repoDir}
                onSave={() => {}}
                onReply={onReply}
                onResolve={onResolve}
                onDelete={onDelete}
                onDeleteComment={onDeleteComment}
                onCancel={() => {}}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
