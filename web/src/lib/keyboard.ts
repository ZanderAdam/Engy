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
