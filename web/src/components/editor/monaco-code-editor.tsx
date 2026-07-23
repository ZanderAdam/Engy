'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { ENGY_THEME_NAME, ENGY_CYBERPUNK_THEME_NAME } from './monaco-theme';
import { configureMonaco } from './monaco-setup';
import { useThemeFlavor } from '@/components/theme-provider';
import { buildCodeEditorOptions } from './monaco-options';
import { namespacedModelPath } from './monaco-models';
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
  /**
   * Namespaces the model URI so distinct surfaces (e.g. the code page vs. the diff
   * page's edit view) never share a Monaco model for the same file path. The
   * model cache in @monaco-editor/react is module-global and keyed only on path.
   */
  modelNamespace?: string;
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
  modelNamespace = 'file',
  readOnly = false,
  wordWrap = false,
  minimap = true,
  onChange,
  onCursorChange,
  onEditorMount,
}: MonacoCodeEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const { flavor } = useThemeFlavor();
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
  const path = namespacedModelPath(modelNamespace, repoRoot, filePath);
  const language = getLanguageFromPath(filePath);

  return (
    <Editor
      path={path}
      value={content}
      language={language}
      theme={flavor === 'cyberpunk' ? ENGY_CYBERPUNK_THEME_NAME : ENGY_THEME_NAME}
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      onChange={(value) => onChange?.(value ?? '')}
      options={options}
    />
  );
}
