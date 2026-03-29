'use client';

import { useRef, useCallback, useEffect } from 'react';
import { DiffEditor, type DiffBeforeMount, type DiffOnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { ENGY_THEME_NAME, engyDarkTheme } from './monaco-theme';
import { getLanguageFromPath } from './language-map';

interface MonacoDiffEditorProps {
  original: string;
  modified: string;
  filePath: string;
  renderSideBySide?: boolean;
  onChange?: (value: string) => void;
  onEditorMount?: (editor: editor.IStandaloneDiffEditor) => void;
}

export function MonacoDiffEditor({
  original,
  modified,
  filePath,
  renderSideBySide = true,
  onChange,
  onEditorMount,
}: MonacoDiffEditorProps) {
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const handleBeforeMount: DiffBeforeMount = useCallback((monaco) => {
    monaco.editor.defineTheme(ENGY_THEME_NAME, engyDarkTheme);
  }, []);

  const handleMount: DiffOnMount = useCallback(
    (editor) => {
      editorRef.current = editor;
      onEditorMount?.(editor);

      const modifiedEditor = editor.getModifiedEditor();
      modifiedEditor.onDidChangeModelContent(() => {
        onChangeRef.current?.(modifiedEditor.getValue());
      });
    },
    [onEditorMount],
  );

  const language = getLanguageFromPath(filePath);

  return (
    <DiffEditor
      original={original}
      modified={modified}
      language={language}
      theme={ENGY_THEME_NAME}
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      options={{
        readOnly: false,
        originalEditable: false,
        renderSideBySide,
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
