const MAX_TITLE_LENGTH = 256;

/**
 * Strip control characters from untrusted terminal-sourced text — crafted
 * OSC payloads have caused CVEs in terminal emulators. Shared by every
 * caller that reaches text originating from a hook or OSC sequence;
 * `sanitizeOscTitle` layers a length cap and trim on top for title use.
 */
export function stripControlCharacters(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0)!;
    const isControl = code < 0x20 || (code >= 0x7f && code <= 0x9f);
    if (isControl) continue;
    out += ch;
  }
  return out;
}

/**
 * Sanitize a title extracted from an OSC 0/2 sequence before rendering or
 * persisting it: strip control characters, trim whitespace, and cap the length.
 */
export function sanitizeOscTitle(raw: string): string {
  let out = '';
  for (const ch of stripControlCharacters(raw)) {
    // Cap at a code-point boundary — a blind slice could halve a surrogate pair.
    if (out.length + ch.length > MAX_TITLE_LENGTH) break;
    out += ch;
  }
  return out.trim();
}
