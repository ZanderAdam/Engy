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

export function useMonacoComments({
  editor: editorInstance,
  comments,
  onAddComment,
  onReply,
  onResolve,
  onDelete,
}: UseMonacoCommentsOptions) {
  const zoneIdsRef = useRef<string[]>([]);
  const rootsRef = useRef<Root[]>([]);
  const [newCommentLine, setNewCommentLine] = useState<number | null>(null);

  // Store callbacks in refs to avoid stale closures
  const onAddCommentRef = useRef(onAddComment);
  useEffect(() => { onAddCommentRef.current = onAddComment; }, [onAddComment]);

  const cancelNewComment = useCallback(() => setNewCommentLine(null), []);

  // Render existing comment viewZones
  useEffect(() => {
    if (!editorInstance) return;

    const targetEditor = getTargetEditor(editorInstance);

    // Clean up previous zones
    targetEditor.changeViewZones((accessor) => {
      for (const id of zoneIdsRef.current) {
        accessor.removeZone(id);
      }
    });
    for (const root of rootsRef.current) {
      root.unmount();
    }
    zoneIdsRef.current = [];
    rootsRef.current = [];

    if (comments.length === 0) return;

    const newZoneIds: string[] = [];
    const newRoots: Root[] = [];

    targetEditor.changeViewZones((accessor) => {
      for (const comment of comments) {
        const domNode = document.createElement('div');
        const root = createRoot(domNode);
        newRoots.push(root);

        const zoneIdRef = { current: '' };

        root.render(
          createElement(MonacoCommentZone, {
            comment,
            onSave: () => {},
            onReply,
            onResolve,
            onDelete,
            onCancel: () => {},
            onHeightChange: (height: number) => {
              targetEditor.changeViewZones((acc) => {
                acc.layoutZone(zoneIdRef.current);
              });
              domNode.style.height = `${height}px`;
            },
          }),
        );

        zoneIdRef.current = accessor.addZone({
          afterLineNumber: comment.lineNumber,
          heightInPx: 120,
          domNode,
        });
        newZoneIds.push(zoneIdRef.current);
      }
    });

    zoneIdsRef.current = newZoneIds;
    rootsRef.current = newRoots;

    return () => {
      targetEditor.changeViewZones((accessor) => {
        for (const id of newZoneIds) {
          accessor.removeZone(id);
        }
      });
      for (const root of newRoots) {
        root.unmount();
      }
    };
  }, [editorInstance, comments, onReply, onResolve, onDelete]);

  // Render new comment input zone when gutter is clicked
  useEffect(() => {
    if (!editorInstance || newCommentLine === null) return;

    const targetEditor = getTargetEditor(editorInstance);
    const domNode = document.createElement('div');
    const root = createRoot(domNode);
    let zoneId = '';

    root.render(
      createElement(MonacoCommentZone, {
        onSave: (text: string) => {
          onAddCommentRef.current?.(newCommentLine, 'modified', text);
          setNewCommentLine(null);
        },
        onCancel: () => setNewCommentLine(null),
        onHeightChange: (height: number) => {
          targetEditor.changeViewZones((acc) => {
            acc.layoutZone(zoneId);
          });
          domNode.style.height = `${height}px`;
        },
      }),
    );

    targetEditor.changeViewZones((accessor) => {
      zoneId = accessor.addZone({
        afterLineNumber: newCommentLine,
        heightInPx: 120,
        domNode,
      });
    });

    return () => {
      targetEditor.changeViewZones((accessor) => {
        accessor.removeZone(zoneId);
      });
      root.unmount();
    };
  }, [editorInstance, newCommentLine]);

  // Gutter click handler — opens new comment input
  useEffect(() => {
    if (!editorInstance || !onAddComment) return;

    const targetEditor = getTargetEditor(editorInstance);
    const disposable = targetEditor.onMouseDown((e) => {
      if (
        e.target.type === 2 /* GUTTER_GLYPH_MARGIN */ ||
        e.target.type === 3 /* GUTTER_LINE_NUMBERS */
      ) {
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
