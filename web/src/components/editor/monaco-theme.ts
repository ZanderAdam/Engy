import type { editor } from 'monaco-editor';

export const ENGY_THEME_NAME = 'engy-dark';

export const engyDarkTheme: editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#09090b',
    'editor.foreground': '#e4e4e7',
    'editor.lineHighlightBackground': '#18181b',
    'editor.selectionBackground': '#3b82f620',
    'editorLineNumber.foreground': '#71717a',
    'editorLineNumber.activeForeground': '#a1a1aa',
    'editorGutter.background': '#09090b',
    'editorCursor.foreground': '#e4e4e7',
    'diffEditor.insertedTextBackground': '#2ea04340',
    'diffEditor.removedTextBackground': '#f8514940',
    'diffEditor.insertedLineBackground': '#2ea04325',
    'diffEditor.removedLineBackground': '#f8514925',
    'editorWidget.background': '#18181b',
    'editorWidget.border': '#27272a',
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': '#27272a80',
    'scrollbarSlider.hoverBackground': '#3f3f4680',
    'scrollbarSlider.activeBackground': '#52525b80',
  },
};
