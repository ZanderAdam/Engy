import { describe, it, expect } from 'vitest';
import { isPrOutstanding, type OutstandingPrFacts } from './pr-outstanding';

const quietPr: OutstandingPrFacts = {
  authoredByViewer: true,
  reviewDecision: null,
  ciStatus: 'passing',
  attentionReason: null,
  reviewRequests: [],
};

describe('isPrOutstanding', () => {
  describe('own PRs', () => {
    it('[FR-PRMON-210] should not count a PR with passing CI and no feedback', () => {
      expect(isPrOutstanding(quietPr, 'me')).toBe(false);
    });

    it('[FR-PRMON-210] should count a PR with changes requested', () => {
      expect(isPrOutstanding({ ...quietPr, reviewDecision: 'CHANGES_REQUESTED' }, 'me')).toBe(true);
    });

    it('should count a PR with failing CI', () => {
      expect(isPrOutstanding({ ...quietPr, ciStatus: 'failing' }, 'me')).toBe(true);
    });

    it('should count a PR that needs attention', () => {
      expect(isPrOutstanding({ ...quietPr, attentionReason: 'non-mechanical' }, 'me')).toBe(true);
    });
  });

  describe('PRs by others', () => {
    const theirPr = { ...quietPr, authoredByViewer: false, reviewRequests: ['Me', 'bob'] };

    it('[FR-PRMON-210] should count a PR that requests the viewer review, ignoring login case', () => {
      expect(isPrOutstanding(theirPr, 'me')).toBe(true);
    });

    it('should not count a PR that no longer requests the viewer', () => {
      expect(isPrOutstanding({ ...theirPr, reviewRequests: ['bob'] }, 'me')).toBe(false);
    });

    it('should not count anything while the viewer login is unknown', () => {
      expect(isPrOutstanding(theirPr, null)).toBe(false);
    });
  });
});
