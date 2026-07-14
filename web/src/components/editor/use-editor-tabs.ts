'use client';

import { useCallback, useState } from 'react';
import {
  canGoBack,
  canGoForward,
  closeTab,
  emptyTabsState,
  navigateBack,
  navigateForward,
  openTab,
  type TabsState,
} from './open-tabs';

/**
 * Stateful controller for an editor surface's open-file tabs and back/forward
 * navigation. Shared by the Code and Diffs pages so both drive the exact same
 * tab semantics (open/close/history) from one place. Read `state` for the raw
 * value (persisting, seeding); mutate only through the named actions so the
 * tabs/active/history invariants always hold.
 */
export interface EditorTabsController {
  state: TabsState;
  active: string | null;
  canBack: boolean;
  canForward: boolean;
  open: (path: string) => void;
  close: (path: string) => void;
  back: () => void;
  forward: () => void;
  reset: () => void;
}

export function useEditorTabs(initial: TabsState = emptyTabsState): EditorTabsController {
  const [state, setState] = useState<TabsState>(initial);

  const open = useCallback((path: string) => {
    if (path) setState((s) => openTab(s, path));
  }, []);
  const close = useCallback((path: string) => setState((s) => closeTab(s, path)), []);
  const back = useCallback(() => setState(navigateBack), []);
  const forward = useCallback(() => setState(navigateForward), []);
  const reset = useCallback(() => setState(emptyTabsState), []);

  return {
    state,
    active: state.active,
    canBack: canGoBack(state),
    canForward: canGoForward(state),
    open,
    close,
    back,
    forward,
    reset,
  };
}
