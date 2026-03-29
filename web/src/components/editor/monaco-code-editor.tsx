'use client';

import { useRef, useCallback } from 'react';
import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { ENGY_THEME_NAME, engyDarkTheme } from './monaco-theme';
import { getLanguageFromPath } from './language-map';

export interface MonacoCodeEditorProps {
  content: string;
  filePath: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onEditorMount?: (editor: editor.IStandaloneCodeEditor) => void;
}

export function MonacoCodeEditor({
  content,
  filePath,
  readOnly = false,
  onChange,
  onEditorMount,
}: MonacoCodeEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    monaco.editor.defineTheme(ENGY_THEME_NAME, engyDarkTheme);
  }, []);

  const handleMount: OnMount = useCallback(
    (editor) => {
      editorRef.current = editor;
      onEditorMount?.(editor);
    },
    [onEditorMount],
  );

  const language = getLanguageFromPath(filePath);

  return (
    <Editor
      value={content}
      language={language}
      theme={ENGY_THEME_NAME}
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      onChange={(value) => onChange?.(value ?? '')}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontSize: 12,
        fontFamily: "'JetBrains Mono', Consolas, Courier, monospace",
        lineHeight: 18,
        scrollBeyondLastLine: false,
        overviewRulerLanes: 0,
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
        },
        padding: { top: 8 },
      }}
    />
  );
}
