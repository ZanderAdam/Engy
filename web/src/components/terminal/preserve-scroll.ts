/** The slice of a terminal the re-pinning needs — kept narrow so tests can fake it. */
interface ScrollableTerminal {
  getViewportY(): number;
  getScrollbackLength(): number;
  scrollToLine(line: number): void;
  write(data: string): void;
}

/**
 * Write output without dragging a user who is reading scrollback back to the bottom.
 *
 * ghostty-web's `write` unconditionally snaps the viewport to the bottom whenever
 * it isn't already there, so every PTY byte cancels a scroll — and an agent TUI
 * emits them continuously. It has no equivalent of xterm's `isUserScrolling`, so
 * auto-follow is reconstructed here: viewportY counts lines above the bottom, and
 * a write only shifts the content under it by however many lines it pushed into
 * scrollback. Re-pinning by that delta holds the same text in view. A viewport
 * already at the bottom is left alone, so output follows.
 */
export function writePreservingScroll(term: ScrollableTerminal, data: string): void {
  // An empty write throws inside the emulator, which gives the zero-length
  // array to Uint8Array.set. There is also nothing to write.
  if (data.length === 0) return;

  const pinned = term.getViewportY();
  if (pinned === 0) {
    term.write(data);
    return;
  }

  const lengthBefore = term.getScrollbackLength();
  term.write(data);
  term.scrollToLine(pinned + (term.getScrollbackLength() - lengthBefore));
}
