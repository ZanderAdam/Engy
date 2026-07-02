import { describe, it, expect } from 'vitest';
import {
  ciStatusLabel,
  ciStatusClassName,
  reviewDecisionLabel,
  formatRelativeTime,
  summarizeChecks,
} from './pr-helpers';
import type { GhPrCheck } from '@engy/common';

describe('ciStatusLabel', () => {
  it('should return "Passing" for passing status', () => {
    expect(ciStatusLabel('passing')).toBe('Passing');
  });

  it('should return "Failing" for failing status', () => {
    expect(ciStatusLabel('failing')).toBe('Failing');
  });

  it('should return "Pending" for pending status', () => {
    expect(ciStatusLabel('pending')).toBe('Pending');
  });

  it('should return "Unknown" for unknown status', () => {
    expect(ciStatusLabel('unknown')).toBe('Unknown');
  });
});

describe('ciStatusClassName', () => {
  it('should return green classes for passing', () => {
    const cls = ciStatusClassName('passing');
    expect(cls).toContain('green');
  });

  it('should return red classes for failing', () => {
    const cls = ciStatusClassName('failing');
    expect(cls).toContain('red');
  });

  it('should return amber classes for pending', () => {
    const cls = ciStatusClassName('pending');
    expect(cls).toContain('amber');
  });

  it('should return muted classes for unknown', () => {
    const cls = ciStatusClassName('unknown');
    expect(cls).toContain('muted');
  });
});

describe('reviewDecisionLabel', () => {
  it('should return null for null decision', () => {
    expect(reviewDecisionLabel(null)).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(reviewDecisionLabel('')).toBeNull();
  });

  it('should return "Approved" for APPROVED', () => {
    expect(reviewDecisionLabel('APPROVED')).toBe('Approved');
  });

  it('should return "Changes requested" for CHANGES_REQUESTED', () => {
    expect(reviewDecisionLabel('CHANGES_REQUESTED')).toBe('Changes requested');
  });

  it('should return "Review required" for REVIEW_REQUIRED', () => {
    expect(reviewDecisionLabel('REVIEW_REQUIRED')).toBe('Review required');
  });

  it('should return the raw value for unknown decisions', () => {
    expect(reviewDecisionLabel('SOME_OTHER')).toBe('SOME_OTHER');
  });
});

describe('formatRelativeTime', () => {
  it('should return "just now" for very recent timestamps', () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe('just now');
  });

  it('should return minutes for timestamps within an hour', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatRelativeTime(fiveMinutesAgo)).toBe('5m ago');
  });

  it('should return hours for timestamps within a day', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(twoHoursAgo)).toBe('2h ago');
  });

  it('should return days for timestamps older than a day', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(threeDaysAgo)).toBe('3d ago');
  });
});

describe('summarizeChecks', () => {
  it('should return zeros for empty checks', () => {
    expect(summarizeChecks([])).toEqual({ passing: 0, failing: 0, pending: 0, total: 0 });
  });

  it('should count passing checks with success conclusion', () => {
    const checks: GhPrCheck[] = [
      { name: 'build', status: 'completed', conclusion: 'success', detailsUrl: null },
    ];
    expect(summarizeChecks(checks)).toEqual({ passing: 1, failing: 0, pending: 0, total: 1 });
  });

  it('should count failing checks with failure conclusion', () => {
    const checks: GhPrCheck[] = [
      { name: 'test', status: 'completed', conclusion: 'failure', detailsUrl: null },
    ];
    expect(summarizeChecks(checks)).toEqual({ passing: 0, failing: 1, pending: 0, total: 1 });
  });

  it('should count pending checks that are in progress', () => {
    const checks: GhPrCheck[] = [
      { name: 'lint', status: 'in_progress', conclusion: null, detailsUrl: null },
    ];
    expect(summarizeChecks(checks)).toEqual({ passing: 0, failing: 0, pending: 1, total: 1 });
  });

  it('should count multiple checks across categories', () => {
    const checks: GhPrCheck[] = [
      { name: 'build', status: 'completed', conclusion: 'success', detailsUrl: null },
      { name: 'test', status: 'completed', conclusion: 'failure', detailsUrl: null },
      { name: 'lint', status: 'in_progress', conclusion: null, detailsUrl: null },
      { name: 'deploy', status: 'completed', conclusion: 'skipped', detailsUrl: null },
    ];
    expect(summarizeChecks(checks)).toEqual({ passing: 2, failing: 1, pending: 1, total: 4 });
  });
});
