import type { TerminalTab } from './types';

const MAX_TITLE_LENGTH = 256;

/**
 * Sanitize a title extracted from an OSC 0/2 sequence before rendering it in
 * the tab strip: strip control characters (crafted OSC payloads have caused
 * CVEs in terminal emulators), trim whitespace, and cap the length.
 */
export function sanitizeOscTitle(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0)!;
    const isControl = code < 0x20 || (code >= 0x7f && code <= 0x9f);
    if (isControl) continue;
    // Cap at a code-point boundary — a blind slice could halve a surrogate pair.
    if (out.length + ch.length > MAX_TITLE_LENGTH) break;
    out += ch;
  }
  return out.trim();
}

/**
 * Apply an OSC title update to a tab. Returns the updated tab, or null when
 * the title is unchanged after sanitization so callers can skip redundant
 * re-renders.
 */
export function applyOscTitle(tab: TerminalTab, rawTitle: string): TerminalTab | null {
  const oscTitle = sanitizeOscTitle(rawTitle) || undefined;
  if (tab.oscTitle === oscTitle) return null;
  return { ...tab, oscTitle };
}
