import { describe, it, expect, afterEach } from 'vitest';
import {
  publishTerminalSessions,
  clearTerminalSessions,
  readOpenTerminals,
  terminalOrdinal,
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

  describe('open terminals', () => {
    const A = terminalRailKey('t', 'gk-a');
    const B = terminalRailKey('t', 'gk-b');

    afterEach(() => {
      clearTerminalSessions(A);
      clearTerminalSessions(B);
    });

    // Voice numbers terminals by this list, so a scope the user has open in a
    // second dock must not restart the numbering at 1.
    it('[FR-TG2.5] should flatten every published scope into one numbered list', () => {
      publishTerminalSessions(A, { tabs: [makeTab('a1'), makeTab('a2')], activeId: 'a1' });
      publishTerminalSessions(B, { tabs: [makeTab('b1')], activeId: null });

      const open = readOpenTerminals();
      expect(open.map((t) => t.sessionId)).toEqual(['a1', 'a2', 'b1']);
      expect(terminalOrdinal(open, 'b1')).toBe(3);
    });

    // Two managers can publish the same session; it must take one number.
    it('should count a session published under two keys once', () => {
      publishTerminalSessions(A, { tabs: [makeTab('same')], activeId: null });
      publishTerminalSessions(B, { tabs: [makeTab('same')], activeId: null });

      expect(readOpenTerminals().map((t) => t.sessionId)).toEqual(['same']);
    });

    // useSyncExternalStore compares by identity and loops forever on a fresh
    // array each read, so an unchanged list must return the same reference.
    it('should return a stable reference while the tabs are unchanged', () => {
      publishTerminalSessions(A, { tabs: [makeTab('a1')], activeId: null });
      expect(readOpenTerminals()).toBe(readOpenTerminals());
    });

    it('should return a new reference once the tabs change', () => {
      publishTerminalSessions(A, { tabs: [makeTab('a1')], activeId: null });
      const before = readOpenTerminals();
      publishTerminalSessions(A, { tabs: [makeTab('a1'), makeTab('a2')], activeId: null });
      expect(readOpenTerminals()).not.toBe(before);
    });

    it('should report no ordinal for a session that is not open', () => {
      expect(terminalOrdinal(readOpenTerminals(), 'nope')).toBeNull();
    });
  });
});
