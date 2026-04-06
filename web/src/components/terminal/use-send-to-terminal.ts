'use client';

import { useCallback } from 'react';
import { useTerminalActive } from './use-terminal-active';
import type { TerminalScope } from './types';

export function useSendToTerminal() {
  const terminalActive = useTerminalActive();

  const sendToTerminal = useCallback((content: string, terminalId?: string) => {
    if (!content) return;

    const detail: { context: string; terminalId?: string } = { context: content };
    if (terminalId) detail.terminalId = terminalId;

    window.dispatchEvent(new CustomEvent('terminal:inject', { detail }));
    // Send Enter as a separate event so the PTY processes the content first
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('terminal:inject', {
          detail: { context: '\r', ...(terminalId ? { terminalId } : {}) },
        }),
      );
    }, 50);
  }, []);

  const openNewTerminal = useCallback((scope: TerminalScope) => {
    window.dispatchEvent(
      new CustomEvent('terminal:open', { detail: { scope } }),
    );
  }, []);

  return { sendToTerminal, openNewTerminal, terminalActive };
}
