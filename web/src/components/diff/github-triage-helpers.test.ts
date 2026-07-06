import { describe, it, expect } from 'vitest';
import {
  filterUnresolvedGithubThreads,
  getSelectedThreads,
  allGithubThreadIds,
} from './github-triage-helpers';
import type { DiffComment } from './use-diff-comments';

function makeComment(overrides: Partial<DiffComment> = {}): DiffComment {
  return {
    threadId: 'thread-1',
    documentPath: 'diff:///repo/src/foo.ts',
    lineNumber: 10,
    codeLine: '',
    side: 'modified',
    resolved: false,
    source: 'local',
    comments: [{ id: 'c1', body: 'text', userId: 'user', createdAt: null }],
    ...overrides,
  };
}

function makeGithubComment(overrides: Partial<DiffComment> = {}): DiffComment {
  return makeComment({ source: 'github', githubAuthor: 'alice', ...overrides });
}

describe('filterUnresolvedGithubThreads', () => {
  it('should return only unresolved github-sourced threads', () => {
    const comments = [
      makeGithubComment({ threadId: 'gh-1' }),
      makeGithubComment({ threadId: 'gh-2', resolved: true }),
      makeComment({ threadId: 'local-1' }),
    ];

    const result = filterUnresolvedGithubThreads(comments);

    expect(result).toHaveLength(1);
    expect(result[0].threadId).toBe('gh-1');
  });

  it('should return empty array when no github threads exist', () => {
    const comments = [makeComment({ threadId: 'local-1' })];
    expect(filterUnresolvedGithubThreads(comments)).toHaveLength(0);
  });

  it('should return empty array when all github threads are resolved', () => {
    const comments = [makeGithubComment({ resolved: true })];
    expect(filterUnresolvedGithubThreads(comments)).toHaveLength(0);
  });
});

describe('getSelectedThreads', () => {
  it('should return github threads whose ids are in selectedIds', () => {
    const comments = [
      makeGithubComment({ threadId: 'gh-1' }),
      makeGithubComment({ threadId: 'gh-2' }),
      makeComment({ threadId: 'local-1' }),
    ];
    const selected = new Set(['gh-1', 'local-1']);

    const result = getSelectedThreads(comments, selected);

    expect(result).toHaveLength(1);
    expect(result[0].threadId).toBe('gh-1');
  });

  it('should exclude resolved github threads even if selected', () => {
    const comments = [makeGithubComment({ threadId: 'gh-1', resolved: true })];
    const selected = new Set(['gh-1']);

    expect(getSelectedThreads(comments, selected)).toHaveLength(0);
  });

  it('should return empty array when selectedIds is empty', () => {
    const comments = [makeGithubComment({ threadId: 'gh-1' })];
    expect(getSelectedThreads(comments, new Set())).toHaveLength(0);
  });

  it('should not return local threads even when their id is in selectedIds', () => {
    const comments = [
      makeComment({ threadId: 'shared-id', source: 'local' }),
      makeGithubComment({ threadId: 'gh-1' }),
    ];
    const selected = new Set(['shared-id', 'gh-1']);

    const result = getSelectedThreads(comments, selected);

    expect(result).toHaveLength(1);
    expect(result[0].threadId).toBe('gh-1');
  });
});

describe('allGithubThreadIds', () => {
  it('should return ids of all unresolved github threads', () => {
    const comments = [
      makeGithubComment({ threadId: 'gh-1' }),
      makeGithubComment({ threadId: 'gh-2' }),
      makeGithubComment({ threadId: 'gh-3', resolved: true }),
      makeComment({ threadId: 'local-1' }),
    ];

    const result = allGithubThreadIds(comments);

    expect(result.size).toBe(2);
    expect(result.has('gh-1')).toBe(true);
    expect(result.has('gh-2')).toBe(true);
  });

  it('should return empty set when no unresolved github threads exist', () => {
    const comments = [makeComment({ threadId: 'local-1' })];
    expect(allGithubThreadIds(comments).size).toBe(0);
  });
});

