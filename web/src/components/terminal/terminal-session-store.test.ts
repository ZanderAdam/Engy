import { describe, it, expect } from 'vitest';
import {
  publishTerminalSessions,
  clearTerminalSessions,
  terminalRailKey,
} from './terminal-session-store';
import type { TerminalTab } from './types';

function makeTab(sessionId: string): TerminalTab {
  return {
    sessionId,
    scope: {
      scopeType: 'project',
      scopeLabel: `project: ${sessionId}`,
      workingDir: '/tmp',
      groupKey: `gk-${sessionId}`,
      workspaceSlug: 'ws',
    },
    status: 'active',
  };
}

describe('terminal-session-store', () => {
  describe('terminalRailKey', () => {
    it('should compose tabId and groupKey', () => {
      expect(terminalRailKey('tab-1', 'gk')).toBe('tab-1:gk');
    });

    it('should fall back to "default" for a null tabId', () => {
      expect(terminalRailKey(null, 'gk')).toBe('default:gk');
    });

    it('should distinguish two tabs on the same scope', () => {
      expect(terminalRailKey('a', 'gk')).not.toBe(terminalRailKey('b', 'gk'));
    });
  });

  describe('publish / clear', () => {
    it('should publish and clear a key without throwing', () => {
      const key = terminalRailKey('t', 'gk');
      expect(() => {
        publishTerminalSessions(key, { tabs: [makeTab('a')], activeId: 'a' });
        clearTerminalSessions(key);
        // Clearing a missing key is a no-op (early-out), must not throw.
        clearTerminalSessions(key);
      }).not.toThrow();
    });
  });
});
