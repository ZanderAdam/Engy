import { describe, it, expect } from 'vitest';
import { railItems, railOrder, railSections } from './rail-order';
import type { TerminalRailGroup, TerminalTab } from './types';

const OPS: TerminalRailGroup = { id: 'ops', name: 'Ops' };

function tab(sessionId: string, railGroup?: TerminalRailGroup): TerminalTab {
  return {
    sessionId,
    status: 'active',
    railGroup,
    scope: {
      scopeType: 'project',
      scopeLabel: sessionId,
      workingDir: '/tmp',
      groupKey: 'project:ws:alpha',
      workspaceSlug: 'ws',
    },
  };
}

describe('terminal rail order', () => {
  describe('railItems', () => {
    it('[FR-TERMINAL-950] should gather group members at the first member, in dock order', () => {
      const items = railItems([tab('a'), tab('o1', OPS), tab('b'), tab('o2', OPS)]);

      expect(
        items.map((item) =>
          item.kind === 'group'
            ? `${item.group.name}:${item.tabs.map((t) => t.sessionId).join(',')}`
            : item.tab.sessionId,
        ),
      ).toEqual(['a', 'Ops:o1,o2', 'b']);
    });
  });

  describe('railOrder', () => {
    const sections = railSections(
      [tab('a'), tab('o1', OPS), tab('b'), tab('o2', OPS)],
      false,
      true,
    );

    it('[FR-TERMINAL-900] should number group members together, as the rail lists them', () => {
      expect(railOrder(sections, new Set()).map((t) => t.sessionId)).toEqual([
        'a',
        'o1',
        'o2',
        'b',
      ]);
    });

    it('[FR-TERMINAL-900] should leave out the members of a collapsed group', () => {
      expect(railOrder(sections, new Set([OPS.id])).map((t) => t.sessionId)).toEqual(['a', 'b']);
    });
  });
});
