'use client';

import { useCallback } from 'react';
import { useTerminalActive } from './use-terminal-active';
import type { TerminalScope } from './types';

export function useSendToTerminal() {
  const terminalActive = useTerminalActive();

  const sendToTerminal = useCallback((content: string, terminalId?: string) => {
    if (!content) return;

    const inject = (context: string) =>
      window.dispatchEvent(
        new CustomEvent('terminal:inject', {
          detail: terminalId ? { context, terminalId } : { context },
        }),
      );

    inject(content);
    // Send Enter as a separate event so the PTY processes the content first
    setTimeout(() => inject('\r'), 50);
  }, []);

  const openNewTerminal = useCallback((scope: TerminalScope) => {
    window.dispatchEvent(
      new CustomEvent('terminal:open', { detail: { scope } }),
    );
  }, []);

  return { sendToTerminal, openNewTerminal, terminalActive };
}
