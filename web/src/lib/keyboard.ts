/**
 * True while focus sits in something that owns its own keystrokes — a text
 * field, a textarea (xterm renders terminal input as one), or a contenteditable
 * surface. Global `window` keydown handlers must bail on this before claiming a
 * Ctrl/Cmd+letter combo, or they steal bindings the focused control needs:
 * Ctrl+W is readline's delete-word, Ctrl+T its transpose-characters.
 */
export function isTypingTarget(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el.closest('[contenteditable="true"]') !== null
  );
}

/**
 * True when Enter or space was pressed on a `role="button"`/`role="tab"` row
 * itself, not on a control nested inside it. React events — including those
 * from portalled dialogs, which bubble up the React tree rather than the DOM —
 * reach the row from every descendant, so a row that activates on bare `key`
 * steals space from any nested textarea and Enter from any nested button.
 */
export function isSelfActivation(e: {
  key: string;
  target: EventTarget | null;
  currentTarget: EventTarget | null;
}): boolean {
  if (e.target !== e.currentTarget) return false;
  return e.key === 'Enter' || e.key === ' ';
}
