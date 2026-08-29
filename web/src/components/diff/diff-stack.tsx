'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DiffFileSection, type DiffSectionContext } from './diff-file-section';
import { rowId } from './diff-selection';
import type { DiffComment } from './use-diff-comments';
import type { ChangedFile, ViewMode } from './types';

interface DiffStackProps {
  files: ChangedFile[];
  context: DiffSectionContext;
  viewMode: ViewMode;
  /** Row to bring into view. Scrolls only when it changes, not on every render. */
  scrollToRowId: string | null;
  /** Row currently under the top of the viewport, for the file list to follow. */
  onVisibleRowChange?: (id: string) => void;
  commentsForFile: (filePath: string) => DiffComment[];
  viewedPaths: Set<string>;
  onToggleViewed: (path: string) => void;
  onOpenSingle: (file: ChangedFile) => void;
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

export function DiffStack({
  files,
  context,
  viewMode,
  scrollToRowId,
  onVisibleRowChange,
  commentsForFile,
  viewedPaths,
  onToggleViewed,
  onOpenSingle,
  onAddComment,
  onReply,
  onResolve,
  onDelete,
  onDeleteComment,
}: DiffStackProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const lastScrolled = useRef<string | null>(null);
  // Sections that have come close enough to the viewport to be worth fetching.
  // Grows only: once mounted a section stays mounted, so scrolling back never
  // refetches and the scroll position never shifts under the reader.
  const [mounted, setMounted] = useState<Set<string>>(new Set());

  const registerSection = useCallback((id: string, node: HTMLElement | null) => {
    if (node) sectionRefs.current.set(id, node);
    else sectionRefs.current.delete(id);
  }, []);

  // Only a *change* of target scrolls. Re-running on every render would fight
  // the user, since the spy below keeps reporting rows as they scroll past.
  useEffect(() => {
    if (!scrollToRowId || lastScrolled.current === scrollToRowId) return;
    const node = sectionRefs.current.get(scrollToRowId);
    if (!node) return;
    lastScrolled.current = scrollToRowId;
    node.scrollIntoView({ block: 'start' });
  }, [scrollToRowId, files]);

  // Fetching every file at once melts the request pool — 55 files is 110
  // in-flight queries, which fails outright rather than merely being slow. This
  // keeps the number in flight to whatever is near the viewport.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const arrived = entries
          .filter((e) => e.isIntersecting)
          .map((e) => e.target.getAttribute('data-row-id'))
          .filter((id): id is string => !!id);
        if (arrived.length === 0) return;
        setMounted((previous) => {
          const next = new Set(previous);
          for (const id of arrived) next.add(id);
          return next.size === previous.size ? previous : next;
        });
      },
      { root, rootMargin: '800px 0px' },
    );

    for (const node of sectionRefs.current.values()) observer.observe(node);
    return () => observer.disconnect();
  }, [files]);

  // Reports whichever section owns the top of the viewport. `rootMargin` pulls
  // the detection line down off the very top so a section counts as current
  // once its header reaches it, not when its last pixel leaves.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !onVisibleRowChange) return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.getAttribute('data-row-id');
          if (!id) continue;
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        // Report in file order so the list highlight moves monotonically.
        const first = files.map(rowId).find((id) => visible.has(id));
        if (first) onVisibleRowChange(first);
      },
      { root, rootMargin: '0px 0px -80% 0px' },
    );

    for (const node of sectionRefs.current.values()) observer.observe(node);
    return () => observer.disconnect();
  }, [files, onVisibleRowChange]);

  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No changes to review
      </div>
    );
  }

  // `overflow-y-auto` alone computes `overflow-x` to `auto` as well, so a
  // single over-wide file header drags every other file sideways with it.
  // Each section scrolls its own code, so the stack itself never needs to.
  return (
    <div ref={scrollRef} className="h-full overflow-y-auto overflow-x-hidden">
      {files.map((file) => {
        const id = rowId(file);
        return (
          <div key={id} data-row-id={id} ref={(node) => registerSection(id, node)}>
            <DiffFileSection
              file={file}
              context={context}
              viewMode={viewMode}
              comments={commentsForFile(file.path)}
              isViewed={viewedPaths.has(file.path)}
              deferred={!mounted.has(id)}
              onToggleViewed={() => onToggleViewed(file.path)}
              onOpenSingle={() => onOpenSingle(file)}
              onAddComment={onAddComment}
              onReply={onReply}
              onResolve={onResolve}
              onDelete={onDelete}
              onDeleteComment={onDeleteComment}
            />
          </div>
        );
      })}
    </div>
  );
}
