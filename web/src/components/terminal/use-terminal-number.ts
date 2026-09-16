'use client';

import { useOptionalVoice } from '@/components/voice/voice-context';
import { terminalOrdinal, useOpenTerminals } from './terminal-session-store';
import { useNumberHint } from './terminal-number-shortcut';

/**
 * The number that names one terminal — said out loud ("focus terminal 2") or
 * typed as Ctrl+Alt+2 — or null while nothing is asking for numbers.
 *
 * One source for every surface that names a terminal, so a number cannot
 * appear on the collapsed rail and be missing from the expanded list — the
 * numbers have to agree with each other and with the action registry, and
 * they only do that by all reading the same open-terminal order.
 */
export function useTerminalNumber(sessionId: string): number | null {
  const openTerminals = useOpenTerminals();
  const voiceOn = useOptionalVoice() !== null;
  const hintHeld = useNumberHint();
  if (!voiceOn && !hintHeld) return null;
  return terminalOrdinal(openTerminals, sessionId);
}
