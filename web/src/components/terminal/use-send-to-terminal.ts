'use client';

import { useCallback } from 'react';
import { useTerminalActive } from './use-terminal-active';
import { useTabId } from '@/components/tabs/tab-context';
import type { TerminalScope } from './types';

export function useSendToTerminal() {
  const terminalActive = useTerminalActive();
  const tabId = useTabId();

  const sendToTerminal = useCallback(
    (content: string, terminalId?: string) => {
      if (!content) return;

      const inject = (context: string) =>
        window.dispatchEvent(
          new CustomEvent('terminal:inject', {
            detail: terminalId
              ? { context, terminalId, tabId }
              : { context, tabId },
          }),
        );

      inject(content);
      // Send Enter as a separate event so the PTY processes the content first
      setTimeout(() => inject('\r'), 50);
    },
    [tabId],
  );

  const openNewTerminal = useCallback(
    (scope: TerminalScope) => {
      window.dispatchEvent(
        new CustomEvent('terminal:open', { detail: { scope, tabId } }),
      );
    },
    [tabId],
  );

  return { sendToTerminal, openNewTerminal, terminalActive };
}
