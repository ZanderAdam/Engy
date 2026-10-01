import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAppState, type AppState } from '../trpc/context';
import { fetchReviewComments } from './review-comments';
import { startStubGithub, type StubGithub } from './stub-server';

const rawComment = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  path: 'src/a.ts',
  line: 10,
  original_line: 8,
  body: `comment ${id}`,
  user: { login: 'reviewer' },
  created_at: '2024-01-02T00:00:00Z',
  html_url: `https://github.com/org/repo/pull/7#discussion_r${id}`,
  ...overrides,
});

describe('github review comments', () => {
  let stub: StubGithub;
  let state: AppState;

  beforeEach(async () => {
    stub = await startStubGithub();
    state = createAppState();
    process.env.ENGY_GITHUB_API_URL = stub.url;
    process.env.ENGY_GITHUB_TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  });

  afterEach(async () => {
    delete process.env.ENGY_GITHUB_API_URL;
    delete process.env.ENGY_GITHUB_TOKEN;
    await stub.close();
  });

  it('[FR-PRMON-150] should read every page of PR review comments', async () => {
    stub.reply((request) => {
      if (request.url.includes('page=2')) return { body: [rawComment(2)] };
      return {
        body: [rawComment(1)],
        headers: { link: `<${stub.url}/repos/org/repo/pulls/7/comments?page=2>; rel="next"` },
      };
    });

    const comments = await fetchReviewComments(state, 'org/repo', 7);

    expect(stub.requests[0].url).toContain('/repos/org/repo/pulls/7/comments');
    expect(comments.map((c) => c.githubId)).toEqual([1, 2]);
  });

  it('[FR-PRMON-150] should map comments, falling back to original_line and linking replies', async () => {
    stub.reply(() => ({
      body: [rawComment(1, { line: null }), rawComment(2, { in_reply_to_id: 1 })],
    }));

    const comments = await fetchReviewComments(state, 'org/repo', 7);

    expect(comments).toEqual([
      {
        githubId: 1,
        path: 'src/a.ts',
        line: 8,
        body: 'comment 1',
        author: 'reviewer',
        createdAt: '2024-01-02T00:00:00Z',
        inReplyToId: null,
        url: 'https://github.com/org/repo/pull/7#discussion_r1',
      },
      expect.objectContaining({ githubId: 2, line: 10, inReplyToId: 1 }),
    ]);
  });
});
