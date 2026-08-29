'use client';

import { Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Diff,
  Hunk,
  getChangeKey,
  markEdits,
  parseDiff,
  tokenize,
  useMinCollapsedLines,
  useSourceExpansion,
} from 'react-diff-view';
import type { ChangeData, DiffType, HunkData } from 'react-diff-view';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CommentWidget } from './comment-widget';
import { DiffExpandRow } from './diff-expand-row';
import { diffLanguage } from './diff-language';
import { highlighter } from './refractor-highlighter';
import {
  anchorComments,
  countChanges,
  expansionSource,
  groupByChangeKey,
  lineForChange,
  sideForChange,
} from './patch-comments';
import type { DiffComment } from './use-diff-comments';
import type { ViewMode } from './types';

/**
 * react-diff-view renders one table row per change with no virtualization, so a
 * very large patch is a real frame-time cliff rather than the gradual slowdown
 * Monaco had. Past this the reviewer is asked first.
 */
const LARGE_DIFF_CHANGES = 4000;

/** Gaps shorter than this open on their own; longer ones wait for a click. */
const AUTO_EXPAND_LINES = 10;

interface DiffViewerPanelProps {
  /** Unified diff text for the selected file, computed by git. */
  patch: string;
  /** Original side's full text — expansion and tokenization read only this side. */
  oldSource: string;
  viewMode: ViewMode;
  filePath?: string;
  /**
   * `pane` fills a fixed-height parent and owns its scrolling; `flow` grows to
   * its content so a stack of files shares one scroll container.
   */
  layout?: 'pane' | 'flow';
  /** Identifies the open tab, so each keeps its own scroll position. */
  scrollKey?: string;
  isLoading?: boolean;
  truncated?: boolean;
  loadError?: string | null;
  fileComments?: DiffComment[];
  onAddComment?: (
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

function Centered({
  children,
  tone,
  layout = 'pane',
}: {
  children: React.ReactNode;
  tone?: 'error';
  layout?: 'pane' | 'flow';
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-center px-6 py-6 text-sm',
        layout === 'pane' ? 'h-full' : 'min-h-16',
        tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {children}
    </div>
  );
}

export function DiffViewerPanel({
  patch,
  oldSource,
  viewMode,
  filePath,
  layout = 'pane',
  scrollKey,
  isLoading,
  truncated,
  loadError,
  fileComments = [],
  onAddComment,
  onReply,
  onResolve,
  onDelete,
  onDeleteComment,
}: DiffViewerPanelProps) {
  const [newCommentChange, setNewCommentChange] = useState<ChangeData | null>(null);
  const [renderLarge, setRenderLarge] = useState(false);

  // Identifies the reviewed selection, not just the path: a staged and an
  // unstaged row of one file are different diffs.
  const selectionKey = scrollKey ?? filePath;

  // An open composer holds a change from the diff it was opened on, and
  // `getChangeKey` carries no file identity — so left in place it can reappear
  // over an unrelated line in the next file and save that file's text against
  // this one's. Reset with the selection (React's documented alternative to an
  // effect for state derived from props).
  const [prevSelectionKey, setPrevSelectionKey] = useState(selectionKey);
  if (selectionKey !== prevSelectionKey) {
    setPrevSelectionKey(selectionKey);
    setNewCommentChange(null);
    setRenderLarge(false);
  }

  const file = useMemo(() => {
    if (!patch) return null;
    // One file per patch, but a malformed patch parses to nothing.
    return parseDiff(patch)[0] ?? null;
  }, [patch]);

  const rawHunks: HunkData[] = useMemo(() => file?.hunks ?? [], [file]);

  const source = expansionSource(rawHunks, oldSource);
  const [expandedHunks, expandRange] = useSourceExpansion(rawHunks, source);
  const hunks = useMinCollapsedLines(AUTO_EXPAND_LINES, expandedHunks, source);

  const changeCount = useMemo(() => countChanges(hunks), [hunks]);
  const tooLarge = changeCount > LARGE_DIFF_CHANGES && !renderLarge;

  const language = filePath ? diffLanguage(filePath) : null;

  // Walks every line of every hunk, so it must not re-run on unrelated renders.
  const tokens = useMemo(() => {
    if (tooLarge || hunks.length === 0) return undefined;
    const enhancers = [markEdits(hunks, { type: 'block' })];
    try {
      return language
        ? tokenize(hunks, {
            highlight: true,
            refractor: highlighter as never,
            language,
            oldSource: oldSource || undefined,
            enhancers,
          })
        : tokenize(hunks, { highlight: false, oldSource: oldSource || undefined, enhancers });
    } catch {
      // A grammar can still fail on pathological input. Losing colour beats
      // losing the diff.
      return undefined;
    }
  }, [hunks, language, oldSource, tooLarge]);

  const { anchors, unanchored } = useMemo(
    () => anchorComments(hunks, fileComments),
    [hunks, fileComments],
  );

  const cancelNewComment = useCallback(() => setNewCommentChange(null), []);

  const widgets = useMemo(() => {
    const grouped = groupByChangeKey(fileComments, anchors);
    const rendered: Record<string, React.ReactNode> = {};

    for (const [changeKey, threads] of grouped) {
      rendered[changeKey] = (
        <div className="space-y-1 p-1">
          {threads.map((thread) => (
            <CommentWidget
              key={thread.threadId}
              comment={thread}
              onSave={() => {}}
              onReply={onReply}
              onResolve={onResolve}
              onDelete={onDelete}
              onDeleteComment={onDeleteComment}
              onCancel={() => {}}
            />
          ))}
        </div>
      );
    }

    if (newCommentChange) {
      const key = getChangeKey(newCommentChange);
      rendered[key] = (
        <div className="space-y-1 p-1">
          {rendered[key]}
          <CommentWidget
            onSave={(text) => {
              onAddComment?.(
                lineForChange(newCommentChange),
                sideForChange(newCommentChange),
                text,
                newCommentChange.content,
              );
              setNewCommentChange(null);
            }}
            onCancel={cancelNewComment}
          />
        </div>
      );
    }

    return rendered;
  }, [
    fileComments,
    anchors,
    newCommentChange,
    onReply,
    onResolve,
    onDelete,
    onDeleteComment,
    onAddComment,
    cancelNewComment,
  ]);

  const gutterEvents = useMemo(
    () => ({
      onClick: ({ change }: { change: ChangeData | null }) => {
        if (!change || !onAddComment) return;
        setNewCommentChange(change);
      },
    }),
    [onAddComment],
  );

  // Per-tab scroll memory. The Monaco diff editor kept this itself; a plain
  // scroll container does not, so switching tabs would otherwise jump to the top.
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTops = useRef<Map<string, number>>(new Map());
  const restoredKey = useRef<string | undefined>(undefined);

  // Recording on every scroll keeps the outgoing tab's position without needing
  // to detect the switch. The guard drops events fired against a selection whose
  // own position has not been restored yet, which would otherwise overwrite it.
  const rememberScroll = useCallback(() => {
    const node = scrollRef.current;
    if (node && selectionKey && restoredKey.current === selectionKey) {
      scrollTops.current.set(selectionKey, node.scrollTop);
    }
  }, [selectionKey]);

  // Restore once per selection, and only once its hunks exist: before that the
  // container has nothing to scroll and the assignment is silently dropped.
  // Keyed on `restoredKey` rather than on `hunks` changing, because expanding a
  // collapsed gap also produces new hunks and must not move the viewport.
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (layout !== 'pane') return;
    if (!node || hunks.length === 0 || restoredKey.current === selectionKey) return;
    restoredKey.current = selectionKey;
    node.scrollTop = selectionKey ? (scrollTops.current.get(selectionKey) ?? 0) : 0;
  }, [selectionKey, hunks, layout]);

  if (!filePath) return <Centered layout={layout}>No file selected</Centered>;
  if (loadError)
    return (
      <Centered layout={layout} tone="error">
        Failed to load diff: {loadError}
      </Centered>
    );
  if (isLoading) return <Centered layout={layout}>Loading diff…</Centered>;

  if (truncated) {
    return <Centered layout={layout}>This file&apos;s diff is too large to load.</Centered>;
  }

  if (!file || hunks.length === 0) {
    // A pure rename carries a header and no hunks — that is the whole change.
    if (file?.type === 'rename') {
      return (
        <Centered layout={layout}>
          Renamed from <span className="ml-1 font-mono text-foreground">{file.oldPath}</span>
        </Centered>
      );
    }
    return <Centered layout={layout}>No changes detected</Centered>;
  }

  if (tooLarge) {
    return (
      <Centered layout={layout}>
        <div className="flex flex-col items-center gap-2">
          <span>{changeCount.toLocaleString()} changed lines — rendering may be slow.</span>
          <Button variant="outline" size="xs" onClick={() => setRenderLarge(true)}>
            Render anyway
          </Button>
        </div>
      </Centered>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={layout === 'pane' ? rememberScroll : undefined}
      className={layout === 'pane' ? 'h-full overflow-auto' : 'overflow-x-auto'}
    >
      {unanchored.length > 0 && (
        <UnanchoredComments
          comments={unanchored}
          onReply={onReply}
          onResolve={onResolve}
          onDelete={onDelete}
          onDeleteComment={onDeleteComment}
        />
      )}
      <Diff
        diffType={file.type as DiffType}
        hunks={hunks}
        viewType={viewMode === 'split' ? 'split' : 'unified'}
        tokens={tokens}
        widgets={widgets}
        gutterEvents={onAddComment ? gutterEvents : undefined}
        className="engy-diff"
      >
        {(renderedHunks) =>
          renderedHunks.map((hunk, index) => (
            <Fragment key={hunk.content}>
              <DiffExpandRow
                previousHunk={index === 0 ? null : renderedHunks[index - 1]}
                nextHunk={hunk}
                onExpand={expandRange}
              />
              <Hunk hunk={hunk} />
            </Fragment>
          ))
        }
      </Diff>
    </div>
  );
}

/**
 * Threads whose line is no longer among the rendered changes — the file moved on
 * under them, or their region is still collapsed. Listing them beats dropping
 * them silently, which is what a line-number lookup alone would do.
 */
function UnanchoredComments({
  comments,
  onReply,
  onResolve,
  onDelete,
  onDeleteComment,
}: {
  comments: DiffComment[];
  onReply?: (threadId: string, text: string) => void;
  onResolve?: (threadId: string) => void;
  onDelete?: (threadId: string) => void;
  onDeleteComment?: (threadId: string, commentId: string) => void;
}) {
  return (
    <div className="border-b border-border bg-muted/20 p-2">
      <p className="mb-1.5 px-1 text-xs text-muted-foreground">
        {comments.length} comment{comments.length === 1 ? '' : 's'} on lines not shown in this diff
      </p>
      <div className="space-y-1">
        {comments.map((comment) => (
          <div key={comment.threadId}>
            <p className="px-1 pb-0.5 font-mono text-[10px] text-muted-foreground/70">
              line {comment.lineNumber}
              {comment.codeLine ? `: ${comment.codeLine.trim()}` : ''}
            </p>
            <CommentWidget
              comment={comment}
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
    </div>
  );
}
