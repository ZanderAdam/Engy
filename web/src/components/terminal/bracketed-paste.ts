const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
// Text containing either sentinel would break out of the paste region and land
// as raw keystrokes. Strip both so composed text can never escape.
const PASTE_SENTINEL_RE = /\x1b\[20[01]~/g;

/**
 * Wrap text the way a real terminal paste arrives, so a program reads it as one
 * pasted block instead of a keystroke stream — line breaks stay line breaks
 * rather than submitting the prompt, and predictive-keyboard composition never
 * enters the picture.
 */
export function toBracketedPaste(text: string): string {
  const body = text.replace(PASTE_SENTINEL_RE, '').replace(/\r\n|\n/g, '\r');
  return `${PASTE_START}${body}${PASTE_END}`;
}
