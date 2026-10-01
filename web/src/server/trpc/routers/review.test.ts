import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';
import { workspaces } from '../../db/schema';
import { upsertPrs } from './pr';
import { installFakeDaemon, type FakeDaemon } from '../../review/fake-daemon';

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
});
