'use client';

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { editor } from 'monaco-editor';
import { MonacoCommentZone } from './monaco-comment-zone';
import type { DiffComment } from '@/components/diff/use-diff-comments';

interface UseMonacoCommentsOptions {
  editor: editor.IStandaloneCodeEditor | editor.IStandaloneDiffEditor | null;
  comments: DiffComment[];
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

interface CommentZoneEntry {
  zoneId: string;
  widget: editor.IOverlayWidget;
  root: Root;
  resize: (height: number) => void;
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

  const zoneDescriptor: editor.IViewZone = {
    afterLineNumber,
    heightInPx: 80,
    domNode: document.createElement('div'),
    suppressMouseDown: true,
    onDomNodeTop: (top) => {
      overlayNode.style.top = `${top}px`;
    },
    onComputedHeight: (height) => {
      overlayNode.style.height = `${height}px`;
    },
  };

  let zoneId = '';
  targetEditor.changeViewZones((accessor) => {
    zoneId = accessor.addZone(zoneDescriptor);
  });

  const resize = (height: number) => {
    zoneDescriptor.heightInPx = height;
    targetEditor.changeViewZones((accessor) => {
      accessor.layoutZone(zoneId);
    });
  };

  return { zoneId, widget, root, resize };
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
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);

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
          onHeightChange: (height) => entry.resize(height),
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

  const commentedLines = useMemo(
    () => new Set(comments.map((c) => c.lineNumber)),
    [comments],
  );

  // Gutter decorations for lines with comments
  useEffect(() => {
    if (!editorInstance || commentedLines.size === 0) return;

    const targetEditor = getTargetEditor(editorInstance);
    const collection = targetEditor.createDecorationsCollection(
      [...commentedLines].map((lineNumber) => ({
        range: { startLineNumber: lineNumber, startColumn: 1, endLineNumber: lineNumber, endColumn: 1 },
        options: {
          glyphMarginClassName: 'engy-comment-glyph',
          linesDecorationsClassName: 'engy-comment-line-decoration',
        },
      })),
    );

    return () => collection.clear();
  }, [editorInstance, commentedLines]);

  // The gutter is clickable on every line, but nothing said so — an empty margin
  // reads as decoration, not as a target. Tracking the line under the pointer
  // lets one "+" follow the cursor, the same affordance a pull request shows.
  //
  // Depends on the editor alone. Keying this on `onAddComment` would re-subscribe
  // whenever the caller passes a fresh closure, and the teardown would land
  // between the pointer moving and the glyph rendering.
  useEffect(() => {
    if (!editorInstance) return;

    const targetEditor = getTargetEditor(editorInstance);
    const move = targetEditor.onMouseMove((e) => {
      if (!onAddCommentRef.current) return;
      setHoveredLine(e.target.position?.lineNumber ?? null);
    });
    const leave = targetEditor.onMouseLeave(() => setHoveredLine(null));

    return () => {
      move.dispose();
      leave.dispose();
    };
  }, [editorInstance]);

  useEffect(() => {
    if (!editorInstance) return;
    // A line that already carries a comment shows its own marker; a second
    // glyph in the same margin would just collide with it.
    if (hoveredLine === null || commentedLines.has(hoveredLine)) return;

    const targetEditor = getTargetEditor(editorInstance);
    const collection = targetEditor.createDecorationsCollection([
      {
        range: {
          startLineNumber: hoveredLine,
          startColumn: 1,
          endLineNumber: hoveredLine,
          endColumn: 1,
        },
        options: {
          glyphMarginClassName: 'engy-add-comment-glyph',
          glyphMarginHoverMessage: { value: 'Comment on this line' },
        },
      },
    ]);

    return () => collection.clear();
  }, [editorInstance, hoveredLine, commentedLines]);

  // Render new comment input zone when gutter is clicked
  useEffect(() => {
    if (!editorInstance || newCommentLine === null) return;

    const targetEditor = getTargetEditor(editorInstance);

    const entry = createCommentOverlayZone(
      targetEditor,
      newCommentLine,
      'comment-zone-new',
      createElement(MonacoCommentZone, {
        onSave: (text: string) => {
          // The line the comment anchors to, read as the reviewer saw it. Captured
          // here because this is the only layer holding the model.
          const codeLine = targetEditor.getModel()?.getLineContent(newCommentLine) ?? '';
          onAddCommentRef.current?.(newCommentLine, 'modified', text, codeLine);
          setNewCommentLine(null);
        },
        onCancel: () => setNewCommentLine(null),
        onHeightChange: (height) => entry.resize(height),
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
