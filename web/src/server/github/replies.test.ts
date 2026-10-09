import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAppState, type AppState } from '../trpc/context';
import { MAX_REPLIES, fetchReplies } from './replies';
import { startStubGithub, type StubGithub } from './stub-server';

let commentSeq = 0;
function comment(login: string, createdAt: string, body = `${login} says hi`) {
  commentSeq += 1;
  return {
    databaseId: commentSeq,
    body,
    url: `https://github.com/acme/api/pull/1#c${commentSeq}`,
    createdAt,
    author: { __typename: 'User', login },
  };
}

function rawPr(overrides: Record<string, unknown> = {}) {
  return {
    number: 1,
    title: 'Fix things',
    url: 'https://github.com/acme/api/pull/1',
    author: { login: 'me' },
    repository: { nameWithOwner: 'acme/api' },
    comments: { nodes: [] },
    reviewThreads: { nodes: [] },
    ...overrides,
  };
}

function thread(path: string, line: number | null, comments: unknown[]) {
  return { path, line, originalLine: 3, comments: { nodes: comments } };
}

describe('github replies', () => {
  let stub: StubGithub;
  let state: AppState;
  let nodes: unknown[];

  beforeEach(async () => {
    stub = await startStubGithub();
    state = createAppState();
    process.env.ENGY_GITHUB_API_URL = stub.url;
    process.env.ENGY_GITHUB_TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    nodes = [];
    stub.reply(() => ({ body: { data: { search: { nodes } } } }));
  });

  afterEach(async () => {
    delete process.env.ENGY_GITHUB_API_URL;
    delete process.env.ENGY_GITHUB_TOKEN;
    await stub.close();
  });

  describe('fetchReplies', () => {
    it('[FR-INBOX-620] should search open pull requests that involve the viewer in one query', async () => {
      await fetchReplies(state, 'me');

      expect(stub.requests).toHaveLength(1);
      const body = JSON.parse(stub.requests[0].body) as { variables: { q: string } };
      expect(body.variables.q).toBe('is:pr is:open involves:@me sort:updated-desc');
    });

    it("[FR-INBOX-620] should return every comment by others on the viewer's pull requests", async () => {
      nodes = [
        rawPr({
          comments: {
            nodes: [
              comment('alice', '2026-03-01T00:00:00Z'),
              comment('me', '2026-03-02T00:00:00Z'),
            ],
          },
          reviewThreads: {
            nodes: [thread('src/a.ts', 12, [comment('bob', '2026-03-03T00:00:00Z', 'nit')])],
          },
        }),
      ];

      const replies = await fetchReplies(state, 'me');

      expect(replies).toEqual([
        expect.objectContaining({
          author: 'bob',
          body: 'nit',
          path: 'src/a.ts',
          line: 12,
          onViewerPr: true,
          repoFullName: 'acme/api',
          prNumber: 1,
          prTitle: 'Fix things',
        }),
        expect.objectContaining({ author: 'alice', path: null, line: null, onViewerPr: true }),
      ]);
    });

    it("[FR-INBOX-620] should return only replies after the viewer's comment on other pull requests", async () => {
      nodes = [
        rawPr({
          author: { login: 'alice' },
          comments: {
            nodes: [
              comment('carol', '2026-03-01T00:00:00Z'),
              comment('ME', '2026-03-02T00:00:00Z'),
              comment('alice', '2026-03-03T00:00:00Z', 'conversation reply'),
            ],
          },
          reviewThreads: {
            nodes: [
              thread('src/a.ts', 5, [
                comment('bob', '2026-03-01T00:00:00Z'),
                comment('me', '2026-03-02T00:00:00Z'),
                comment('bob', '2026-03-04T00:00:00Z', 'thread reply'),
              ]),
              thread('src/b.ts', 9, [comment('bob', '2026-03-05T00:00:00Z', 'not my thread')]),
            ],
          },
        }),
      ];

      const replies = await fetchReplies(state, 'me');

      expect(replies.map((reply) => reply.body)).toEqual(['thread reply', 'conversation reply']);
      expect(replies.every((reply) => !reply.onViewerPr)).toBe(true);
    });

    it('[FR-INBOX-620] should fall back to the original line for an outdated thread and to ghost for a deleted author', async () => {
      nodes = [
        rawPr({
          reviewThreads: {
            nodes: [
              thread('src/a.ts', null, [{ ...comment('x', '2026-03-01T00:00:00Z'), author: null }]),
            ],
          },
        }),
      ];

      const [reply] = await fetchReplies(state, 'me');

      expect(reply).toMatchObject({ author: 'ghost', line: 3 });
    });

    it('[FR-INBOX-620] should skip comments by bots', async () => {
      const bot = {
        ...comment('codecov', '2026-03-02T00:00:00Z'),
        author: { __typename: 'Bot', login: 'codecov' },
      };
      nodes = [rawPr({ comments: { nodes: [bot, comment('alice', '2026-03-01T00:00:00Z')] } })];

      const replies = await fetchReplies(state, 'me');

      expect(replies.map((reply) => reply.author)).toEqual(['alice']);
    });

    it('[FR-INBOX-620] should skip empty search nodes and cap the result', async () => {
      const many = Array.from({ length: MAX_REPLIES + 5 }, (_, index) =>
        comment('alice', new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()),
      );
      nodes = [null, {}, rawPr({ comments: { nodes: many } })];

      const replies = await fetchReplies(state, 'me');

      expect(replies).toHaveLength(MAX_REPLIES);
      expect(replies[0].createdAt > replies[1].createdAt).toBe(true);
    });
  });
});
