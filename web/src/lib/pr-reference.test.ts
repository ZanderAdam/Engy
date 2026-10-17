import { describe, it, expect } from 'vitest';
import { parsePrReference } from './pr-reference';

describe('pr reference', () => {
  describe('parsePrReference', () => {
    it('[FR-INBOX-650] should read a bare or hash-prefixed number as a PR of any repo', () => {
      expect(parsePrReference('123')).toEqual({ repoFullName: null, prNumber: 123 });
      expect(parsePrReference(' #42 ')).toEqual({ repoFullName: null, prNumber: 42 });
    });

    it('[FR-INBOX-650] should read a GitHub PR URL as a PR of its repo', () => {
      expect(parsePrReference('https://github.com/acme/api/pull/7')).toEqual({
        repoFullName: 'acme/api',
        prNumber: 7,
      });
      expect(parsePrReference('https://github.com/acme/api/pull/7/files#diff-1')).toEqual({
        repoFullName: 'acme/api',
        prNumber: 7,
      });
    });

    it('[FR-INBOX-650] should read any other text as a search query', () => {
      expect(parsePrReference('fix 123')).toBeNull();
      expect(parsePrReference('author:me')).toBeNull();
      expect(parsePrReference('https://github.com/acme/api/issues/7')).toBeNull();
      expect(parsePrReference('')).toBeNull();
    });

    it('[FR-INBOX-650] should reject numbers that cannot be a PR number', () => {
      expect(parsePrReference('0')).toBeNull();
      expect(parsePrReference('99999999999')).toBeNull();
    });
  });
});
