import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';
import { commentThreads, inboxItems, threadComments, workspaces } from '../../db/schema';
import { diffDocPath } from '@/lib/diff-doc-path';
import { upsertItem } from '../../inbox/store';
import { upsertPrs } from './pr';
import { installFakeDaemon, type FakeDaemon } from '../../review/fake-daemon';
import { startStubGithub, type StubGithub } from '../../github/stub-server';

const REPO_PATH = '/repos/app';

describe('review router', () => {
  let ctx: TestContext;
  let daemon: FakeDaemon;
  let caller: ReturnType<typeof appRouter.createCaller>;
  let workspaceId: number;

  beforeEach(() => {
    ctx = setupTestDb();
    daemon = installFakeDaemon(ctx.state);
    caller = appRouter.createCaller({ state: ctx.state });
    ctx.state.repoFullNames.set(REPO_PATH, 'org/app');
    ctx.db
      .insert(workspaces)
      .values({ name: 'WS', slug: 'ws', repos: [REPO_PATH] })
      .run();
    workspaceId = ctx.db.select().from(workspaces).get()!.id;
    daemon.remoteHeads.set(7, 'sha-7a');
    upsertPrs(ctx.db, REPO_PATH, [
      {
        repoFullName: 'org/app',
        number: 7,
        title: 'PR',
        url: 'https://github.com/org/app/pull/7',
        headBranch: 'feat/seven',
        headSha: 'sha-7a',
        baseBranch: 'main',
        author: 'alice',
        isDraft: false,
        reviewDecision: null,
        ciStatus: 'passing',
        checks: [],
        commentCount: 0,
        authoredByViewer: false,
        additions: 0,
        deletions: 0,
        reviewRequests: [],
        updatedAt: '2024-01-01T00:00:00Z',
        hasConflicts: false,
        isCrossRepository: false,
      },
    ]);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should open, list, update and remove a review worktree', async () => {
    const opened = await caller.review.open({
      workspaceId,
      repoFullName: 'org/app',
      prNumber: 7,
    });
    expect(opened).toMatchObject({
      repoPath: REPO_PATH,
      headRefName: 'feat/seven',
      headSha: 'sha-7a',
    });

    const listed = await caller.review.list({ workspaceId });
    expect(listed).toEqual([expect.objectContaining({ id: opened.id, prNumber: 7, kept: null })]);

    daemon.remoteHeads.set(7, 'sha-7b');
    const updated = await caller.review.update({ id: opened.id });
    expect(updated).toMatchObject({ repoPath: REPO_PATH, headSha: 'sha-7b', dirty: false });

    await expect(caller.review.remove({ id: opened.id })).resolves.toEqual({ success: true });
    expect(await caller.review.list({ workspaceId })).toEqual([]);
  });

  it('should reject an unknown workspace', async () => {
    await expect(
      caller.review.open({ workspaceId: 999, repoFullName: 'org/app', prNumber: 7 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  describe('detail', () => {
    let stub: StubGithub;

    beforeEach(async () => {
      stub = await startStubGithub();
      process.env.ENGY_GITHUB_API_URL = stub.url;
      process.env.ENGY_GITHUB_TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    });

    afterEach(async () => {
      delete process.env.ENGY_GITHUB_API_URL;
      delete process.env.ENGY_GITHUB_TOKEN;
      await stub.close();
    });

    it('[FR-PRREVIEW-120] should return the PR detail from GitHub', async () => {
      stub.reply(() => ({
        body: {
          data: {
            repository: {
              pullRequest: {
                title: 'Add feature',
                body: 'Body',
                state: 'OPEN',
                isDraft: true,
                url: 'https://github.com/org/app/pull/7',
                createdAt: '2024-01-01T00:00:00Z',
                author: { login: 'alice', avatarUrl: null },
                baseRefName: 'main',
                headRefName: 'feat/seven',
                headRefOid: 'sha-7a',
                additions: 1,
                deletions: 0,
                changedFiles: 1,
                reviewDecision: null,
                mergeable: 'UNKNOWN',
                reviewRequests: { nodes: [] },
                assignees: { nodes: [] },
                labels: { nodes: [] },
                comments: { nodes: [] },
                reviews: { nodes: [] },
                commits: { nodes: [] },
                lastCommit: { nodes: [] },
              },
            },
          },
        },
      }));

      const detail = await caller.review.detail({
        workspaceId,
        repoFullName: 'org/app',
        prNumber: 7,
      });

      expect(detail).toMatchObject({ title: 'Add feature', isDraft: true, ciStatus: 'unknown' });
    });

    it('[FR-PRREVIEW-120] should map a GitHub failure to a matching tRPC error', async () => {
      stub.reply(() => ({ status: 404, body: { message: 'Not Found' } }));

      await expect(
        caller.review.detail({ workspaceId, repoFullName: 'org/app', prNumber: 7 }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('[FR-PRREVIEW-120] should reject an unknown workspace', async () => {
      await expect(
        caller.review.detail({ workspaceId: 999, repoFullName: 'org/app', prNumber: 7 }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('syncThreads', () => {
    it('[FR-PRREVIEW-130] should require an open review worktree', async () => {
      await expect(
        caller.review.syncThreads({ workspaceId, repoFullName: 'org/app', prNumber: 7 }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('review writes', () => {
    let stub: StubGithub;
    let githubHead: string;
    let importedThreads: unknown[];
    let mutationReply: { body: unknown } | null;
    const docPath = () => diffDocPath(REPO_PATH, 'feat/seven', 'src/a.ts');

    const draftInput = (text: string, line = 12) => ({
      workspaceId,
      repoFullName: 'org/app',
      prNumber: 7,
      filePath: 'src/a.ts',
      lineNumber: line,
      side: 'modified' as const,
      codeLine: 'const a = 1;',
      text,
    });

    const insertThread = (id: string, metadata: Record<string, unknown>, body: string) => {
      ctx.db
        .insert(commentThreads)
        .values({ id, workspaceId: null, documentPath: docPath(), metadata })
        .run();
      ctx.db
        .insert(threadComments)
        .values({ id: `${id}-c`, threadId: id, userId: 'u', body })
        .run();
    };

    const githubThread = (databaseId: number, line: number, body: string) => ({
      id: `PRRT_${databaseId}`,
      isResolved: false,
      isOutdated: false,
      path: 'src/a.ts',
      line,
      originalLine: line,
      diffSide: 'RIGHT',
      startLine: null,
      comments: {
        nodes: [
          {
            id: `PRRC_${databaseId}`,
            databaseId,
            body,
            author: { login: 'me' },
            createdAt: '2024-01-02T00:00:00Z',
            updatedAt: '2024-01-02T00:00:00Z',
            url: `https://github.com/org/app/pull/7#discussion_r${databaseId}`,
            replyTo: null,
          },
        ],
      },
    });

    beforeEach(async () => {
      stub = await startStubGithub();
      githubHead = 'sha-7a';
      importedThreads = [];
      mutationReply = null;
      process.env.ENGY_GITHUB_API_URL = stub.url;
      process.env.ENGY_GITHUB_TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
      stub.reply((req) => {
        if (req.url === '/graphql' && req.body.includes('mutation') && mutationReply) {
          return mutationReply;
        }
        if (req.url === '/graphql') {
          return {
            body: {
              data: {
                repository: {
                  pullRequest: {
                    reviewThreads: {
                      pageInfo: { hasNextPage: false, endCursor: null },
                      nodes: importedThreads,
                    },
                  },
                },
              },
            },
          };
        }
        if (req.method === 'GET') return { body: { head: { sha: githubHead } } };
        return { body: {} };
      });
      await caller.review.open({ workspaceId, repoFullName: 'org/app', prNumber: 7 });
    });

    afterEach(async () => {
      delete process.env.ENGY_GITHUB_API_URL;
      delete process.env.ENGY_GITHUB_TOKEN;
      await stub.close();
    });

    const reviewPosts = () =>
      stub.requests.filter((r) => r.method === 'POST' && r.url.endsWith('/reviews'));

    it('[FR-PRREVIEW-130] should refuse a workspace that does not hold the repo', async () => {
      const otherId = ctx.db
        .insert(workspaces)
        .values({ name: 'Other', slug: 'other', repos: ['/repos/other'] })
        .returning()
        .get().id;

      await expect(
        caller.review.syncThreads({ workspaceId: otherId, repoFullName: 'org/app', prNumber: 7 }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    describe('createDraft', () => {
      it('[FR-PRMON-240] should store a local thread flagged as a GitHub draft', async () => {
        const { threadId } = await caller.review.createDraft(draftInput('Rename this'));

        const thread = ctx.db
          .select()
          .from(commentThreads)
          .all()
          .find((t) => t.id === threadId)!;
        expect(thread.documentPath).toBe(docPath());
        expect(thread.metadata).toMatchObject({
          source: 'local',
          githubDraft: true,
          lineNumber: 12,
          side: 'modified',
        });
        expect(ctx.db.select().from(threadComments).get()?.body).toBe('Rename this');
      });

      it('[FR-PRREVIEW-130] should require an open review worktree', async () => {
        await expect(
          caller.review.createDraft({ ...draftInput('x'), prNumber: 99 }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      });

      it('[FR-PRREVIEW-130] should find the open review worktree by repo name in any case', async () => {
        const { threadId } = await caller.review.createDraft({
          ...draftInput('Rename this'),
          repoFullName: 'ORG/App',
        });

        expect(threadId).toBeTruthy();
      });
    });

    describe('GitHub thread writes', () => {
      const THREAD_ID = 'gh-thread-500';
      let target: { workspaceId: number; repoFullName: string; prNumber: number };
      const graphqlMutations = () =>
        stub.requests.filter((r) => r.url === '/graphql' && r.body.includes('mutation'));

      beforeEach(async () => {
        target = { workspaceId, repoFullName: 'org/app', prNumber: 7 };
        importedThreads = [githubThread(500, 12, 'please rename')];
        await caller.review.syncThreads(target);
      });

      it('[FR-PRMON-270] should post a reply to the thread root and import it', async () => {
        const thread = githubThread(500, 12, 'please rename');
        thread.comments.nodes.push({
          ...thread.comments.nodes[0],
          id: 'PRRC_501',
          databaseId: 501,
          body: 'done',
        });
        importedThreads = [thread];

        await caller.review.reply({ ...target, threadId: THREAD_ID, body: 'done' });

        const post = stub.requests.find((r) => r.url.endsWith('/comments/500/replies'));
        expect(post?.method).toBe('POST');
        expect(JSON.parse(post!.body)).toEqual({ body: 'done' });
        const bodies = ctx.db
          .select()
          .from(threadComments)
          .all()
          .map((c) => c.body);
        expect(bodies).toContain('done');
      });

      it('[FR-PRMON-270] should refuse to reply to a thread that did not come from GitHub', async () => {
        insertThread('note', { type: 'diff', source: 'local', lineNumber: 1 }, 'my note');

        await expect(
          caller.review.reply({ ...target, threadId: 'note', body: 'x' }),
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        expect(stub.requests.some((r) => r.url.includes('/replies'))).toBe(false);
      });

      it('[FR-PRMON-270] should post a top-level comment on the issue', async () => {
        await caller.review.comment({ ...target, body: 'Thanks all' });

        const post = stub.requests.find((r) => r.url === '/repos/org/app/issues/7/comments');
        expect(post?.method).toBe('POST');
        expect(JSON.parse(post!.body)).toEqual({ body: 'Thanks all' });
      });

      it('[FR-PRMON-280] should resolve the thread on GitHub and mirror it locally', async () => {
        importedThreads = [{ ...githubThread(500, 12, 'please rename'), isResolved: true }];
        const result = await caller.review.resolveThread({
          ...target,
          threadId: THREAD_ID,
          resolved: true,
        });

        expect(result).toEqual({ localOnly: false });
        const [mutation] = graphqlMutations();
        expect(JSON.parse(mutation.body)).toMatchObject({
          variables: { threadId: 'PRRT_500' },
        });
        expect(mutation.body).toContain('resolveReviewThread');
        const row = ctx.db
          .select()
          .from(commentThreads)
          .all()
          .find((t) => t.id === THREAD_ID);
        expect(row?.resolved).toBe(true);
      });

      it('[FR-PRMON-280] should unresolve a locally dismissed thread on GitHub and clear the dismissal', async () => {
        mutationReply = null;
        mutationReply = {
          body: { errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible' }] },
        };
        await caller.review.resolveThread({ ...target, threadId: THREAD_ID, resolved: true });
        mutationReply = null;

        await caller.review.resolveThread({ ...target, threadId: THREAD_ID, resolved: false });

        expect(graphqlMutations()[1].body).toContain('unresolveReviewThread');
        const row = ctx.db
          .select()
          .from(commentThreads)
          .all()
          .find((t) => t.id === THREAD_ID);
        expect(row?.resolved).toBe(false);
        expect(row?.metadata?.localDismissed).toBeUndefined();
      });

      it('[FR-PRMON-280] should resolve in Engy only when GitHub answers forbidden', async () => {
        mutationReply = {
          body: { errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible' }] },
        };

        const result = await caller.review.resolveThread({
          ...target,
          threadId: THREAD_ID,
          resolved: true,
        });

        expect(result).toEqual({ localOnly: true });
        const row = ctx.db
          .select()
          .from(commentThreads)
          .all()
          .find((t) => t.id === THREAD_ID);
        expect(row?.resolved).toBe(true);
        expect(row?.metadata?.localDismissed).toBe(true);
      });

      it('[FR-PRMON-290] should not resolve an Engy thread on GitHub', async () => {
        insertThread('finding', { type: 'diff', source: 'agent', lineNumber: 2 }, 'finding');

        await expect(
          caller.review.resolveThread({ ...target, threadId: 'finding', resolved: true }),
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        expect(graphqlMutations()).toHaveLength(0);
      });
    });

    describe('submit', () => {
      const submitInput = (event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES', body = '') => ({
        workspaceId,
        repoFullName: 'org/app',
        prNumber: 7,
        event,
        body,
      });

      it('[FR-PRMON-250] should post the drafts as one review at the PR head sha', async () => {
        await caller.review.createDraft(draftInput('Rename this', 12));
        await caller.review.createDraft(draftInput('And this', 20));

        await caller.review.submit(submitInput('APPROVE', 'Looks good'));

        const posts = reviewPosts();
        expect(posts).toHaveLength(1);
        expect(JSON.parse(posts[0].body)).toEqual({
          commit_id: 'sha-7a',
          event: 'APPROVE',
          body: 'Looks good',
          comments: [
            { path: 'src/a.ts', line: 12, side: 'RIGHT', body: 'Rename this' },
            { path: 'src/a.ts', line: 20, side: 'RIGHT', body: 'And this' },
          ],
        });
      });

      it('[FR-PRMON-290] should send only drafts for a diff key holding all three comment types', async () => {
        insertThread(
          'note',
          { type: 'diff', source: 'local', lineNumber: 1, side: 'modified' },
          'my note',
        );
        insertThread(
          'finding',
          { type: 'diff', source: 'agent', lineNumber: 2, side: 'modified' },
          'finding',
        );
        insertThread(
          'gh-thread-500',
          { type: 'diff', source: 'github', lineNumber: 3, diffSide: 'RIGHT' },
          'from github',
        );
        await caller.review.createDraft(draftInput('draft body', 5));

        await caller.review.submit(submitInput('COMMENT'));

        const [post] = reviewPosts();
        expect(JSON.parse(post.body).comments).toEqual([
          { path: 'src/a.ts', line: 5, side: 'RIGHT', body: 'draft body' },
        ]);
        expect(stub.requests.map((r) => r.body).join('')).not.toMatch(
          /my note|finding|from github/,
        );
      });

      it('[FR-PRMON-250] should block when the PR head moved since the worktree was loaded', async () => {
        await caller.review.createDraft(draftInput('x'));
        githubHead = 'sha-7b';

        await expect(caller.review.submit(submitInput('COMMENT'))).rejects.toMatchObject({
          code: 'PRECONDITION_FAILED',
          message: 'PR changed since you loaded it. Refresh to update.',
        });
        expect(reviewPosts()).toHaveLength(0);
      });

      it('[FR-PRREVIEW-140] should reject an empty review and a bare request for changes', async () => {
        await expect(caller.review.submit(submitInput('COMMENT'))).rejects.toMatchObject({
          code: 'BAD_REQUEST',
        });
        await caller.review.createDraft(draftInput('x'));
        await expect(caller.review.submit(submitInput('REQUEST_CHANGES'))).rejects.toMatchObject({
          code: 'BAD_REQUEST',
        });
        expect(reviewPosts()).toHaveLength(0);
      });

      it('[FR-INBOX-370] should mark the GitHub notification thread done with the item', async () => {
        upsertItem({
          repoFullName: 'org/app',
          prNumber: 7,
          title: 'PR',
          url: 'https://github.com/org/app/pull/7',
          githubThreadId: '4242',
        });
        await caller.review.createDraft(draftInput('x', 12));

        await caller.review.submit(submitInput('COMMENT'));

        await vi.waitFor(() =>
          expect(
            stub.requests.some(
              (r) => r.method === 'DELETE' && r.url === '/notifications/threads/4242',
            ),
          ).toBe(true),
        );
      });

      it('[FR-PRMON-260] should delete a draft once its GitHub copy is imported and mark the item done', async () => {
        upsertItem({
          repoFullName: 'org/app',
          prNumber: 7,
          title: 'PR',
          url: 'https://github.com/org/app/pull/7',
        });
        await caller.review.createDraft(draftInput('imported', 12));
        await caller.review.createDraft(draftInput('not imported', 20));
        importedThreads = [githubThread(500, 12, 'imported')];

        const result = await caller.review.submit(submitInput('COMMENT'));

        expect(result).toEqual({ submitted: 2, remainingDrafts: 1 });
        const left = ctx.db.select().from(commentThreads).all();
        expect(left.filter((t) => t.metadata?.githubDraft === true)).toHaveLength(1);
        expect(left.some((t) => t.id === 'gh-thread-500')).toBe(true);
        expect(ctx.db.select().from(inboxItems).get()?.doneAt).not.toBeNull();
      });
    });
  });
});
