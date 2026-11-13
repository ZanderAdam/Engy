import { describe, expect, it } from 'vitest';
import { hasHeaderAttention } from './header-attention';

describe('header attention', () => {
  describe('hasHeaderAttention', () => {
    it('should be false when nothing is unread or unanswered', () => {
      expect(hasHeaderAttention({ inboxUnreadPriority: 0, unansweredCount: 0 })).toBe(false);
    });

    it('should be true when the inbox has unread priority items', () => {
      expect(hasHeaderAttention({ inboxUnreadPriority: 3, unansweredCount: 0 })).toBe(true);
    });

    it('should be true when questions are unanswered', () => {
      expect(hasHeaderAttention({ inboxUnreadPriority: 0, unansweredCount: 1 })).toBe(true);
    });
  });
});
