import { describe, it, expect } from 'vitest';
import { sessionToTab, type SessionListItem } from './session-to-tab';

function listItem(overrides: Partial<SessionListItem> = {}): SessionListItem {
  return {
    sessionId: 'sess-1',
    scopeType: 'project',
    scopeLabel: 'claude: web',
    workingDir: '/repo/web',
    groupKey: 'project:ws:alpha',
    workspaceSlug: 'ws',
    projectSlug: 'alpha',
    agentType: 'claude',
    status: 'suspended',
    browserCount: 0,
    ...overrides,
  };
}

describe('terminal session list', () => {
  describe('sessionToTab', () => {
    it('[FR-TERMINAL-520] should mark a dormant session as a restorable tab', () => {
      const tab = sessionToTab(listItem({ dormant: true }), 'fallback-key');

      expect(tab.status).toBe('dormant');
      expect(tab.scope.workingDir).toBe('/repo/web');
      expect(tab.scope.command).toBeUndefined();
    });

    it('[FR-TERMINAL-520] should connect a live session instead of offering a restore', () => {
      const tab = sessionToTab(listItem({ status: 'active', browserCount: 1 }), 'fallback-key');

      expect(tab.status).toBe('connecting');
    });

    it('should fall back to the dock groupKey and drop an unknown agent type', () => {
      const tab = sessionToTab(
        listItem({ groupKey: undefined, agentType: 'not-an-agent', activityState: 'waiting' }),
        'fallback-key',
      );

      expect(tab.scope.groupKey).toBe('fallback-key');
      expect(tab.scope.agentType).toBeUndefined();
      expect(tab.activityState).toBe('waiting');
    });
  });
});
