import { describe, it, expect } from 'vitest';
import { groupTabsByProject } from './grouping';
import type { TerminalTab, TerminalScope } from '../types';

function tab(
  sessionId: string,
  scope: Partial<TerminalScope> & Pick<TerminalScope, 'workspaceSlug'>,
): TerminalTab {
  return {
    sessionId,
    scope: {
      scopeType: 'project',
      scopeLabel: sessionId,
      workingDir: `/repo/${sessionId}`,
      groupKey: 'gk',
      ...scope,
    },
    status: 'active',
  };
}

describe('command center', () => {
  describe('groupTabsByProject', () => {
    it('[FR-TERMINAL-160] groups terminals across projects then by worktree branch', () => {
      const tabs = [
        tab('a', { workspaceSlug: 'ws', projectSlug: 'alpha' }),
        tab('b', { workspaceSlug: 'ws', projectSlug: 'alpha', worktreeBranch: 'feature-x' }),
        tab('c', { workspaceSlug: 'ws', projectSlug: 'beta' }),
      ];

      const groups = groupTabsByProject(tabs);

      expect(groups.map((g) => g.label)).toEqual(['alpha', 'beta']);
      const alpha = groups[0];
      expect(alpha.count).toBe(2);
      expect(alpha.worktreeGroups.map((w) => w.label)).toEqual(['default branch', 'feature-x']);
      expect(alpha.workspaceSlug).toBe('ws');
    });

    it('[FR-TERMINAL-160] keeps first-seen project order but sorts the no-project bucket last', () => {
      const tabs = [
        tab('w', { scopeType: 'workspace', workspaceSlug: 'ws', scopeLabel: 'ws shell' }),
        tab('a', { workspaceSlug: 'ws', projectSlug: 'alpha' }),
      ];

      const groups = groupTabsByProject(tabs);

      expect(groups.map((g) => g.label)).toEqual(['alpha', 'Other terminals']);
      expect(groups.map((g) => g.isProject)).toEqual([true, false]);
    });

    it('[FR-TERMINAL-160] returns no groups for an empty session list', () => {
      expect(groupTabsByProject([])).toEqual([]);
    });
  });
});
