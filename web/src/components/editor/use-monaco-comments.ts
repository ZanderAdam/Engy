'use client';

import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { editor } from 'monaco-editor';
import { MonacoCommentZone } from './monaco-comment-zone';
import type { DiffComment } from '@/components/diff/use-diff-comments';

interface UseMonacoCommentsOptions {
  editor: editor.IStandaloneCodeEditor | editor.IStandaloneDiffEditor | null;
  comments: DiffComment[];
  onAddComment?: (lineNumber: number, side: 'modified' | 'original', text: string) => void;
  onReply?: (threadId: string, text: string) => void;
  onResolve?: (threadId: string) => void;
  onDelete?: (threadId: string) => void;
  onDeleteComment?: (threadId: string, commentId: string) => void;
}

interface CommentZoneEntry {
  zoneId: string;
  widget: editor.IOverlayWidget;
  root: Root;
}

function getTargetEditor(
  editorInstance: editor.IStandaloneCodeEditor | editor.IStandaloneDiffEditor,
  side: 'modified' | 'original' = 'modified',
): editor.IStandaloneCodeEditor {
  if ('getModifiedEditor' in editorInstance) {
    return side === 'original'
      ? editorInstance.getOriginalEditor()
      : editorInstance.getModifiedEditor();
  }
  return editorInstance;
}

function createCommentOverlayZone(
  targetEditor: editor.IStandaloneCodeEditor,
  afterLineNumber: number,
  heightInPx: number,
  widgetId: string,
  reactElement: React.ReactElement,
): CommentZoneEntry {
  const overlayNode = document.createElement('div');
  overlayNode.style.position = 'absolute';
  overlayNode.style.left = '0';
  overlayNode.style.width = '100%';
  overlayNode.style.zIndex = '10';

  const root = createRoot(overlayNode);
  root.render(reactElement);

  const widget: editor.IOverlayWidget = {
    getId: () => widgetId,
    getDomNode: () => overlayNode,
    getPosition: () => null,
  };
  targetEditor.addOverlayWidget(widget);

  let zoneId = '';
  targetEditor.changeViewZones((accessor) => {
    zoneId = accessor.addZone({
      afterLineNumber,
      heightInPx,
      domNode: document.createElement('div'),
      suppressMouseDown: true,
      onDomNodeTop: (top) => {
        overlayNode.style.top = `${top}px`;
      },
      onComputedHeight: (height) => {
        overlayNode.style.height = `${height}px`;
      },
    });
  });

  return { zoneId, widget, root };
}

function cleanupCommentOverlayZone(
  targetEditor: editor.IStandaloneCodeEditor,
  entry: CommentZoneEntry,
) {
  targetEditor.changeViewZones((accessor) => {
    accessor.removeZone(entry.zoneId);
  });
  targetEditor.removeOverlayWidget(entry.widget);
  // Defer unmount to avoid React race condition when cleanup runs mid-render
  setTimeout(() => entry.root.unmount(), 0);
}

export function useMonacoComments({
  editor: editorInstance,
  comments,
  onAddComment,
  onReply,
  onResolve,
  onDelete,
  onDeleteComment,
}: UseMonacoCommentsOptions) {
  const entriesRef = useRef<CommentZoneEntry[]>([]);
  const [newCommentLine, setNewCommentLine] = useState<number | null>(null);

  // Store callbacks in refs to avoid stale closures in detached React roots
  const onAddCommentRef = useRef(onAddComment);
  const onReplyRef = useRef(onReply);
  const onResolveRef = useRef(onResolve);
  const onDeleteRef = useRef(onDelete);
  const onDeleteCommentRef = useRef(onDeleteComment);
  useEffect(() => { onAddCommentRef.current = onAddComment; }, [onAddComment]);
  useEffect(() => { onReplyRef.current = onReply; }, [onReply]);
  useEffect(() => { onResolveRef.current = onResolve; }, [onResolve]);
  useEffect(() => { onDeleteRef.current = onDelete; }, [onDelete]);
  useEffect(() => { onDeleteCommentRef.current = onDeleteComment; }, [onDeleteComment]);

  const cancelNewComment = useCallback(() => setNewCommentLine(null), []);

  // Render existing comment zones (view zone for space + overlay widget for interactive content)
  useEffect(() => {
    if (!editorInstance) return;

    const targetEditor = getTargetEditor(editorInstance);

    // Clean up previous entries
    for (const entry of entriesRef.current) {
      cleanupCommentOverlayZone(targetEditor, entry);
    }
    entriesRef.current = [];

    if (comments.length === 0) return;

    const newEntries: CommentZoneEntry[] = [];

    for (const comment of comments) {
      const entry = createCommentOverlayZone(
        targetEditor,
        comment.lineNumber,
        120,
        `comment-zone-${comment.threadId}`,
        createElement(MonacoCommentZone, {
          comment,
          onSave: () => {},
          onReply: (threadId, text) => onReplyRef.current?.(threadId, text),
          onResolve: (threadId) => onResolveRef.current?.(threadId),
          onDelete: (threadId) => onDeleteRef.current?.(threadId),
          onDeleteComment: (threadId, commentId) =>
            onDeleteCommentRef.current?.(threadId, commentId),
          onCancel: () => {},
          onHeightChange: () => {
            if (!entry.zoneId) return;
            targetEditor.changeViewZones((acc) => {
              acc.layoutZone(entry.zoneId);
            });
          },
        }),
      );
      newEntries.push(entry);
    }

    entriesRef.current = newEntries;

    return () => {
      for (const entry of newEntries) {
        cleanupCommentOverlayZone(targetEditor, entry);
      }
    };
  }, [editorInstance, comments]);

  // Gutter decorations for lines with comments
  useEffect(() => {
    if (!editorInstance || comments.length === 0) return;

    const targetEditor = getTargetEditor(editorInstance);
    const uniqueLines = [...new Set(comments.map((c) => c.lineNumber))];
    const collection = targetEditor.createDecorationsCollection(
      uniqueLines.map((lineNumber) => ({
        range: { startLineNumber: lineNumber, startColumn: 1, endLineNumber: lineNumber, endColumn: 1 },
        options: {
          glyphMarginClassName: 'engy-comment-glyph',
          linesDecorationsClassName: 'engy-comment-line-decoration',
        },
      })),
    );

    return () => collection.clear();
  }, [editorInstance, comments]);

  // Render new comment input zone when gutter is clicked
  useEffect(() => {
    if (!editorInstance || newCommentLine === null) return;

    const targetEditor = getTargetEditor(editorInstance);

    const entry = createCommentOverlayZone(
      targetEditor,
      newCommentLine,
      120,
      'comment-zone-new',
      createElement(MonacoCommentZone, {
        onSave: (text: string) => {
          onAddCommentRef.current?.(newCommentLine, 'modified', text);
          setNewCommentLine(null);
        },
        onCancel: () => setNewCommentLine(null),
        onHeightChange: () => {
          if (!entry.zoneId) return;
          targetEditor.changeViewZones((acc) => {
            acc.layoutZone(entry.zoneId);
          });
        },
      }),
    );

    return () => {
      cleanupCommentOverlayZone(targetEditor, entry);
    };
  }, [editorInstance, newCommentLine]);

  // Gutter click handler — opens new comment input
  useEffect(() => {
    if (!editorInstance || !onAddComment) return;

    const targetEditor = getTargetEditor(editorInstance);
    const disposable = targetEditor.onMouseDown((e) => {
      const isGutter =
        e.target.type === 2 /* GUTTER_GLYPH_MARGIN */ ||
        e.target.type === 3 /* GUTTER_LINE_NUMBERS */ ||
        e.target.type === 4 /* GUTTER_LINE_DECORATIONS */;

      if (isGutter) {
        const lineNumber = e.target.position?.lineNumber;
        if (lineNumber) {
          setNewCommentLine(lineNumber);
        }
      }
    });

    return () => disposable.dispose();
  }, [editorInstance, onAddComment]);

  return { cancelNewComment };
}
