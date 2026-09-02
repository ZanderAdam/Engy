'use client';

import { terminalOrdinal, useOpenTerminals } from '@/components/terminal/terminal-session-store';
import { useOptionalVoice } from './voice-context';

/**
 * The number to say for one terminal ("focus terminal 2"), or null when voice
 * is off or the terminal is not open.
 *
 * One source for every surface that names a terminal, so a number cannot
 * appear on the collapsed rail and be missing from the expanded list — the
 * numbers have to agree with each other and with the action registry, and
 * they only do that by all reading the same open-terminal order.
 */
export function useVoiceTerminalNumber(sessionId: string): number | null {
  const openTerminals = useOpenTerminals();
  const voiceOn = useOptionalVoice() !== null;
  return voiceOn ? terminalOrdinal(openTerminals, sessionId) : null;
}
