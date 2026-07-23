import { describe, it, expect } from 'vitest';
import { applyOscTitle } from './osc-title';
import type { TerminalTab } from './types';

function makeTab(overrides: Partial<TerminalTab> = {}): TerminalTab {
  return {
    sessionId: 'sess-1',
    scope: {
      scopeType: 'workspace',
      scopeLabel: 'engy',
      workingDir: '/repo',
      groupKey: 'g1',
      workspaceSlug: 'engy',
    },
    status: 'active',
    ...overrides,
  };
}

describe('applyOscTitle', () => {
  describe('when the title is new', () => {
    it('should return an updated tab with the sanitized title', () => {
      const updated = applyOscTitle(makeTab(), ' ✳ build ');
      expect(updated?.oscTitle).toBe('✳ build');
    });

    it('should not mutate the original tab', () => {
      const tab = makeTab();
      applyOscTitle(tab, 'new title');
      expect(tab.oscTitle).toBeUndefined();
    });
  });

  describe('when no update is needed', () => {
    it('should return null when the title is unchanged after sanitization', () => {
      const tab = makeTab({ oscTitle: 'build' });
      expect(applyOscTitle(tab, ' build ')).toBeNull();
    });

    it('should return null for an empty title on a tab without one', () => {
      expect(applyOscTitle(makeTab(), '')).toBeNull();
    });
  });

  describe('when the title is cleared', () => {
    it('should reset oscTitle so the tab falls back to scopeLabel', () => {
      const tab = makeTab({ oscTitle: 'old title' });
      const updated = applyOscTitle(tab, '');
      expect(updated).not.toBeNull();
      expect(updated?.oscTitle).toBeUndefined();
    });
  });
});
