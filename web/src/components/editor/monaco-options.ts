import type { editor } from 'monaco-editor';

interface CodeEditorOptionsInput {
  readOnly?: boolean;
  wordWrap?: boolean;
  minimap?: boolean;
  fontSize?: number;
}

const FONT_FAMILY = "'JetBrains Mono', Consolas, Courier, monospace";

/**
 * Builds the full set of Monaco options for the code editor. Kept as a pure
 * function so the configuration is unit-testable without instantiating Monaco.
 *
 * Enables the IDE-grade features Monaco ships with — IntelliSense, sticky
 * scroll, bracket-pair colorization, inlay hints, linked editing, code folding,
 * format-on-paste — that the previous minimal config left switched off.
 */
export function buildCodeEditorOptions(
  input: CodeEditorOptionsInput = {},
): editor.IStandaloneEditorConstructionOptions {
  const { readOnly = false, wordWrap = false, minimap = true, fontSize = 13 } = input;

  return {
    readOnly,
    fontSize,
    fontFamily: FONT_FAMILY,
    fontLigatures: true,
    lineHeight: 19,
    letterSpacing: 0.2,

    // Navigation & structure
    minimap: { enabled: minimap, renderCharacters: false, maxColumn: 100 },
    stickyScroll: { enabled: true },
    folding: true,
    foldingHighlight: true,
    showFoldingControls: 'mouseover',
    glyphMargin: true,
    lineNumbers: 'on',
    lineNumbersMinChars: 3,
    renderLineHighlight: 'all',
    cursorSurroundingLines: 4,
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    mouseWheelZoom: true,

    // Word wrap (toggleable)
    wordWrap: wordWrap ? 'on' : 'off',
    wrappingIndent: 'same',

    // Brackets, guides & matching
    bracketPairColorization: { enabled: true },
    matchBrackets: 'always',
    guides: {
      bracketPairs: true,
      bracketPairsHorizontal: true,
      indentation: true,
      highlightActiveIndentation: true,
      highlightActiveBracketPair: true,
    },

    // Editing aids
    formatOnPaste: true,
    formatOnType: true,
    linkedEditing: true,
    autoClosingBrackets: 'languageDefined',
    autoClosingQuotes: 'languageDefined',
    autoSurround: 'languageDefined',
    autoIndent: 'full',
    dragAndDrop: true,
    columnSelection: false,
    multiCursorModifier: 'alt',
    occurrencesHighlight: 'singleFile',
    selectionHighlight: true,
    renderWhitespace: 'selection',
    renderControlCharacters: true,
    tabSize: 2,
    detectIndentation: true,
    trimAutoWhitespace: true,

    // IntelliSense / suggestions
    quickSuggestions: { other: true, comments: false, strings: false },
    suggestOnTriggerCharacters: true,
    acceptSuggestionOnEnter: 'smart',
    tabCompletion: 'on',
    wordBasedSuggestions: 'matchingDocuments',
    parameterHints: { enabled: true, cycle: true },
    inlayHints: { enabled: 'on' },
    hover: { enabled: true, above: false, sticky: true },
    suggest: {
      showStatusBar: true,
      preview: true,
      shareSuggestSelections: true,
      insertMode: 'replace',
    },
    suggestSelection: 'recentlyUsedByPrefix',
    snippetSuggestions: 'inline',

    // Find widget
    find: {
      addExtraSpaceOnTop: false,
      seedSearchStringFromSelection: 'selection',
      autoFindInSelection: 'multiline',
    },

    // Misc UX
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    contextmenu: true,
    fixedOverflowWidgets: true,
    padding: { top: 8, bottom: 8 },
    overviewRulerLanes: 3,
    scrollbar: {
      verticalScrollbarSize: 10,
      horizontalScrollbarSize: 10,
      useShadows: true,
      alwaysConsumeMouseWheel: false,
    },
  };
}
