import { useCallback, useEffect } from 'react';
import { isTypingTarget } from '@/lib/keyboard';
import { useTabsList } from '@/components/tabs/tab-context';

const INBOX_PATH = '/inbox';
export const CHORD_TIMEOUT_MS = 1000;

interface ChordState {
  armedAt: number | null;
}

export interface ChordKey {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

const OVERLAY_SELECTOR = '[role="dialog"], [role="menu"]';

export function isInsideOverlay(
  target: { closest?: (selector: string) => unknown } | null,
): boolean {
  return !!target?.closest?.(OVERLAY_SELECTOR);
}

export const IDLE_CHORD: ChordState = { armedAt: null };

export function advanceChord(
  state: ChordState,
  e: ChordKey,
  now: number,
): { state: ChordState; fire: boolean } {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.key.length !== 1) {
    return { state, fire: false };
  }
  const armed = state.armedAt !== null && now - state.armedAt <= CHORD_TIMEOUT_MS;
  if (armed && e.key === 'i') return { state: IDLE_CHORD, fire: true };
  if (e.key === 'g') return { state: { armedAt: now }, fire: false };
  return { state: IDLE_CHORD, fire: false };
}

export function useOpenInbox(): () => void {
  const tabsList = useTabsList();
  return useCallback(() => {
    if (!tabsList) return;
    const existing = tabsList.tabs.find((t) => t.virtualPath === INBOX_PATH);
    if (existing) tabsList.activateTab(existing.id);
    else tabsList.openNewTab(INBOX_PATH);
  }, [tabsList]);
}

export function useGoToInbox(): void {
  const openInbox = useOpenInbox();

  useEffect(() => {
    let state = IDLE_CHORD;

    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget() || isInsideOverlay(e.target as Element | null)) {
        state = IDLE_CHORD;
        return;
      }
      const next = advanceChord(state, e, Date.now());
      state = next.state;
      if (!next.fire) return;
      e.preventDefault();
      openInbox();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openInbox]);
}
