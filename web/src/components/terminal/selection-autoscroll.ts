import type { Terminal } from 'ghostty-web';

/** The slice of the emulator's selection manager this reaches for. */
interface SelectionAutoScroller {
  updateAutoScroll?: (offsetY: number, clientHeight: number) => void;
  stopAutoScroll?: () => void;
}

/**
 * Stop a selection drag inside the pane from throwing the selection away.
 *
 * ghostty-web auto-scrolls whenever a drag sits within 30 pixels of the pane's
 * top or bottom edge, and each tick of that scroll does not extend the
 * selection — it moves the loose end to the far end of the buffer outright
 * (`{ col: 0, absoluteRow: top }` going up, the last cell going down). A drag
 * that starts or ends anywhere near an edge therefore selects the whole buffer
 * up to that point instead of the text under the pointer.
 *
 * The 30 pixels are two rows of a 13-row terminal dock, top and bottom — which
 * is where the prompt and the newest output are, so in practice selecting the
 * output of the last command never worked. Only the edge trigger goes: leaving
 * the pane mid-drag still auto-scrolls, through the emulator's own `mouseleave`
 * and document-level handlers, which is where a terminal is expected to do it.
 */
export function confineSelectionAutoScroll(term: Terminal): void {
  const selection = (term as unknown as { selectionManager?: SelectionAutoScroller })
    .selectionManager;

  if (typeof selection?.updateAutoScroll !== 'function') {
    console.error(
      '[terminal-ui] ghostty-web has no selectionManager.updateAutoScroll to confine — a selection dragged near the top or bottom edge will jump to the end of the buffer. Update confineSelectionAutoScroll in selection-autoscroll.ts for this version.',
    );
    return;
  }

  const stop = selection.stopAutoScroll?.bind(selection);
  // Cancels rather than ignores, so a drag that comes back into the pane also
  // ends the scroll it started on the way out.
  selection.updateAutoScroll = () => stop?.();
}
