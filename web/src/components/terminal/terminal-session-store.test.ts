import { describe, it, expect, afterEach } from 'vitest';
import {
  publishTerminalSessions,
  clearTerminalSessions,
  readNumberedTerminals,
  terminalOrdinal,
  terminalRailKey,
} from './terminal-session-store';
import type { TerminalTab } from './types';
import { toggleRailGroupCollapsed } from './use-collapsed-rail-groups';

function makeTab(
  sessionId: string,
  scope: { worktreeBranch?: string; projectSlug?: string } = {},
): TerminalTab {
  return {
    sessionId,
    scope: {
      scopeType: 'project',
      scopeLabel: `project: ${sessionId}`,
      workingDir: '/tmp',
      groupKey: `gk-${sessionId}`,
      workspaceSlug: 'ws',
      ...scope,
    },
    status: 'active',
  };
}

function snapshot(
  tabs: TerminalTab[],
  options: { visible?: boolean; commandCenter?: boolean } = {},
) {
  return {
    tabs,
    activeId: null,
    visible: options.visible ?? true,
    commandCenter: options.commandCenter ?? false,
  };
}

function numbered(): string[] {
  return readNumberedTerminals().map((t) => t.sessionId);
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
        publishTerminalSessions(key, snapshot([makeTab('a')]));
        clearTerminalSessions(key);
        // Clearing a missing key is a no-op (early-out), must not throw.
        clearTerminalSessions(key);
      }).not.toThrow();
    });
  });

  describe('numbered terminals', () => {
    const VISIBLE = terminalRailKey('shown', 'gk-a');
    const HIDDEN = terminalRailKey('hidden', 'gk-b');

    afterEach(() => {
      clearTerminalSessions(VISIBLE);
      clearTerminalSessions(HIDDEN);
    });

    // Inactive app tabs stay mounted and keep publishing; their terminals
    // must not offset or gap the numbers on screen.
    it('[FR-TERMINAL-900] should number only the terminals of the visible rail from 1', () => {
      publishTerminalSessions(HIDDEN, snapshot([makeTab('h1'), makeTab('h2')], { visible: false }));
      publishTerminalSessions(VISIBLE, snapshot([makeTab('a1'), makeTab('a2')]));

      expect(numbered()).toEqual(['a1', 'a2']);
      expect(terminalOrdinal(readNumberedTerminals(), 'a1')).toBe(1);
      expect(terminalOrdinal(readNumberedTerminals(), 'h1')).toBeNull();
    });

    it('[FR-TERMINAL-900] should follow the worktree-grouped order the rail lists', () => {
      publishTerminalSessions(
        VISIBLE,
        snapshot([makeTab('wt1', { worktreeBranch: 'feat' }), makeTab('main1'), makeTab('main2')]),
      );

      expect(numbered()).toEqual(['main1', 'main2', 'wt1']);
    });

    it('[FR-TERMINAL-900] should follow the project-grouped order in Command Center mode', () => {
      publishTerminalSessions(
        VISIBLE,
        snapshot(
          [
            makeTab('other'),
            makeTab('alpha1', { projectSlug: 'alpha' }),
            makeTab('alpha2', { projectSlug: 'alpha' }),
          ],
          { commandCenter: true },
        ),
      );

      expect(numbered()).toEqual(['alpha1', 'alpha2', 'other']);
    });

    it('[FR-TERMINAL-900] should renumber when the rail order changes', () => {
      const a = makeTab('a');
      const b = makeTab('b');
      publishTerminalSessions(VISIBLE, snapshot([a, b]));
      expect(numbered()).toEqual(['a', 'b']);

      publishTerminalSessions(VISIBLE, snapshot([b, a]));
      expect(numbered()).toEqual(['b', 'a']);
    });

    it('[FR-TERMINAL-900] should switch numbers to the newly visible app tab', () => {
      publishTerminalSessions(VISIBLE, snapshot([makeTab('a1')]));
      publishTerminalSessions(HIDDEN, snapshot([makeTab('h1')], { visible: false }));

      publishTerminalSessions(VISIBLE, snapshot([makeTab('a1')], { visible: false }));
      publishTerminalSessions(HIDDEN, snapshot([makeTab('h1')]));

      expect(numbered()).toEqual(['h1']);
    });

    // useSyncExternalStore compares by identity and loops forever on a fresh
    // array each read, so an unchanged list must return the same reference.
    it('should return a stable reference while the snapshot is unchanged', () => {
      publishTerminalSessions(VISIBLE, snapshot([makeTab('a1')]));
      expect(readNumberedTerminals()).toBe(readNumberedTerminals());
    });

    it('should number nothing while no rail is visible', () => {
      publishTerminalSessions(HIDDEN, snapshot([makeTab('h1')], { visible: false }));
      expect(numbered()).toEqual([]);
    });

    it('[FR-TERMINAL-900] should renumber when a group collapses or opens', () => {
      const ops = { id: 'ops', name: 'Ops' };
      publishTerminalSessions(
        VISIBLE,
        snapshot([
          { ...makeTab('o1'), railGroup: ops },
          { ...makeTab('o2'), railGroup: ops },
          makeTab('b'),
        ]),
      );
      expect(numbered()).toEqual(['o1', 'o2', 'b']);

      toggleRailGroupCollapsed('ops');
      expect(numbered()).toEqual(['b']);

      toggleRailGroupCollapsed('ops');
      expect(numbered()).toEqual(['o1', 'o2', 'b']);
    });
  });
});
