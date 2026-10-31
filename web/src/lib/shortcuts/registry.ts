export type ShortcutId =
  | 'help'
  | 'search'
  | 'quickCapture'
  | 'toggleTerminal'
  | 'toggleBottomTerminal'
  | 'focusTerminal'
  | 'toggleLeftPanel'
  | 'toggleRightPanel'
  | 'toggleInboxList'
  | 'quickOpen'
  | 'newTab'
  | 'closeTab'
  | 'nextTab'
  | 'prevTab'
  | 'focusTerminalNumber'
  | 'goInbox'
  | 'goTasks'
  | 'goDocs'
  | 'goCode'
  | 'goMemory';

export interface Binding {
  /** Cmd on Mac and iOS, Ctrl everywhere else. */
  mod?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  /** Character match. Use for letters, so non-QWERTY layouts keep their labels. */
  key?: string;
  /** Physical key match. Use for punctuation and Alt combos, where Shift and
   * Option rewrite `key`. */
  code?: string;
  /** Runs after page listeners, so a page that owns this key keeps it. */
  yieldsToPage?: boolean;
}

interface ShortcutDef {
  id: ShortcutId;
  label: string;
  group: string;
  bindings: Binding[];
  /** Keys pressed one after the other. */
  sequence?: string[];
  /** Display only: Ctrl+Alt+1-9 also reveals the rail numbers while held, so it
   * keeps its own listener. */
  keys?: string[];
  /** Still fires with focus in a text field or terminal. */
  whileTyping?: boolean;
}

export const CHORD_LEADER = 'g';

const chord = (id: ShortcutId, label: string, second: string): ShortcutDef => ({
  id,
  label,
  group: 'Navigate',
  bindings: [],
  sequence: [CHORD_LEADER, second],
});

export const SHORTCUTS: ShortcutDef[] = [
  {
    id: 'help',
    label: 'Show shortcuts',
    group: 'General',
    bindings: [
      { mod: true, code: 'Slash' },
      { key: '?', yieldsToPage: true },
    ],
    whileTyping: true,
  },
  {
    id: 'search',
    label: 'Search',
    group: 'General',
    bindings: [{ mod: true, key: 'k' }],
    whileTyping: true,
  },
  {
    id: 'quickCapture',
    label: 'Quick capture',
    group: 'General',
    bindings: [{ mod: true, shift: true, key: 'm' }],
    whileTyping: true,
  },
  {
    id: 'toggleTerminal',
    label: 'Toggle terminal sidebar',
    group: 'Terminal',
    bindings: [{ ctrl: true, code: 'Backquote' }],
    whileTyping: true,
  },
  {
    id: 'toggleBottomTerminal',
    label: 'Toggle bottom terminal',
    group: 'Terminal',
    bindings: [{ ctrl: true, key: 'j' }],
  },
  {
    id: 'focusTerminal',
    label: 'Jump to terminal and back',
    group: 'Terminal',
    bindings: [{ ctrl: true, alt: true, code: 'Backquote' }],
    whileTyping: true,
  },
  {
    id: 'focusTerminalNumber',
    label: 'Focus terminal 1-9',
    group: 'Terminal',
    bindings: [],
    keys: ['Ctrl', 'Alt', '1-9'],
    whileTyping: true,
  },
  {
    id: 'toggleLeftPanel',
    label: 'Toggle left panel',
    group: 'Panels',
    bindings: [{ mod: true, shift: true, code: 'Comma' }],
  },
  {
    id: 'toggleRightPanel',
    label: 'Toggle right panel',
    group: 'Panels',
    bindings: [{ mod: true, shift: true, code: 'Period' }],
  },
  {
    id: 'toggleInboxList',
    label: 'Toggle inbox list',
    group: 'Panels',
    bindings: [{ mod: true, shift: true, code: 'Semicolon' }],
  },
  {
    id: 'quickOpen',
    label: 'Go to file (code page)',
    group: 'Navigate',
    bindings: [{ mod: true, key: 'p' }],
    whileTyping: true,
  },
  chord('goInbox', 'Go to inbox', 'i'),
  chord('goTasks', 'Go to tasks', 't'),
  chord('goDocs', 'Go to docs', 'd'),
  chord('goCode', 'Go to code', 'c'),
  chord('goMemory', 'Go to memory', 'm'),
  {
    id: 'newTab',
    label: 'New tab',
    group: 'Tabs',
    // Browsers keep Mod+T and Mod+W for themselves in a plain tab. They only
    // reach the page in an installed app, so the Alt form comes first.
    bindings: [
      { mod: true, alt: true, code: 'KeyT' },
      { mod: true, key: 't' },
    ],
  },
  {
    id: 'closeTab',
    label: 'Close tab',
    group: 'Tabs',
    bindings: [
      { mod: true, alt: true, code: 'KeyW' },
      { mod: true, key: 'w' },
    ],
  },
  {
    id: 'nextTab',
    label: 'Next tab',
    group: 'Tabs',
    bindings: [{ mod: true, alt: true, key: 'ArrowRight' }],
    whileTyping: true,
  },
  {
    id: 'prevTab',
    label: 'Previous tab',
    group: 'Tabs',
    bindings: [{ mod: true, alt: true, key: 'ArrowLeft' }],
    whileTyping: true,
  },
];

export function getShortcut(id: ShortcutId): ShortcutDef {
  const def = SHORTCUTS.find((s) => s.id === id);
  if (!def) throw new Error(`Unknown shortcut "${id}". Add it to SHORTCUTS in registry.ts.`);
  return def;
}
