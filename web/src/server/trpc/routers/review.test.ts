import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';
import { workspaces } from '../../db/schema';
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
    expect(opened).toMatchObject({ headRefName: 'feat/seven', headSha: 'sha-7a' });

    const listed = await caller.review.list({ workspaceId });
    expect(listed).toEqual([expect.objectContaining({ id: opened.id, prNumber: 7, kept: null })]);

    daemon.remoteHeads.set(7, 'sha-7b');
    const updated = await caller.review.update({ id: opened.id });
    expect(updated).toMatchObject({ headSha: 'sha-7b', dirty: false });

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

    it('should return the PR detail from GitHub', async () => {
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

    it('should reject an unknown workspace', async () => {
      await expect(
        caller.review.detail({ workspaceId: 999, repoFullName: 'org/app', prNumber: 7 }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('syncThreads', () => {
    it('should require an open review worktree', async () => {
      await expect(
        caller.review.syncThreads({ workspaceId, repoFullName: 'org/app', prNumber: 7 }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
