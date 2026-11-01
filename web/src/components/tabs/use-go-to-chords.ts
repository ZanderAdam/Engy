import { useCallback, useEffect } from 'react';
import { isTypingTarget } from '@/lib/keyboard';
import {
  CHORD_LEADER,
  runShortcut,
  SHORTCUTS,
  useShortcut,
  type ShortcutId,
} from '@/lib/shortcuts';
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

const CHORD_TARGETS = new Map(
  SHORTCUTS.flatMap((s): [string, ShortcutId][] => (s.sequence ? [[s.sequence[1], s.id]] : [])),
);

export function advanceChord(
  state: ChordState,
  e: ChordKey,
  now: number,
): { state: ChordState; fire: ShortcutId | null } {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.key.length !== 1) {
    return { state, fire: null };
  }
  const armed = state.armedAt !== null && now - state.armedAt <= CHORD_TIMEOUT_MS;
  const target = armed ? CHORD_TARGETS.get(e.key) : undefined;
  if (target) return { state: IDLE_CHORD, fire: target };
  if (e.key === CHORD_LEADER) return { state: { armedAt: now }, fire: null };
  return { state: IDLE_CHORD, fire: null };
}

type SectionShortcut = 'goTasks' | 'goDocs' | 'goMemory' | 'goCode';

const SECTIONS: Record<Exclude<SectionShortcut, 'goCode'>, string> = {
  goTasks: 'tasks',
  goDocs: 'docs',
  goMemory: 'memory',
};

/** The section of the workspace or project the tab shows. Code exists only on
 * projects, and null means the chord has no target here. */
export function chordPath(id: SectionShortcut, virtualPath: string): string | null {
  const { workspace, project } = parseVirtualPath(virtualPath);
  if (!workspace) return null;
  const projectBase = project ? `/w/${workspace}/projects/${project}` : null;
  if (id === 'goCode') return projectBase && `${projectBase}/code`;
  return `${projectBase ?? `/w/${workspace}`}/${SECTIONS[id]}`;
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

  const goTo = (id: SectionShortcut) => {
    const active = tabsList?.tabs.find((t) => t.id === tabsList.activeTabId);
    const path = active ? chordPath(id, active.virtualPath) : null;
    if (path) navigate(path);
  };

  useShortcut('goInbox', openInbox);
  useShortcut('goTasks', () => goTo('goTasks'));
  useShortcut('goDocs', () => goTo('goDocs'));
  useShortcut('goCode', () => goTo('goCode'));
  useShortcut('goMemory', () => goTo('goMemory'));

  useEffect(() => {
    let state = IDLE_CHORD;

    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget() || isInsideOverlay(e.target as Element | null)) {
        state = IDLE_CHORD;
        return;
      }
      const next = advanceChord(state, e, Date.now());
      state = next.state;
      if (next.fire && runShortcut(next.fire)) e.preventDefault();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
