'use client';

import { useRef, useCallback, useEffect } from 'react';
import { DiffEditor, type DiffBeforeMount, type DiffOnMount } from '@monaco-editor/react';
import type { editor, IDisposable } from 'monaco-editor';
import { ENGY_THEME_NAME, ENGY_CYBERPUNK_THEME_NAME } from './monaco-theme';
import { configureMonaco } from './monaco-setup';
import { getLanguageFromPath } from './language-map';
import { diffModelPaths } from './monaco-models';
import { useIsMobile } from '@/hooks/use-mobile';
import { useThemeFlavor } from '@/components/theme-provider';

interface MonacoDiffEditorProps {
  original: string;
  modified: string;
  filePath: string;
  /** Absolute repo root — folded into the model URIs so each file gets stable, unique models. */
  repoRoot: string;
  /** Namespaces the model URIs so this surface never shares a model with another. */
  modelNamespace?: string;
  renderSideBySide?: boolean;
  onChange?: (value: string) => void;
  onEditorMount?: (editor: editor.IStandaloneDiffEditor) => void;
}

export function MonacoDiffEditor({
  original,
  modified,
  filePath,
  repoRoot,
  modelNamespace = 'diff',
  renderSideBySide = true,
  onChange,
  onEditorMount,
}: MonacoDiffEditorProps) {
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  // Per-file scroll position (pixels), keyed by model path, so switching tabs
  // returns each file to where it was. We keep only scrollTop rather than a full
  // IDiffEditorViewState: restoring cursor/fold positions fights hideUnchangedRegions
  // (a restored line can land in a collapsed region, throwing "Illegal value for
  // lineNumber" during a later layout), whereas setScrollTop clamps and never throws.
  const scrollTopsRef = useRef<Map<string, number>>(new Map());
  const isMobile = useIsMobile();
  const { flavor } = useThemeFlavor();

  const { originalModelPath, modifiedModelPath } = diffModelPaths(
    modelNamespace,
    repoRoot,
    filePath,
  );

  const handleBeforeMount: DiffBeforeMount = useCallback((monaco) => {
    configureMonaco(monaco);
  }, []);

  const handleMount: DiffOnMount = useCallback(
    (editor) => {
      editorRef.current = editor;
      onEditorMount?.(editor);

      const modifiedEditor = editor.getModifiedEditor();
      // Only persist edits the user actually typed. @monaco-editor/react also fires
      // this event when it programmatically syncs fetched content into the model on
      // a file switch; forwarding those to auto-save would write a file's content
      // back over itself (and, before per-file models, into the wrong file). A
      // programmatic sync happens while the editor is blurred (focus moved to the
      // clicked tab/file), so a focused change is the reliable "user edit" signal.
      modifiedEditor.onDidChangeModelContent(() => {
        if (!modifiedEditor.hasTextFocus()) return;
        onChangeRef.current?.(modifiedEditor.getValue());
      });
    },
    [onEditorMount],
  );

  // Preserve each file's scroll position across tab switches. The DiffEditor
  // (unlike @monaco-editor/react's single-file Editor) doesn't persist anything
  // when its models swap, so we do it ourselves. React runs all effect cleanups
  // before any setup, so the cleanup captures the OUTGOING file's scrollTop before
  // the library swaps models; the incoming file is restored once its diff (and
  // hideUnchangedRegions layout) recomputes, so the pixel offset is valid.
  useEffect(() => {
    // `editorRef.current` is null on first mount (the DiffEditor loads via
    // dynamic() and sets the ref in onMount, after this effect first runs), so no
    // subscription is registered and nothing is restored — correct, since the map
    // starts empty. Declared with `let` so the listener can dispose itself without
    // reading `sub` before its initializer completes.
    const ed = editorRef.current;
    const scrollTops = scrollTopsRef.current;
    const saved = ed ? scrollTops.get(modifiedModelPath) : undefined;
    let sub: IDisposable | undefined;
    if (ed && saved !== undefined) {
      sub = ed.onDidUpdateDiff(() => {
        sub?.dispose();
        ed.getModifiedEditor().setScrollTop(saved);
      });
    }
    return () => {
      sub?.dispose();
      const top = editorRef.current?.getModifiedEditor().getScrollTop();
      if (top !== undefined) scrollTops.set(modifiedModelPath, top);
    };
  }, [modifiedModelPath]);

  const language = getLanguageFromPath(filePath);

  const maxLines = Math.max(
    original.split('\n').length,
    modified.split('\n').length,
  );
  const digits = Math.max(2, String(maxLines).length);
  const lineNumbersMinChars = isMobile ? digits : 5;

  return (
    <DiffEditor
      original={original}
      modified={modified}
      originalModelPath={originalModelPath}
      modifiedModelPath={modifiedModelPath}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      language={language}
      theme={flavor === 'cyberpunk' ? ENGY_CYBERPUNK_THEME_NAME : ENGY_THEME_NAME}
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      options={{
        readOnly: false,
        originalEditable: false,
        renderSideBySide,
        minimap: { enabled: false },
        glyphMargin: !isMobile,
        folding: !isMobile,
        lineNumbers: 'on',
        lineNumbersMinChars,
        lineDecorationsWidth: isMobile ? 0 : 10,
        renderIndicators: !isMobile,
        renderMarginRevertIcon: !isMobile,
        hideUnchangedRegions: {
          enabled: true,
          revealLineCount: 20,
          minimumLineCount: 3,
          contextLineCount: 3,
        },
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
