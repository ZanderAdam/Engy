import { describe, it, expect } from 'vitest';
import { cloneScopeForNewTerminal } from './new-terminal-scope';
import { groupTabsByWorktree } from '../worktree-grouping';
import type { TerminalTab, TerminalScope } from '../types';

function tab(sessionId: string, scope: Partial<TerminalScope>): TerminalTab {
  return {
    sessionId,
    scope: {
      scopeType: 'project',
      scopeLabel: `claude: ${sessionId}`,
      workingDir: `/repo/${sessionId}`,
      groupKey: 'project:ws:alpha',
      workspaceSlug: 'ws',
      projectSlug: 'alpha',
      ...scope,
    },
    status: 'active',
  };
}

describe('command center', () => {
  describe('cloneScopeForNewTerminal', () => {
    it('[FR-TERMINAL-190] clones the first terminal scope so the session lands in that project', () => {
      const groups = groupTabsByWorktree([
        tab('a', { worktreeBranch: 'feature-x', scopeLabel: 'claude: web (fx)' }),
        tab('b', { scopeLabel: 'claude: web' }),
      ]);

      const scope = cloneScopeForNewTerminal(groups);

      // Default branch sorts first in worktree grouping, so 'b' is the source.
      expect(scope).toMatchObject({
        scopeLabel: 'claude: web',
        workingDir: '/repo/b',
        groupKey: 'project:ws:alpha',
        projectSlug: 'alpha',
        workspaceSlug: 'ws',
      });
    });

    it('[FR-TERMINAL-190] strips a trailing ordinal so the manager can re-suffix cleanly', () => {
      const groups = groupTabsByWorktree([tab('a', { scopeLabel: 'project: default (2)' })]);

      expect(cloneScopeForNewTerminal(groups)?.scopeLabel).toBe('project: default');
    });

    it('[FR-TERMINAL-190] drops the task binding — a cloned terminal is not a task terminal', () => {
      const groups = groupTabsByWorktree([tab('a', { taskId: 42 })]);

      expect(cloneScopeForNewTerminal(groups)?.taskId).toBeUndefined();
    });

    it('[FR-TERMINAL-190] returns null when the group has no terminals', () => {
      expect(cloneScopeForNewTerminal([])).toBeNull();
    });

    it('[FR-TERMINAL-190] returns null for a non-project group — creation is scoped to project groups', () => {
      const groups = groupTabsByWorktree([
        tab('w', { scopeType: 'workspace', projectSlug: undefined, workspaceSlug: 'ws' }),
      ]);

      expect(cloneScopeForNewTerminal(groups)).toBeNull();
    });
  });
});
