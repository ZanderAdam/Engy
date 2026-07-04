import { describe, it, expect } from 'vitest';
import { classifyPrRepoErrors, repoDisplayName } from './pr-errors';

describe('pr errors', () => {
  describe('classifyPrRepoErrors', () => {
    it('should return no errors for an empty map', () => {
      expect(classifyPrRepoErrors({})).toEqual({ global: null, perRepo: [] });
    });

    it('[FR-PRMON-130] should collapse gh-not-installed to a global error', () => {
      const result = classifyPrRepoErrors({
        '/repo/a': 'gh-not-installed',
        '/repo/b': 'some other failure',
      });
      expect(result.global).toBe('gh-not-installed');
      expect(result.perRepo).toEqual([]);
    });

    it('[FR-PRMON-130] should collapse daemon errors to a global no-daemon error', () => {
      const result = classifyPrRepoErrors({
        '/repo/a': 'No daemon connected',
        '/repo/b': 'Daemon disconnected',
      });
      expect(result.global).toBe('no-daemon');
      expect(result.perRepo).toEqual([]);
    });

    it('[FR-PRMON-130] should keep auth and generic errors per repo while other repos stay healthy', () => {
      const result = classifyPrRepoErrors({
        '/repo/enterprise': 'gh-not-authenticated',
        '/repo/broken': 'could not resolve to a Repository',
      });
      expect(result.global).toBeNull();
      expect(result.perRepo).toEqual([
        { repo: '/repo/enterprise', kind: 'gh-not-authenticated', message: 'gh-not-authenticated' },
        {
          repo: '/repo/broken',
          kind: 'generic',
          message: 'could not resolve to a Repository',
        },
      ]);
    });

    it('should collapse to no-daemon even when stale per-repo errors linger from before the disconnect', () => {
      const result = classifyPrRepoErrors({
        '/repo/a': 'No daemon connected',
        '/repo/b': 'gh-not-authenticated',
      });
      expect(result.global).toBe('no-daemon');
      expect(result.perRepo).toEqual([]);
    });
  });

  describe('repoDisplayName', () => {
    it('should return the last path segment', () => {
      expect(repoDisplayName('/Users/dev/my-repo')).toBe('my-repo');
    });
  });
});
