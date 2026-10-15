'use client';

import { useSyncExternalStore } from 'react';
import { createPersistentValue } from './persistent-value';

const collapsedGroups = createPersistentValue<readonly string[]>(
  'engy:terminal-rail-collapsed-groups:v1',
  [],
  {
    parse(raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : undefined;
      } catch {
        return undefined;
      }
    },
    serialize: (ids) => JSON.stringify(ids),
  },
);

export function setRailGroupCollapsed(groupId: string, collapsed: boolean): void {
  const current = collapsedGroups.get();
  if (current.includes(groupId) === collapsed) return;
  collapsedGroups.set(collapsed ? [...current, groupId] : current.filter((id) => id !== groupId));
}

export function useCollapsedRailGroups(): readonly string[] {
  return useSyncExternalStore(
    collapsedGroups.subscribe,
    collapsedGroups.get,
    collapsedGroups.getServerSnapshot,
  );
}
