import { useCallback, useEffect, useRef } from 'react';
import { isTypingTarget } from '@/lib/keyboard';
import { useTabsList } from './tab-context';
import { parseVirtualPath } from './tab-state';

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

const CHORD_KEYS = new Set(['i', 't', 'd', 'c', 'm']);

export function advanceChord(
  state: ChordState,
  e: ChordKey,
  now: number,
): { state: ChordState; fire: string | null } {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.key.length !== 1) {
    return { state, fire: null };
  }
  const armed = state.armedAt !== null && now - state.armedAt <= CHORD_TIMEOUT_MS;
  if (armed && CHORD_KEYS.has(e.key)) return { state: IDLE_CHORD, fire: e.key };
  if (e.key === 'g') return { state: { armedAt: now }, fire: null };
  return { state: IDLE_CHORD, fire: null };
}

const SECTIONS: Record<string, string> = { t: 'tasks', d: 'docs', m: 'memory' };

/** The section of the workspace or project the tab shows. Code exists only on
 * projects, and null means the chord has no target here. */
export function chordPath(key: string, virtualPath: string): string | null {
  const { workspace, project } = parseVirtualPath(virtualPath);
  if (!workspace) return null;
  const projectBase = project ? `/w/${workspace}/projects/${project}` : null;
  if (key === 'c') return projectBase && `${projectBase}/code`;
  const section = SECTIONS[key];
  return section ? `${projectBase ?? `/w/${workspace}`}/${section}` : null;
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

export function useGoToChords(navigate: (path: string) => void): void {
  const openInbox = useOpenInbox();
  const tabsList = useTabsList();
  const latest = useRef({ openInbox, navigate, tabsList });
  useEffect(() => {
    latest.current = { openInbox, navigate, tabsList };
  });

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
      if (next.fire === 'i') {
        latest.current.openInbox();
        return;
      }
      const list = latest.current.tabsList;
      const active = list?.tabs.find((t) => t.id === list.activeTabId);
      const path = active ? chordPath(next.fire, active.virtualPath) : null;
      if (path) latest.current.navigate(path);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
