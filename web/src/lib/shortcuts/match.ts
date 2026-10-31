import { getShortcut, SHORTCUTS, type Binding, type ShortcutId } from './registry';

type KeyInput = Pick<
  KeyboardEvent,
  'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'
> &
  Partial<Pick<KeyboardEvent, 'getModifierState'>>;

export interface MatchContext {
  mac: boolean;
  /** Focus is in a text field or a terminal. */
  typing: boolean;
  inTerminal: boolean;
  phase: 'capture' | 'bubble';
}

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
}

const isLetter = (key: string | undefined): boolean => !!key && /^[a-z]$/i.test(key);

function matchesKey(binding: Binding, e: KeyInput): boolean {
  if (binding.code) return e.code === binding.code;
  return e.key.toLowerCase() === binding.key?.toLowerCase();
}

/** A symbol such as `?` needs Shift on some layouts and not on others, so its
 * Shift state tells nothing. */
function ignoresShift(binding: Binding): boolean {
  return !!binding.key && binding.key.length === 1 && !isLetter(binding.key);
}

function matchesModifiers(binding: Binding, e: KeyInput, mac: boolean): boolean {
  const wantsCtrl = !!binding.ctrl || (!!binding.mod && !mac);
  const wantsMeta = !!binding.mod && mac;
  if (e.ctrlKey !== wantsCtrl || e.metaKey !== wantsMeta) return false;
  if (e.altKey !== !!binding.alt) return false;
  return ignoresShift(binding) || e.shiftKey === !!binding.shift;
}

/** AltGr reports itself as Ctrl+Alt on several layouts, but it types a
 * character. */
const isAltGraph = (e: KeyInput): boolean => !!e.getModifierState?.('AltGraph');

function matchesBinding(binding: Binding, e: KeyInput, mac: boolean): boolean {
  if (isAltGraph(e)) return false;
  return matchesModifiers(binding, e, mac) && matchesKey(binding, e);
}

/** Ctrl+letter is a readline binding, so a focused terminal keeps it. */
function belongsToShell(binding: Binding, mac: boolean): boolean {
  const usesCtrl = !!binding.ctrl || (!!binding.mod && !mac);
  return usesCtrl && !binding.alt && !binding.shift && isLetter(binding.key);
}

export function shortcutForEvent(e: KeyInput, context: MatchContext): ShortcutId | null {
  const { mac, typing, inTerminal, phase } = context;
  for (const def of SHORTCUTS) {
    if (typing && !def.whileTyping) continue;
    for (const binding of def.bindings) {
      if ((phase === 'bubble') !== !!binding.yieldsToPage) continue;
      if (typing && binding.yieldsToPage) continue;
      if (inTerminal && belongsToShell(binding, mac)) continue;
      if (matchesBinding(binding, e, mac)) return def.id;
    }
  }
  return null;
}

const CODE_LABELS: Record<string, string> = {
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Semicolon: ';',
  Slash: '/',
};

const KEY_LABELS: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→' };

function mainKeyLabel(binding: Binding): string {
  if (binding.code) return CODE_LABELS[binding.code] ?? binding.code.replace(/^Key/, '');
  const key = binding.key ?? '';
  return KEY_LABELS[key] ?? key.toUpperCase();
}

export function bindingKeys(binding: Binding, mac: boolean): string[] {
  const keys: string[] = [];
  if (binding.mod) keys.push(mac ? '⌘' : 'Ctrl');
  if (binding.ctrl) keys.push(mac ? '⌃' : 'Ctrl');
  if (binding.alt) keys.push(mac ? '⌥' : 'Alt');
  if (binding.shift) keys.push(mac ? '⇧' : 'Shift');
  keys.push(mainKeyLabel(binding));
  return keys;
}

export function shortcutKeys(id: ShortcutId, mac = isMacPlatform()): string[] {
  const def = getShortcut(id);
  const first = def.bindings[0];
  if (!first) return def.sequence ?? def.keys ?? [];
  return bindingKeys(first, mac);
}

export function shortcutText(id: ShortcutId, mac = isMacPlatform()): string {
  return shortcutKeys(id, mac).join('+');
}

/** Why a shortcut can stay silent, for the help view. */
export function shortcutLimit(id: ShortcutId, mac = isMacPlatform()): string | null {
  const def = getShortcut(id);
  if (!def.whileTyping) return 'Not in text fields';
  const first = def.bindings[0];
  return first && belongsToShell(first, mac) ? 'Not in terminals' : null;
}
