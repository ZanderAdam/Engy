import { describe, it, expect } from 'vitest';
import {
  NO_BUCKET_FACTS,
  computeBucket,
  isSnoozeDue,
  wakesSnooze,
  type BucketFacts,
  type InboxBucket,
  type InboxEventKind,
} from './bucket';

describe('bucket rules', () => {
  describe('[FR-INBOX-010] computeBucket', () => {
    const cases: [keyof BucketFacts | null, InboxBucket][] = [
      [null, 'other'],
      ['reviewRequestedNotGiven', 'priority'],
      ['mentioned', 'priority'],
      ['myPrChangesRequested', 'priority'],
      ['myPrCiFailing', 'priority'],
      ['myPrAutoFixAttention', 'priority'],
      ['myPrApprovedCiPassing', 'priority'],
    ];

    it.each(cases)('should return the bucket for fact %s', (fact, expected) => {
      const facts = fact ? { ...NO_BUCKET_FACTS, [fact]: true } : NO_BUCKET_FACTS;
      expect(computeBucket(facts)).toBe(expected);
    });

    it('should return priority when several facts hold', () => {
      expect(computeBucket({ ...NO_BUCKET_FACTS, mentioned: true, myPrCiFailing: true })).toBe(
        'priority',
      );
    });
  });

  describe('[FR-INBOX-020] wakesSnooze', () => {
    const cases: [InboxEventKind, InboxBucket, boolean][] = [
      ['review_requested', 'priority', true],
      ['mentioned', 'priority', true],
      ['changes_requested', 'priority', true],
      ['approved', 'priority', true],
      ['ci_failed', 'priority', true],
      ['ci_passed', 'priority', true],
      ['auto_fix_attention', 'priority', true],
      ['commented', 'priority', false],
      ['pushed', 'priority', false],
      ['merged', 'priority', false],
      ['reviewed', 'priority', false],
      ['mentioned', 'other', false],
      ['ci_failed', 'other', false],
      ['commented', 'other', false],
    ];

    it.each(cases)('should evaluate %s in bucket %s as %s', (kind, bucket, expected) => {
      expect(wakesSnooze(kind, bucket)).toBe(expected);
    });
  });

  describe('[FR-INBOX-030] isSnoozeDue', () => {
    const now = new Date('2026-01-10T12:00:00.000Z');
    const cases: [string | null, boolean][] = [
      [null, false],
      ['2026-01-10T11:59:59.000Z', true],
      ['2026-01-10T12:00:00.000Z', true],
      ['2026-01-10T12:00:01.000Z', false],
    ];

    it.each(cases)('should evaluate snoozedUntil %s as %s', (snoozedUntil, expected) => {
      expect(isSnoozeDue(snoozedUntil, now)).toBe(expected);
    });
  });
});
