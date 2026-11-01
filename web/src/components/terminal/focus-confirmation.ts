import { FOCUS_REQUEST_TIMEOUT_MS } from './pending-focus';
import type { TerminalDock } from './terminal-link';

interface FocusConfirmationOptions {
  sessionId: string;
  tabId: string | null;
  onMissing: () => void;
}

function watchFocusConfirmation({
  sessionId,
  tabId,
  onMissing,
}: FocusConfirmationOptions): void {
  function onFocused(e: Event): void {
    const detail = (e as CustomEvent<{ sessionId: string; tabId?: string }>).detail;
    if (detail.sessionId !== sessionId) return;
    if (detail.tabId !== undefined && tabId !== null && detail.tabId !== tabId) return;
    clearTimeout(timer);
    window.removeEventListener('terminal:focused', onFocused);
  }

  const timer = setTimeout(() => {
    window.removeEventListener('terminal:focused', onFocused);
    onMissing();
  }, FOCUS_REQUEST_TIMEOUT_MS);
  window.addEventListener('terminal:focused', onFocused);
}

/**
 * Dispatches `terminal:focus`. The watcher goes first because a mounted dock
 * confirms synchronously, inside the dispatch.
 */
export function requestTerminalFocus({
  sessionId,
  tabId,
  dock,
  onMissing,
}: FocusConfirmationOptions & { dock: TerminalDock }): void {
  watchFocusConfirmation({ sessionId, tabId, onMissing });
  window.dispatchEvent(
    new CustomEvent('terminal:focus', {
      detail: { sessionId, dock, ...(tabId ? { tabId } : {}) },
    }),
  );
}
