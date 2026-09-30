'use client';

import { useSyncExternalStore } from 'react';
import { createPersistentToggle } from '../persistent-toggle';

// Global, cross-tab toggle: when on, every terminal sidebar (right panel) across
// all in-app project tabs shows the Command Center — the live view of every
// terminal in every project — instead of the current project's terminals.

// Shared groupKey the global dock publishes its session snapshot under and the
// rail reads from while Command Center mode is on (in place of the per-project
// groupKey), so the two stay in sync across the toggle.
export const COMMAND_CENTER_GROUP_KEY = '__command_center__';

const mode = createPersistentToggle('engy:command-center-mode:v1', false);

export const setCommandCenterMode = mode.set;

export function useCommandCenterMode(): boolean {
  return useSyncExternalStore(mode.subscribe, mode.get, mode.getServerSnapshot);
}
