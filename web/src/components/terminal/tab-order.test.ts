import { describe, it, expect } from 'vitest';
import { orderTabsByPanelIds } from './tab-order';
import type { TerminalTab } from './types';

function tab(sessionId: string): TerminalTab {
  return {
    sessionId,
    status: 'active',
    scope: {
      scopeType: 'project',
      scopeLabel: `t-${sessionId}`,
      workingDir: '/tmp',
      groupKey: 'project:ws:proj',
      workspaceSlug: 'ws',
    },
  };
}

function tabMap(...ids: string[]): Map<string, TerminalTab> {
  return new Map(ids.map((id) => [id, tab(id)]));
}

describe('terminal rail ordering', () => {
  describe('orderTabsByPanelIds', () => {
    it('[FR-TERMINAL-920] should follow the dock panel order, not map insertion order', () => {
      const ordered = orderTabsByPanelIds(['c', 'a', 'b'], tabMap('a', 'b', 'c'));
      expect(ordered.map((t) => t.sessionId)).toEqual(['c', 'a', 'b']);
    });

    it('should append tabs that have no panel yet', () => {
      const ordered = orderTabsByPanelIds(['b'], tabMap('a', 'b', 'c'));
      expect(ordered.map((t) => t.sessionId)).toEqual(['b', 'a', 'c']);
    });

    it('should ignore panel ids with no tab', () => {
      const ordered = orderTabsByPanelIds(['gone', 'a'], tabMap('a'));
      expect(ordered.map((t) => t.sessionId)).toEqual(['a']);
    });

    it('should return an empty list for no tabs', () => {
      expect(orderTabsByPanelIds(['a'], new Map())).toEqual([]);
    });
  });
});
