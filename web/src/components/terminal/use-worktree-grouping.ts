'use client';

import { useSyncExternalStore } from 'react';
import { createPersistentToggle } from './persistent-toggle';

// Global, cross-tab toggle for the terminal rail's worktree grouping. On (the
// default) the rail splits each list into per-branch groups; off it renders one
// flat list in dock order. Command Center's project grouping is unaffected.
const grouping = createPersistentToggle('engy:terminal-worktree-grouping:v1', true);

export const setWorktreeGrouping = grouping.set;

export function useWorktreeGrouping(): boolean {
  return useSyncExternalStore(grouping.subscribe, grouping.get, grouping.getServerSnapshot);
}
