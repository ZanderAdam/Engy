import { describe, it, expect } from 'vitest';
import {
  commentScopeKey,
  commentText,
  isPendingComment,
  renderThreadComments,
} from './comment-feedback';

describe('comment feedback', () => {
  describe('isPendingComment', () => {
    it('[FR-EDITOR-200] should treat an unsent user comment as pending', () => {
      expect(isPendingComment({ userId: 'local-user' }, false)).toBe(true);
    });

    it('[FR-EDITOR-200] should skip sent and deleted comments', () => {
      expect(isPendingComment({ userId: 'local-user', sentAt: '2026-01-01' }, true)).toBe(false);
      expect(isPendingComment({ userId: 'local-user', deletedAt: '2026-01-01' }, true)).toBe(false);
    });

    it('[FR-EDITOR-200] should skip agent replies but keep an agent-authored thread root', () => {
      expect(isPendingComment({ userId: 'agent' }, false)).toBe(false);
      expect(isPendingComment({ userId: 'agent' }, true)).toBe(true);
    });
  });

  describe('commentText', () => {
    it('should read string bodies and BlockNote blocks', () => {
      expect(commentText('  plain  ')).toBe('plain');
      expect(
        commentText([
          { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
        ]),
      ).toBe('a\nb');
      expect(commentText(null)).toBe('');
    });
  });

  describe('renderThreadComments', () => {
    it('[FR-EDITOR-210] should label each comment with its author', () => {
      expect(
        renderThreadComments([
          { userId: 'local-user', body: 'one\ntwo' },
          { userId: 'octocat', body: 'three' },
        ]),
      ).toEqual(['> **user:** one\n> two', '> **octocat:** three']);
    });

    it('[FR-EDITOR-210] should set context apart from new comments', () => {
      expect(
        renderThreadComments([
          { userId: 'agent', body: 'finding', context: true },
          { userId: 'local-user', body: 'reply' },
        ]),
      ).toEqual([
        'Earlier in this thread (already sent):',
        '> **agent:** finding',
        'New:',
        '> **user:** reply',
      ]);
    });

    it('should render nothing when only context is left', () => {
      expect(renderThreadComments([{ body: 'old', context: true }])).toEqual([]);
    });
  });

  describe('commentScopeKey', () => {
    it('should tell an exact path apart from the same prefix', () => {
      expect(commentScopeKey({ documentPath: 'a' })).not.toBe(
        commentScopeKey({ documentPath: 'a', prefix: true }),
      );
    });
  });
});
