/** The parts of a key press the overrides look at. */
export interface KeyChord {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
 * The bytes the pane sends itself for chords the emulator gets wrong.
 *
 * Returns null for everything else, which leaves the key to ghostty-web.
 * Only a bare Shift qualifies: adding another modifier makes a different chord,
 * and swallowing those would hide them from the emulator for no reason.
 */
export function keyOverrideBytes(event: KeyChord): string | null {
  if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return null;

  // Line continuation, so a shell reads the next line as part of this command.
  if (event.key === 'Enter') return '\\\r';

  // Backtab. ghostty-web encodes a Shift-modified key exactly as the unmodified
  // one, so Shift+Tab reaches the PTY as a plain tab and any program that reads
  // CSI Z — a TUI cycling backwards through its modes, a reverse completion —
  // never learns the key was pressed.
  if (event.key === 'Tab') return '\x1b[Z';

  return null;
}
