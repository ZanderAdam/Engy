'use client';

import { useState, useCallback } from 'react';
import type { editor } from 'monaco-editor';
import { DynamicMonacoDiffEditor } from '@/components/editor/dynamic-monaco-editors';
import { useMonacoComments } from '@/components/editor/use-monaco-comments';
import type { DiffComment } from './use-diff-comments';
import type { ViewMode } from './types';

interface DiffViewerPanelProps {
  originalContent: string;
  modifiedContent: string;
  viewMode: ViewMode;
  filePath?: string;
  onChange?: (value: string) => void;
  fileComments?: DiffComment[];
  onAddComment?: (lineNumber: number, side: 'modified' | 'original', text: string) => void;
  onReply?: (threadId: string, text: string) => void;
  onResolve?: (threadId: string) => void;
  onDelete?: (threadId: string) => void;
}

export function DiffViewerPanel({
  originalContent,
  modifiedContent,
  viewMode,
  filePath,
  onChange,
  fileComments = [],
  onAddComment,
  onReply,
  onResolve,
  onDelete,
}: DiffViewerPanelProps) {
  const [editorInstance, setEditorInstance] = useState<editor.IStandaloneDiffEditor | null>(null);

  const handleEditorMount = useCallback((ed: editor.IStandaloneDiffEditor) => {
    setEditorInstance(ed);
  }, []);

  useMonacoComments({
    editor: editorInstance,
    comments: fileComments,
    onAddComment,
    onReply,
    onResolve,
    onDelete,
  });

  if (!filePath) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No file selected
      </div>
    );
  }

  if (originalContent === '' && modifiedContent === '') {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No changes detected
      </div>
    );
  }

  return (
    <DynamicMonacoDiffEditor
      original={originalContent}
      modified={modifiedContent}
      filePath={filePath}
      renderSideBySide={viewMode === 'split'}
      onChange={onChange}
      onEditorMount={handleEditorMount}
    />
  );
}
