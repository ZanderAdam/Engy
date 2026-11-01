import { isTerminalFocused, isTypingTarget } from '@/lib/keyboard';
import { isMacPlatform, shortcutForEvent } from './match';
import type { ShortcutId } from './registry';

type Handler = () => void;

const handlers = new Map<ShortcutId, Set<Handler>>();

export function runShortcut(id: ShortcutId): boolean {
  const registered = handlers.get(id);
  if (!registered?.size) return false;
  for (const handler of registered) handler();
  return true;
}

function dispatch(e: KeyboardEvent, phase: 'capture' | 'bubble'): void {
  if (e.defaultPrevented) return;
  const id = shortcutForEvent(e, {
    mac: isMacPlatform(),
    typing: isTypingTarget(),
    inTerminal: isTerminalFocused(),
    phase,
  });
  if (!id || !handlers.get(id)?.size) return;
  e.preventDefault();
  e.stopPropagation();
  runShortcut(id);
}

const onCapture = (e: KeyboardEvent) => dispatch(e, 'capture');
const onBubble = (e: KeyboardEvent) => dispatch(e, 'bubble');

function listenerCount(): number {
  let count = 0;
  for (const set of handlers.values()) count += set.size;
  return count;
}

/** Listeners stay attached once, however many tabs register handlers. */
export function registerShortcut(id: ShortcutId, handler: Handler): () => void {
  if (listenerCount() === 0) {
    // Capture phase: a focused terminal handles keys first, so a bubbling
    // listener never sees them, and the key must not reach the PTY.
    document.addEventListener('keydown', onCapture, true);
    window.addEventListener('keydown', onBubble);
  }
  const registered = handlers.get(id) ?? new Set<Handler>();
  handlers.set(id, registered);
  registered.add(handler);

  return () => {
    registered.delete(handler);
    if (listenerCount() > 0) return;
    document.removeEventListener('keydown', onCapture, true);
    window.removeEventListener('keydown', onBubble);
  };
}
