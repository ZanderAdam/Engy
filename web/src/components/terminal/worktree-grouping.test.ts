import { describe, it, expect } from 'vitest';
import { groupTabsByWorktree, DEFAULT_WORKTREE_LABEL } from './worktree-grouping';
import type { TerminalTab } from './types';

function tab(sessionId: string, worktreeBranch?: string): TerminalTab {
  return {
    sessionId,
    status: 'active',
    scope: {
      scopeType: 'project',
      scopeLabel: `t-${sessionId}`,
      workingDir: '/tmp',
      groupKey: 'project:ws:proj',
      workspaceSlug: 'ws',
      worktreeBranch,
    },
  };
}

describe('groupTabsByWorktree', () => {
  it('should put the default branch (undefined) first', () => {
    const groups = groupTabsByWorktree([tab('a', 'feat-x'), tab('b'), tab('c', 'feat-y')]);
    expect(groups.map((g) => g.branch)).toEqual([undefined, 'feat-x', 'feat-y']);
    expect(groups[0].label).toBe(DEFAULT_WORKTREE_LABEL);
  });

  it('should keep first-seen order for named branches', () => {
    const groups = groupTabsByWorktree([tab('a', 'feat-y'), tab('b', 'feat-x'), tab('c', 'feat-y')]);
    expect(groups.map((g) => g.branch)).toEqual(['feat-y', 'feat-x']);
    expect(groups[0].tabs.map((t) => t.sessionId)).toEqual(['a', 'c']);
  });

  it('should return a single default group when no worktree branches are present', () => {
    const groups = groupTabsByWorktree([tab('a'), tab('b')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].branch).toBeUndefined();
    expect(groups[0].tabs).toHaveLength(2);
  });

  it('should return an empty array for no tabs', () => {
    expect(groupTabsByWorktree([])).toEqual([]);
  });
});
