import { describe, it, expect } from 'vitest';
import { applyOscTitle, sanitizeOscTitle } from './osc-title';
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

describe('sanitizeOscTitle', () => {
  it('should pass through a plain title', () => {
    expect(sanitizeOscTitle('✳ Fixing tests — engy')).toBe('✳ Fixing tests — engy');
  });

  it('should strip C0 and C1 control characters', () => {
    expect(sanitizeOscTitle('a\x1b[31mb\x07c\x9bd')).toBe('a[31mbcd');
  });

  it('should trim surrounding whitespace', () => {
    expect(sanitizeOscTitle('  title  ')).toBe('title');
  });

  it('should cap overly long titles', () => {
    expect(sanitizeOscTitle('x'.repeat(1000))).toHaveLength(256);
  });

  it('should not split a surrogate pair at the length cap', () => {
    const capped = sanitizeOscTitle('💚'.repeat(300));
    expect(capped.isWellFormed()).toBe(true);
    expect(capped.length).toBeLessThanOrEqual(256);
  });

  it('should return empty string for control-only input', () => {
    expect(sanitizeOscTitle('\x07\x1b')).toBe('');
  });
});

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

    it('should return null when the title is pinned by a manual rename', () => {
      const tab = makeTab({ titlePinned: true });
      expect(applyOscTitle(tab, 'anything')).toBeNull();
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
