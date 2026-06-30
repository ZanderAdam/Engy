import { describe, it, expect } from 'vitest';
import { commandCenterSessionToTab, type CommandCenterSession } from './types';

function session(overrides: Partial<CommandCenterSession> = {}): CommandCenterSession {
  return {
    sessionId: 's1',
    scopeType: 'project',
    scopeLabel: 'claude: web',
    workingDir: '/repo/web',
    groupKey: 'project:ws:alpha',
    workspaceSlug: 'ws',
    projectSlug: 'alpha',
    worktreeBranch: undefined,
    activityState: 'idle',
    status: 'suspended',
    ...overrides,
  };
}

describe('command center', () => {
  describe('commandCenterSessionToTab', () => {
    it('[FR-TERMINAL-160] carries the daemon-tracked activity state onto the tab', () => {
      const tab = commandCenterSessionToTab(session({ activityState: 'waiting', status: 'suspended' }));

      // Activity follows the daemon, not the render: a suspended (unviewed)
      // terminal still surfaces its live activity dot. Status maps to 'active'
      // (alive on the server) so the dot colour comes from activityState.
      expect(tab.activityState).toBe('waiting');
      expect(tab.status).toBe('active');
    });

    it('[FR-TERMINAL-160] preserves project and worktree identity for grouping', () => {
      const tab = commandCenterSessionToTab(
        session({ projectSlug: 'alpha', worktreeBranch: 'feature-x' }),
      );

      expect(tab.scope.projectSlug).toBe('alpha');
      expect(tab.scope.worktreeBranch).toBe('feature-x');
      expect(tab.scope.workspaceSlug).toBe('ws');
    });
  });
});
