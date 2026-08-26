'use client';

import { useCallback } from 'react';
import { useTerminalActive } from './use-terminal-active';
import { useTabId } from '@/components/tabs/tab-context';
import type { TerminalScope } from './types';

export function useSendToTerminal() {
  const terminalActive = useTerminalActive();
  const tabId = useTabId();

  const dispatchInject = useCallback(
    (context: string, terminalId?: string): boolean => {
      // useTabId() returns null outside a TabContext; only `undefined` means
      // "any tab may take this" — null would address a tab that doesn't exist.
      const detail: { context: string; terminalId?: string; tabId?: string; handled?: boolean } = {
        context,
        ...(terminalId ? { terminalId } : {}),
        ...(tabId ? { tabId } : {}),
      };
      window.dispatchEvent(new CustomEvent('terminal:inject', { detail }));
      // Listeners ran synchronously above, so this already reflects whether a
      // terminal took the text.
      return detail.handled === true;
    },
    [tabId],
  );

  const sendToTerminal = useCallback(
    (content: string, terminalId?: string) => {
      if (!content) return;
      dispatchInject(content, terminalId);
      // Send Enter as a separate event so the PTY processes the content first
      setTimeout(() => dispatchInject('\r', terminalId), 50);
    },
    [dispatchInject],
  );

  // Same wire event as sendToTerminal, minus the trailing \r — for callers
  // (voice dictation) that must never auto-submit into a live agent terminal.
  const insertToTerminal = useCallback(
    (content: string, terminalId?: string): boolean => {
      if (!content) return false;
      return dispatchInject(content, terminalId);
    },
    [dispatchInject],
  );

  const openNewTerminal = useCallback(
    (scope: TerminalScope) => {
      window.dispatchEvent(
        new CustomEvent('terminal:open', { detail: { scope, tabId } }),
      );
    },
    [tabId],
  );

  return { sendToTerminal, insertToTerminal, openNewTerminal, terminalActive };
}
