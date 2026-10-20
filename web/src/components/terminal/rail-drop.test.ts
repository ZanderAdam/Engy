import { describe, it, expect } from 'vitest';
import { planGroupHeaderDrop, planTerminalDrop, railDropZone } from './rail-drop';
import { projectGroupKey } from './group-key';
import type { TerminalRailGroupItem } from './rail-order';
import type { TerminalRailGroup, TerminalTab } from './types';

const NEW_GROUP: TerminalRailGroup = { id: 'new', name: 'Group' };
const REVIEWS: TerminalRailGroup = { id: 'g1', name: 'Reviews' };
const options = { byWorktree: true, newGroup: () => NEW_GROUP };

function tab(
  sessionId: string,
  extra: { railGroup?: TerminalRailGroup; worktreeBranch?: string; projectSlug?: string } = {},
): TerminalTab {
  const projectSlug = extra.projectSlug ?? 'alpha';
  return {
    sessionId,
    status: 'active',
    railGroup: extra.railGroup,
    scope: {
      scopeType: 'project',
      scopeLabel: sessionId,
      workingDir: '/tmp',
      groupKey: projectGroupKey('ws', projectSlug, extra.worktreeBranch),
      workspaceSlug: 'ws',
      projectSlug,
      worktreeBranch: extra.worktreeBranch,
    },
  };
}

describe('terminal rail drop', () => {
  describe('railDropZone', () => {
    it('[FR-TERMINAL-1000] should split a row into before, into and after zones', () => {
      expect(railDropZone(2, 40)).toBe('before');
      expect(railDropZone(20, 40)).toBe('into');
      expect(railDropZone(38, 40)).toBe('after');
    });
  });

  describe('planTerminalDrop', () => {
    it('[FR-TERMINAL-1000] should reorder on an edge drop without grouping', () => {
      expect(planTerminalDrop(tab('a'), tab('b'), 'before', options)).toEqual({
        reorder: { targetSessionId: 'b', position: 'before' },
        regroup: undefined,
      });
    });

    it('[FR-TERMINAL-1000] should create a group from a middle drop on an ungrouped terminal', () => {
      expect(planTerminalDrop(tab('a'), tab('b'), 'into', options)).toEqual({
        reorder: { targetSessionId: 'b', position: 'after' },
        regroup: { sessionIds: ['b', 'a'], group: NEW_GROUP },
      });
    });

    it('[FR-TERMINAL-1000] should join the group of a grouped target', () => {
      const plan = planTerminalDrop(tab('a'), tab('b', { railGroup: REVIEWS }), 'into', options);
      expect(plan.regroup).toEqual({ sessionIds: ['a'], group: REVIEWS });
    });

    it('[FR-TERMINAL-1000] should leave a group when dropped beside an ungrouped terminal', () => {
      const plan = planTerminalDrop(tab('a', { railGroup: REVIEWS }), tab('b'), 'after', options);
      expect(plan.regroup).toEqual({ sessionIds: ['a'], group: null });
    });

    it('[FR-TERMINAL-1000] should not regroup a terminal already in the target group', () => {
      const plan = planTerminalDrop(
        tab('a', { railGroup: REVIEWS }),
        tab('b', { railGroup: REVIEWS }),
        'before',
        options,
      );
      expect(plan.regroup).toBeUndefined();
    });

    it('[FR-TERMINAL-1010] should only reorder across worktrees', () => {
      const plan = planTerminalDrop(
        tab('a'),
        tab('b', { worktreeBranch: 'feat' }),
        'into',
        options,
      );
      expect(plan).toEqual({
        reorder: { targetSessionId: 'b', position: 'after' },
        regroup: undefined,
      });
    });

    it('[FR-TERMINAL-1010] should group across worktrees while worktree grouping is off', () => {
      const plan = planTerminalDrop(tab('a'), tab('b', { worktreeBranch: 'feat' }), 'into', {
        ...options,
        byWorktree: false,
      });
      expect(plan.regroup?.group).toEqual(NEW_GROUP);
    });

    it('[FR-TERMINAL-1010] should group an agent that moved into a worktree with its terminals', () => {
      const base = tab('a');
      const moved = { ...base, scope: { ...base.scope, worktreeBranch: 'feat' } };

      const plan = planTerminalDrop(moved, tab('b', { worktreeBranch: 'feat' }), 'into', options);

      expect(plan.regroup?.group).toEqual(NEW_GROUP);
    });

    it('[FR-TERMINAL-1010] should only reorder across projects', () => {
      const plan = planTerminalDrop(tab('a'), tab('b', { projectSlug: 'beta' }), 'into', options);
      expect(plan.regroup).toBeUndefined();
    });
  });

  describe('planGroupHeaderDrop', () => {
    const group: TerminalRailGroupItem = {
      kind: 'group',
      group: REVIEWS,
      tabs: [tab('m1', { railGroup: REVIEWS }), tab('m2', { railGroup: REVIEWS })],
    };

    it('[FR-TERMINAL-1000] should add a terminal as the last member', () => {
      expect(planGroupHeaderDrop(tab('a'), group, 'into', options)).toEqual({
        reorder: { targetSessionId: 'm2', position: 'after' },
        regroup: { sessionIds: ['a'], group: REVIEWS },
      });
    });

    it('[FR-TERMINAL-1000] should place a member above the group and outside it on the top edge', () => {
      expect(planGroupHeaderDrop(group.tabs[1], group, 'before', options)).toEqual({
        reorder: { targetSessionId: 'm1', position: 'before' },
        regroup: { sessionIds: ['m2'], group: null },
      });
    });

    it('should do nothing for a terminal from another worktree', () => {
      expect(
        planGroupHeaderDrop(tab('a', { worktreeBranch: 'feat' }), group, 'into', options),
      ).toEqual({});
    });
  });
});
