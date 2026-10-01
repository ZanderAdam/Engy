import { describe, it, expect } from 'vitest';
import { EVENT_META, hasAvatar, summarizeEvent, type InboxEventKind } from './inbox-event-meta';

const KINDS = Object.keys(EVENT_META) as InboxEventKind[];

describe('inbox-event-meta', () => {
  describe('EVENT_META', () => {
    it.each(KINDS)('should give %s an icon, colour and plain verb', (kind) => {
      const meta = EVENT_META[kind];
      expect(meta.icon).toBeTruthy();
      expect(meta.className).toMatch(/^text-/);
      expect(meta.verb).not.toContain('_');
    });
  });

  describe('summarizeEvent', () => {
    const cases: [InboxEventKind, string | null, string][] = [
      ['review_requested', 'alice', 'alice requested your review'],
      ['mentioned', 'bob', 'bob mentioned you'],
      ['commented', 'alice', 'alice commented'],
      ['approved', 'alice', 'alice approved'],
      ['changes_requested', 'alice', 'alice requested changes'],
      ['reviewed', 'alice', 'alice reviewed'],
      ['ci_failed', 'CI', 'CI failed'],
      ['ci_passed', 'CI', 'CI passed'],
      ['auto_fix_attention', null, 'Auto-fix needs attention'],
      ['merged', 'alice', 'alice merged'],
      ['closed', 'alice', 'alice closed'],
      ['reopened', 'alice', 'alice reopened'],
      ['pushed', 'alice', 'alice pushed'],
      ['assigned', 'alice', 'alice assigned you'],
    ];

    it.each(cases)('should describe a raw %s event from %s as "%s"', (kind, actor, expected) => {
      expect(summarizeEvent({ kind, actor, summary: kind })).toBe(expected);
    });

    it('should treat an empty summary as raw', () => {
      expect(summarizeEvent({ kind: 'approved', actor: 'alice', summary: '' })).toBe(
        'alice approved',
      );
    });

    it('should treat a summary that embeds a raw kind as raw', () => {
      expect(
        summarizeEvent({
          kind: 'review_requested',
          actor: 'alice',
          summary: 'alice review_requested',
        }),
      ).toBe('alice requested your review');
    });

    it('should capitalise the verb when there is no actor', () => {
      expect(summarizeEvent({ kind: 'merged', actor: null, summary: 'merged' })).toBe('Merged');
    });

    it('should keep a stored summary that is already human', () => {
      expect(
        summarizeEvent({ kind: 'commented', actor: 'alice', summary: 'Looks good to me' }),
      ).toBe('Looks good to me');
    });

    it('should handle an item without events', () => {
      expect(summarizeEvent(null)).toBe('No activity');
    });
  });

  describe('hasAvatar', () => {
    it('should show an avatar for human actors only', () => {
      expect(hasAvatar({ kind: 'approved', actor: 'alice' })).toBe(true);
      expect(hasAvatar({ kind: 'approved', actor: null })).toBe(false);
      expect(hasAvatar({ kind: 'ci_failed', actor: 'CI' })).toBe(false);
    });
  });
});
