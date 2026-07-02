import { describe, it, expect } from 'vitest';
import type { GhPrCheck } from '@engy/common';
import type { MaterialChange } from '../trpc/routers/pr';
import { detectFailureTransitions, classifyFailure } from './ci-triage';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeCheck(name: string, conclusion: string | null = 'failure'): GhPrCheck {
  return { name, status: 'completed', conclusion, detailsUrl: null };
}

function makeChange(
  overrides: Partial<MaterialChange> = {},
): MaterialChange {
  return {
    number: 1,
    repo: '/repo',
    type: 'ciStatus',
    previous: 'passing',
    current: 'failing',
    ...overrides,
  };
}

// ── detectFailureTransitions ────────────────────────────────────────────────

describe('ci-triage', () => {
  describe('detectFailureTransitions', () => {
    it('should return entries for ciStatus changes to failing', () => {
      const changes: MaterialChange[] = [
        makeChange({ number: 10, repo: '/repo-a' }),
        makeChange({ number: 20, repo: '/repo-b' }),
      ];
      expect(detectFailureTransitions(changes)).toEqual([
        { number: 10, repo: '/repo-a' },
        { number: 20, repo: '/repo-b' },
      ]);
    });

    it('should ignore non-ciStatus changes', () => {
      const changes: MaterialChange[] = [
        makeChange({ type: 'state', current: 'closed' }),
        makeChange({ type: 'reviewDecision', current: 'APPROVED' }),
        makeChange({ type: 'new', current: 'open' }),
      ];
      expect(detectFailureTransitions(changes)).toHaveLength(0);
    });

    it('should ignore ciStatus changes to non-failing values', () => {
      const changes: MaterialChange[] = [
        makeChange({ current: 'passing' }),
        makeChange({ current: 'pending' }),
        makeChange({ current: 'unknown' }),
      ];
      expect(detectFailureTransitions(changes)).toHaveLength(0);
    });

    it('should return an empty array when given no changes', () => {
      expect(detectFailureTransitions([])).toEqual([]);
    });

    it('should handle mixed changes and return only failing ciStatus entries', () => {
      const changes: MaterialChange[] = [
        makeChange({ number: 1, type: 'new', current: 'open' }),
        makeChange({ number: 2, type: 'ciStatus', current: 'failing' }),
        makeChange({ number: 3, type: 'ciStatus', current: 'passing' }),
        makeChange({ number: 4, type: 'ciStatus', current: 'failing' }),
      ];
      const result = detectFailureTransitions(changes);
      expect(result.map((r) => r.number)).toEqual([2, 4]);
    });
  });

  // ── classifyFailure ────────────────────────────────────────────────────────

  describe('classifyFailure', () => {
    it('should classify as mechanical when check name contains "lint"', () => {
      expect(classifyFailure([makeCheck('ESLint')], [])).toBe('mechanical');
      expect(classifyFailure([makeCheck('Lint Check')], [])).toBe('mechanical');
      expect(classifyFailure([makeCheck('run-lint')], [])).toBe('mechanical');
    });

    it('should classify as mechanical when check name contains "typecheck" or "tsc"', () => {
      expect(classifyFailure([makeCheck('typecheck')], [])).toBe('mechanical');
      expect(classifyFailure([makeCheck('Type Check')], [])).toBe('mechanical');
      expect(classifyFailure([makeCheck('tsc')], [])).toBe('mechanical');
      expect(classifyFailure([makeCheck('TypeScript')], [])).toBe('mechanical');
    });

    it('should classify as mechanical when check name contains "test", "vitest", or "jest"', () => {
      expect(classifyFailure([makeCheck('Test')], [])).toBe('mechanical');
      expect(classifyFailure([makeCheck('vitest')], [])).toBe('mechanical');
      expect(classifyFailure([makeCheck('jest')], [])).toBe('mechanical');
      expect(classifyFailure([makeCheck('unit-tests')], [])).toBe('mechanical');
    });

    it('should classify as mechanical when check name contains "build"', () => {
      expect(classifyFailure([makeCheck('Build')], [])).toBe('mechanical');
      expect(classifyFailure([makeCheck('build-and-test')], [])).toBe('mechanical');
    });

    it('should classify as mechanical when check name contains "knip"', () => {
      expect(classifyFailure([makeCheck('knip')], [])).toBe('mechanical');
    });

    it('should classify as mechanical when check name contains "format" or "prettier"', () => {
      expect(classifyFailure([makeCheck('format')], [])).toBe('mechanical');
      expect(classifyFailure([makeCheck('prettier')], [])).toBe('mechanical');
    });

    it('should classify as mechanical when check name contains "deps" or "install"', () => {
      expect(classifyFailure([makeCheck('deps')], [])).toBe('mechanical');
      expect(classifyFailure([makeCheck('npm-install')], [])).toBe('mechanical');
    });

    it('should classify as mechanical from log content "error TS"', () => {
      expect(
        classifyFailure([], [{ checkName: 'CI', excerpt: 'src/foo.ts(10,5): error TS2345' }]),
      ).toBe('mechanical');
    });

    it('should classify as mechanical from log content "FAIL " (jest output)', () => {
      expect(
        classifyFailure([], [{ checkName: 'CI', excerpt: 'FAIL src/foo.test.ts' }]),
      ).toBe('mechanical');
    });

    it('should classify as mechanical from log content "Cannot find module"', () => {
      expect(
        classifyFailure([], [{ checkName: 'CI', excerpt: 'Cannot find module ./missing' }]),
      ).toBe('mechanical');
    });

    it('should classify as mechanical from log content "ERESOLVE"', () => {
      expect(
        classifyFailure([], [{ checkName: 'CI', excerpt: 'npm error ERESOLVE unable to resolve' }]),
      ).toBe('mechanical');
    });

    it('should classify as mechanical from log checkName matching a pattern', () => {
      expect(
        classifyFailure([], [{ checkName: 'ESLint Check', excerpt: '' }]),
      ).toBe('mechanical');
    });

    it('should return non-mechanical for unknown check names and empty logs', () => {
      expect(classifyFailure([makeCheck('Deploy Preview')], [])).toBe('non-mechanical');
      expect(classifyFailure([makeCheck('Production Deploy')], [])).toBe('non-mechanical');
      expect(classifyFailure([makeCheck('Security Scan')], [])).toBe('non-mechanical');
    });

    it('should return non-mechanical when checks and logs are empty', () => {
      expect(classifyFailure([], [])).toBe('non-mechanical');
    });

    it('should classify as mechanical even if only one check name matches among many', () => {
      const checks = [
        makeCheck('Deploy Preview'),
        makeCheck('Security Scan'),
        makeCheck('Lint'),
      ];
      expect(classifyFailure(checks, [])).toBe('mechanical');
    });

    it('should classify as non-mechanical for a failed deployment check with no log signals', () => {
      expect(
        classifyFailure(
          [makeCheck('Production Deploy')],
          [{ checkName: 'Production Deploy', excerpt: 'Deploy failed: server unreachable' }],
        ),
      ).toBe('non-mechanical');
    });

    it('should classify as mechanical from mixed checks when one matches', () => {
      const checks = [makeCheck('Security Scan'), makeCheck('typecheck')];
      expect(classifyFailure(checks, [])).toBe('mechanical');
    });
  });
});
