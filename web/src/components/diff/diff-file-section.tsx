'use client';

import { useMemo } from 'react';
import { RiCheckboxLine, RiCheckboxBlankLine, RiExternalLinkLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { fileKind } from '@/lib/file-types';
import { DiffViewerPanel } from './diff-viewer-panel';
import { patchContentId, patchSpecFor } from './diff-patch-spec';
import { refsFor, type DiffRefsInputs } from './diff-refs';
import { useFilePatch } from './use-file-patch';
import type { DiffComment } from './use-diff-comments';
import type { ChangedFile, DiffSide, GitFileStatus, ViewMode } from './types';

/**
 * What every row in a stacked review needs in common — the view being diffed
 * and where to read it from. Each section derives its own refs from this plus
 * its own file, so no per-file wiring has to be threaded from the page.
 */
export interface DiffSectionContext extends Omit<DiffRefsInputs, 'file' | 'side'> {
  repoDir: string | null;
  worktreePath?: string;
  coderWorkspace?: string;
}

const statusConfig: Record<GitFileStatus, { letter: string; className: string }> = {
  added: { letter: 'A', className: 'bg-green-500/15 text-green-500 border-green-500/30' },
  modified: { letter: 'M', className: 'bg-blue-500/15 text-blue-500 border-blue-500/30' },
  deleted: { letter: 'D', className: 'bg-red-500/15 text-red-500 border-red-500/30' },
  renamed: { letter: 'R', className: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30' },
};

interface DiffFileSectionProps {
  file: ChangedFile;
  context: DiffSectionContext;
  viewMode: ViewMode;
  comments: DiffComment[];
  isViewed: boolean;
  onToggleViewed: () => void;
  /**
   * Far enough from the viewport not to be worth fetching yet. The header still
   * renders so the stack keeps its shape and stays scrollable.
   */
  deferred?: boolean;
  /** Opens this file on its own, for the kinds the stack does not render. */
  onOpenSingle: () => void;
  onAddComment?: (
    filePath: string,
    lineNumber: number,
    side: 'modified' | 'original',
    text: string,
    codeLine: string,
  ) => void;
  onReply?: (threadId: string, text: string) => void;
  onResolve?: (threadId: string) => void;
  onDelete?: (threadId: string) => void;
  onDeleteComment?: (threadId: string, commentId: string) => void;
}

export function DiffFileSection({
  file,
  context,
  viewMode,
  comments,
  isViewed,
  onToggleViewed,
  deferred = false,
  onOpenSingle,
  onAddComment,
  onReply,
  onResolve,
  onDelete,
  onDeleteComment,
}: DiffFileSectionProps) {
  const side: DiffSide = file.staged ? 'staged' : 'unstaged';
  const kind = fileKind(file.path);
  const isTextLike = kind === 'text' || kind === 'markdown';

  const spec = useMemo(() => patchSpecFor({ ...context, selectedSide: side }), [context, side]);
  const { originalRef, originalId } = useMemo(
    () => refsFor({ ...context, file, side }),
    [context, file, side],
  );

  const { patch, oldSource, truncated, isLoading, error } = useFilePatch({
    repoDir: context.repoDir,
    filePath: file.path,
    oldPath: file.oldPath,
    spec,
    contentId: spec ? patchContentId(spec, file) : undefined,
    originalRef,
    originalId,
    worktreePath: context.worktreePath,
    coderWorkspace: context.coderWorkspace,
    enabled: isTextLike && !deferred,
  });

  const { letter, className } = statusConfig[file.status];
  const unresolved = comments.filter((c) => !c.resolved).length;

  return (
    <section className="border-b border-border">
      {/* Sticky so the path stays readable while its own diff scrolls past. */}
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-muted/95 px-3 py-1.5 backdrop-blur">
        <span
          className={cn(
            'inline-flex h-5 w-5 shrink-0 items-center justify-center border text-[10px] font-bold',
            className,
          )}
        >
          {letter}
        </span>
        <span className="truncate font-mono text-xs text-foreground">{file.path}</span>
        {file.oldPath && (
          <span className="truncate font-mono text-[10px] text-muted-foreground">
            ← {file.oldPath}
          </span>
        )}
        {unresolved > 0 && (
          <span className="shrink-0 text-[10px] text-primary">{unresolved} unresolved</span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="xs" onClick={onOpenSingle} className="gap-1">
            <RiExternalLinkLine className="size-3.5" />
            Open
          </Button>
          <Button
            variant="ghost"
            size="xs"
            aria-pressed={isViewed}
            onClick={onToggleViewed}
            className={cn('gap-1.5', isViewed && 'text-primary')}
          >
            {isViewed ? (
              <RiCheckboxLine className="size-3.5" />
            ) : (
              <RiCheckboxBlankLine className="size-3.5" />
            )}
            Viewed
          </Button>
        </div>
      </div>

      {isViewed ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">Marked viewed — collapsed.</p>
      ) : deferred ? (
        <div className="h-24" aria-hidden />
      ) : isTextLike ? (
        <DiffViewerPanel
          patch={patch}
          oldSource={oldSource}
          viewMode={viewMode}
          layout="flow"
          filePath={file.path}
          isLoading={isLoading}
          truncated={truncated}
          loadError={error}
          fileComments={comments}
          onAddComment={
            onAddComment
              ? (lineNumber, commentSide, text, codeLine) =>
                  onAddComment(file.path, lineNumber, commentSide, text, codeLine)
              : undefined
          }
          onReply={onReply}
          onResolve={onResolve}
          onDelete={onDelete}
          onDeleteComment={onDeleteComment}
        />
      ) : (
        <button
          type="button"
          onClick={onOpenSingle}
          className="w-full px-3 py-3 text-left text-xs text-muted-foreground hover:text-foreground"
        >
          {kind === 'image' ? 'Image' : 'Binary file'} — open to view
        </button>
      )}
    </section>
  );
}
