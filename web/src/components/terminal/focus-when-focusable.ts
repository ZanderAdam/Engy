import type { TerminalActions } from './terminal';

const FOCUS_RETRY_FRAMES = 180;

function isEditableField(element: Element | null): boolean {
  return !!element?.matches('input, textarea') && !element.closest('.xterm');
}

// The focus lands a frame later, so a field the user focused in between (the
// rail's double-click rename input) would lose its caret to the terminal.
function userFocusedAnotherField(requestedFrom: Element | null): boolean {
  const current = document.activeElement;
  return current !== requestedFrom && isEditableField(current);
}

export function focusWhenFocusable(getActions: () => TerminalActions | undefined): void {
  const requestedFrom = document.activeElement;
  let framesLeft = FOCUS_RETRY_FRAMES;

  const attempt = () => {
    if (userFocusedAnotherField(requestedFrom)) return;
    if (getActions()?.focus()) return;
    if (framesLeft > 0) {
      framesLeft -= 1;
      requestAnimationFrame(attempt);
    }
  };

  requestAnimationFrame(attempt);
}
