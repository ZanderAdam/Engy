import { describe, it, expect } from 'vitest';
import type { ConversationItem } from '@/server/github/pr-detail';
import {
  isBehindGithub,
  isLongDescription,
  isPrChangeForReview,
  latestReviewVerdicts,
  reviewStateLabel,
} from './review-helpers';

function review(login: string, state: string, createdAt: string): ConversationItem {
  return {
    kind: 'review',
    id: `${login}-${createdAt}`,
    author: { login, avatarUrl: null },
    state,
    body: '',
    createdAt,
    url: '',
  };
}

describe('[FR-PRREVIEW-240] latestReviewVerdicts', () => {
  it('should keep the newest verdict per reviewer', () => {
    const verdicts = latestReviewVerdicts([
      review('bob', 'CHANGES_REQUESTED', '2024-01-01'),
      review('bob', 'APPROVED', '2024-01-02'),
      review('carol', 'COMMENTED', '2024-01-03'),
    ]);

    expect(verdicts.map((v) => [v.login, v.state])).toEqual([
      ['bob', 'APPROVED'],
      ['carol', 'COMMENTED'],
    ]);
  });

  it('should not let a later plain comment hide an earlier verdict', () => {
    const verdicts = latestReviewVerdicts([
      review('bob', 'APPROVED', '2024-01-01'),
      review('bob', 'COMMENTED', '2024-01-02'),
    ]);

    expect(verdicts).toEqual([expect.objectContaining({ login: 'bob', state: 'APPROVED' })]);
  });

  it('should ignore comments and commits', () => {
    const verdicts = latestReviewVerdicts([
      { kind: 'comment', id: 'c', author: null, body: '', createdAt: '', url: '' },
      { ...review('bob', 'APPROVED', 'x'), author: null },
    ]);

    expect(verdicts).toEqual([]);
  });
});

describe('[FR-PRREVIEW-240] reviewStateLabel', () => {
  it.each([
    ['APPROVED', 'Approved'],
    ['CHANGES_REQUESTED', 'Requested changes'],
    ['COMMENTED', 'Commented'],
    ['SOMETHING_NEW', 'SOMETHING_NEW'],
  ])('should label %s as %s', (state, label) => {
    expect(reviewStateLabel(state)).toBe(label);
  });
});

describe('[FR-PRREVIEW-250] isBehindGithub', () => {
  it.each([
    ['aaa', 'bbb', true],
    ['aaa', 'aaa', false],
    ['aaa', undefined, false],
    ['aaa', '', false],
  ])('should compare %s with %s', (worktree, github, expected) => {
    expect(isBehindGithub(worktree, github)).toBe(expected);
  });
});

describe('[FR-PRREVIEW-270] isPrChangeForReview', () => {
  it.each([
    [
      'the repo path of the open worktree',
      { workspaceId: 1, repo: '/repos/app' },
      '/repos/app',
      true,
    ],
    ['another repo path', { workspaceId: 1, repo: '/repos/other' }, '/repos/app', false],
    ['the repo full name', { workspaceId: 1, repo: 'org/app' }, '/repos/app', false],
    ['another workspace', { workspaceId: 2, repo: '/repos/app' }, '/repos/app', false],
    ['any repo when no worktree is open', { workspaceId: 1, repo: '/repos/other' }, null, true],
  ])('should handle %s', (_name, payload, repoPath, expected) => {
    expect(isPrChangeForReview(payload, 1, repoPath)).toBe(expected);
  });
});

describe('[FR-PRREVIEW-290] isLongDescription', () => {
  it('should collapse a description with many lines', () => {
    expect(isLongDescription(Array.from({ length: 13 }, (_, i) => `line ${i}`).join('\n'))).toBe(
      true,
    );
  });

  it('should collapse a description with many characters on few lines', () => {
    expect(isLongDescription('x'.repeat(1201))).toBe(true);
  });

  it('should show a short description in full', () => {
    expect(isLongDescription('Fixes the login bug.\n\nSee #12.')).toBe(false);
  });
});
