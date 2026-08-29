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

    it('[FR-TERMINAL-680] should surface renamedLabel alongside the immutable scopeLabel', () => {
      const tab = sessionToTab(listItem({ renamedLabel: 'my rename' }), 'fallback-key');

      expect(tab.scope.renamedLabel).toBe('my rename');
      expect(tab.scope.scopeLabel).toBe('claude: web');
    });

    it('[FR-TERMINAL-680] should leave renamedLabel unset when the session was never renamed', () => {
      const tab = sessionToTab(listItem(), 'fallback-key');

      expect(tab.scope.renamedLabel).toBeUndefined();
    });

    it('[FR-TERMINAL-710] should seed oscTitle from the hook-derived lastTitle', () => {
      const tab = sessionToTab(listItem({ lastTitle: 'Fixed the flaky test' }), 'fallback-key');

      expect(tab.oscTitle).toBe('Fixed the flaky test');
    });

    it('[FR-TERMINAL-710] should leave oscTitle unset when no title was ever recorded', () => {
      const tab = sessionToTab(listItem(), 'fallback-key');

      expect(tab.oscTitle).toBeUndefined();
    });

    it('[FR-TERMINAL-740] should carry needsAttention through to the tab', () => {
      const tab = sessionToTab(listItem({ needsAttention: true }), 'fallback-key');

      expect(tab.needsAttention).toBe(true);
    });

    it('[FR-TERMINAL-740] should leave needsAttention unset when the list item omits it', () => {
      const tab = sessionToTab(listItem(), 'fallback-key');

      expect(tab.needsAttention).toBeUndefined();
    });

    it('[FR-TERMINAL-800] should seed hookDriven from the list item at initial load', () => {
      const tab = sessionToTab(listItem({ hookDriven: true }), 'fallback-key');

      expect(tab.hookDriven).toBe(true);
    });

    it('[FR-TERMINAL-800] should leave hookDriven falsy when the list item says the session is not hook-driven', () => {
      const tab = sessionToTab(listItem({ hookDriven: false }), 'fallback-key');

      expect(tab.hookDriven).toBe(false);
    });
  });
});
