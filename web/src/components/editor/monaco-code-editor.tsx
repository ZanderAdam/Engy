'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { ENGY_THEME_NAME } from './monaco-theme';
import { configureMonaco } from './monaco-setup';
import { buildCodeEditorOptions } from './monaco-options';
import { buildModelPath } from './monaco-models';
import { getLanguageFromPath } from './language-map';

export interface CursorPosition {
  line: number;
  column: number;
}

interface MonacoCodeEditorProps {
  content: string;
  filePath: string;
  /** Absolute repo root — folded into the model URI so each file gets a stable, unique model. */
  repoRoot: string;
  readOnly?: boolean;
  wordWrap?: boolean;
  minimap?: boolean;
  onChange?: (value: string) => void;
  onCursorChange?: (pos: CursorPosition) => void;
  onEditorMount?: (editor: editor.IStandaloneCodeEditor) => void;
}

export function MonacoCodeEditor({
  content,
  filePath,
  repoRoot,
  readOnly = false,
  wordWrap = false,
  minimap = true,
  onChange,
  onCursorChange,
  onEditorMount,
}: MonacoCodeEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const onCursorChangeRef = useRef(onCursorChange);
  useEffect(() => {
    onCursorChangeRef.current = onCursorChange;
  }, [onCursorChange]);

  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    configureMonaco(monaco);
  }, []);

  const handleMount: OnMount = useCallback(
    (editor) => {
      editorRef.current = editor;

      const emitCursor = () => {
        const pos = editor.getPosition();
        if (pos) onCursorChangeRef.current?.({ line: pos.lineNumber, column: pos.column });
      };
      editor.onDidChangeCursorPosition(emitCursor);
      emitCursor();

      onEditorMount?.(editor);
    },
    [onEditorMount],
  );

  const options = useMemo(
    () => buildCodeEditorOptions({ readOnly, wordWrap, minimap }),
    [readOnly, wordWrap, minimap],
  );

  // A stable, unique path per file drives @monaco-editor/react's model + view-state
  // cache, so switching tabs preserves each file's cursor, scroll, undo history and
  // language-service model.
  const path = buildModelPath(repoRoot, filePath);
  const language = getLanguageFromPath(filePath);

  return (
    <Editor
      path={path}
      value={content}
      language={language}
      theme={ENGY_THEME_NAME}
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      onChange={(value) => onChange?.(value ?? '')}
      options={options}
    />
  );
}
