import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { prs, reviewWorktrees, workspaces } from '../db/schema';
import { startStubGithub, type StubGithub } from '../github/stub-server';
import type { GithubPr } from '../github/prs';
import { upsertPrs } from '../trpc/routers/pr';
import { installFakeDaemon, type FakeDaemon } from './fake-daemon';
import {
  chooseWorktreesToRemove,
  keptReason,
  listReviewWorktrees,
  openReviewWorktree,
  removeReviewWorktree,
  updateReviewWorktree,
  type ReviewWorktreeRow,
} from './worktrees';

const REPO_PATH = '/repos/app';
const REPO_FULL_NAME = 'org/app';

function makeRow(overrides: Partial<ReviewWorktreeRow>): ReviewWorktreeRow {
  return {
    id: 1,
    repoPath: REPO_PATH,
    repoFullName: REPO_FULL_NAME,
    prNumber: 1,
    worktreePath: '/wt/pr-1',
    headRefName: 'feat/x',
    headSha: 'sha',
    createdByReview: true,
    autoReviewedSha: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function makePr(overrides: Partial<GithubPr>): GithubPr {
  return {
    repoFullName: REPO_FULL_NAME,
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
    ...overrides,
  };
}

describe('[FR-PRREVIEW-070] chooseWorktreesToRemove', () => {
  const never = () => false;

  it.each([
    ['a clean review-created worktree', { id: 2 }, never, never, true],
    ['the current worktree', { id: 5 }, never, never, false],
    ['a reused agent worktree', { id: 2, createdByReview: false }, never, never, false],
    ['a dirty worktree', { id: 2 }, () => true, never, false],
    ['a worktree with a live session', { id: 2 }, never, () => true, false],
  ])('should handle %s', (_name, overrides, isDirty, hasLiveSession, removed) => {
    const rows = [makeRow(overrides)];

    const chosen = chooseWorktreesToRemove(rows, { currentId: 5, isDirty, hasLiveSession });

    expect(chosen).toEqual(removed ? rows : []);
  });
});

describe('[FR-PRREVIEW-100] keptReason', () => {
  it.each([
    [true, true, 'local_changes'],
    [true, false, 'local_changes'],
    [false, true, 'session_open'],
    [false, false, null],
  ])('should map dirty=%s live=%s to %s', (dirty, live, expected) => {
    expect(keptReason(dirty, live)).toBe(expected);
  });
});

describe('review worktrees', () => {
  let ctx: TestContext;
  let daemon: FakeDaemon;
  let workspaceId: number;
  let workspaceDir: string;

  function seedPr(overrides: Partial<GithubPr> = {}): void {
    upsertPrs(ctx.db, REPO_PATH, [
      makePr(overrides),
      makePr({ number: 8, headBranch: 'feat/eight', headSha: 'sha-8a' }),
    ]);
  }

  function rows(): ReviewWorktreeRow[] {
    return ctx.db.select().from(reviewWorktrees).all();
  }

  function open(prNumber: number) {
    return openReviewWorktree(ctx.state, { workspaceId, repoFullName: REPO_FULL_NAME, prNumber });
  }

  beforeEach(() => {
    ctx = setupTestDb();
    daemon = installFakeDaemon(ctx.state);
    ctx.state.repoFullNames.set(REPO_PATH, REPO_FULL_NAME);
    ctx.db
      .insert(workspaces)
      .values({ name: 'WS', slug: 'ws', repos: [REPO_PATH] })
      .run();
    workspaceId = ctx.db.select().from(workspaces).get()!.id;
    workspaceDir = path.join(ctx.tmpDir, 'ws');
    daemon.remoteHeads.set(7, 'sha-7a');
    daemon.remoteHeads.set(8, 'sha-8a');
    daemon.remoteHeads.set(9, 'sha-9a');
    seedPr();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  describe('openReviewWorktree', () => {
    it('[FR-PRREVIEW-010] should fetch the PR head and add a worktree on a review branch', async () => {
      const result = await open(7);

      const worktreePath = path.join(workspaceDir, 'worktrees', '_review', 'app', 'pr-7');
      expect(result).toMatchObject({
        repoPath: REPO_PATH,
        worktreePath,
        headRefName: 'feat/seven',
        headSha: 'sha-7a',
        baseRef: 'main',
        stale: false,
        dirty: false,
      });
      expect(daemon.worktrees.get(worktreePath)?.branch).toBe('engy/review/pr-7');
      expect(rows()).toEqual([
        expect.objectContaining({ prNumber: 7, worktreePath, createdByReview: true }),
      ]);
    });

    it('[FR-PRREVIEW-020] should reuse a worktree already on the PR head branch', async () => {
      daemon.worktrees.set('/agent/wt', { branch: 'feat/seven', dirty: false, head: 'sha-agent' });

      const result = await open(7);

      expect(result).toMatchObject({ worktreePath: '/agent/wt', headSha: 'sha-agent' });
      expect(daemon.calls).not.toContain('GIT_FETCH_REQUEST');
      expect(daemon.calls).not.toContain('WORKTREE_ADD_REQUEST');
      expect(rows()[0]).toMatchObject({ worktreePath: '/agent/wt', createdByReview: false });
    });

    it('[FR-PRREVIEW-030] should read the PR from GitHub when it is not in the prs table', async () => {
      const stub: StubGithub = await startStubGithub();
      process.env.ENGY_GITHUB_API_URL = stub.url;
      process.env.ENGY_GITHUB_TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
      ctx.state.github.status = { available: true, login: 'me' };
      stub.reply(() => ({
        body: { head: { ref: 'feat/eight', sha: 'sha-9a' }, base: { ref: 'dev' } },
      }));
      try {
        const result = await open(9);

        expect(stub.requests[0].url).toBe('/repos/org/app/pulls/9');
        expect(result).toMatchObject({ headRefName: 'feat/eight', baseRef: 'dev' });
      } finally {
        delete process.env.ENGY_GITHUB_API_URL;
        delete process.env.ENGY_GITHUB_TOKEN;
        await stub.close();
      }
    });

    it('should create one worktree when the same PR is opened concurrently', async () => {
      const [first, second] = await Promise.all([open(7), open(7)]);

      expect(second.id).toBe(first.id);
      expect(rows()).toHaveLength(1);
      expect(daemon.calls.filter((call) => call === 'WORKTREE_ADD_REQUEST')).toHaveLength(1);
    });

    it('[FR-PRREVIEW-040] should reject a repo that is not in the workspace', async () => {
      await expect(
        openReviewWorktree(ctx.state, { workspaceId, repoFullName: 'org/other', prNumber: 1 }),
      ).rejects.toThrow('not a repo of this workspace');
    });

    it('[FR-PRREVIEW-050] should remove the worktree again when recording it fails', async () => {
      daemon.failures.add('GIT_STATUS_REQUEST');

      await expect(open(7)).rejects.toThrow('GIT_STATUS_REQUEST failed');

      expect(daemon.worktrees.size).toBe(0);
      expect(daemon.refs.has('refs/engy/pr/7')).toBe(false);
      expect(rows()).toEqual([]);
    });

    it('[FR-PRREVIEW-050] should leave nothing behind when the worktree add fails', async () => {
      daemon.failures.add('WORKTREE_ADD_REQUEST');

      await expect(open(7)).rejects.toThrow('WORKTREE_ADD_REQUEST failed');

      expect(rows()).toEqual([]);
    });
  });

  describe('opening a PR again', () => {
    it('[FR-PRREVIEW-060] should move a clean worktree to the new head', async () => {
      await open(7);
      daemon.remoteHeads.set(7, 'sha-7b');

      const result = await open(7);

      expect(result).toMatchObject({ headSha: 'sha-7b', stale: false, dirty: false });
      expect(rows()).toHaveLength(1);
      expect(rows()[0].headSha).toBe('sha-7b');
    });

    it('[FR-PRREVIEW-060] should keep a dirty worktree and flag the new commits', async () => {
      const { worktreePath } = await open(7);
      daemon.worktrees.get(worktreePath)!.dirty = true;
      daemon.remoteHeads.set(7, 'sha-7b');
      seedPr({ headSha: 'sha-7b' });

      const result = await open(7);

      expect(result).toMatchObject({ headSha: 'sha-7a', dirty: true, stale: true });
      expect(daemon.worktrees.get(worktreePath)!.head).toBe('sha-7a');
    });

    it('[FR-PRREVIEW-020] should only record the head of a reused agent worktree', async () => {
      daemon.worktrees.set('/agent/wt', { branch: 'feat/seven', dirty: false, head: 'sha-agent' });
      await open(7);
      daemon.worktrees.get('/agent/wt')!.head = 'sha-agent-2';

      const result = await open(7);

      expect(result.headSha).toBe('sha-agent-2');
      expect(daemon.calls).not.toContain('GIT_RESET_HARD_REQUEST');
    });
  });

  describe('cleanup on open', () => {
    it('[FR-PRREVIEW-070] should remove the older review worktree with its branch, ref and row', async () => {
      const first = await open(7);

      await open(8);

      expect(daemon.worktrees.has(first.worktreePath)).toBe(false);
      expect(daemon.refs.has('refs/engy/pr/7')).toBe(false);
      expect(daemon.refs.has('refs/heads/engy/review/pr-7')).toBe(false);
      expect(rows().map((row) => row.prNumber)).toEqual([8]);
    });

    it('[FR-PRREVIEW-070] should keep a worktree with local changes', async () => {
      const first = await open(7);
      daemon.worktrees.get(first.worktreePath)!.dirty = true;

      await open(8);

      expect(daemon.worktrees.has(first.worktreePath)).toBe(true);
      expect(rows().map((row) => row.prNumber)).toEqual([7, 8]);
    });

    it('[FR-PRREVIEW-070] should keep a worktree that is the cwd of a live terminal', async () => {
      const first = await open(7);
      ctx.state.terminalSessionMeta.set('t1', {
        scopeType: 'workspace',
        scopeLabel: 'ws',
        cols: 80,
        rows: 24,
        workingDir: path.join(first.worktreePath, 'src'),
      });

      await open(8);

      expect(daemon.worktrees.has(first.worktreePath)).toBe(true);
    });

    it('[FR-PRREVIEW-070] should never remove a reused agent worktree', async () => {
      daemon.worktrees.set('/agent/wt', { branch: 'feat/seven', dirty: false, head: 'sha-agent' });
      await open(7);

      await open(8);

      expect(daemon.worktrees.has('/agent/wt')).toBe(true);
      expect(rows().map((row) => row.prNumber)).toEqual([7, 8]);
    });

    it('[FR-PRREVIEW-070] should log a failed removal and still open the new PR', async () => {
      const first = await open(7);
      daemon.failures.add('WORKTREE_REMOVE_REQUEST');

      const result = await open(8);

      expect(result.headSha).toBe('sha-8a');
      expect(daemon.worktrees.has(first.worktreePath)).toBe(true);
      expect(console.warn).toHaveBeenCalled();
    });

    it('[FR-PRREVIEW-070] should keep a worktree whose status cannot be read', async () => {
      const first = await open(7);
      daemon.worktrees.delete(first.worktreePath);

      await open(8);

      expect(rows().map((row) => row.prNumber)).toEqual([7, 8]);
    });
  });

  describe('updateReviewWorktree', () => {
    it('[FR-PRREVIEW-080] should discard local changes and move to the new head', async () => {
      const { id, worktreePath } = await open(7);
      daemon.worktrees.get(worktreePath)!.dirty = true;
      daemon.remoteHeads.set(7, 'sha-7b');

      const result = await updateReviewWorktree(ctx.state, id, { discard: true });

      expect(result).toMatchObject({ headSha: 'sha-7b', dirty: false });
      expect(daemon.worktrees.get(worktreePath)).toMatchObject({ dirty: false, head: 'sha-7b' });
    });

    it('[FR-PRREVIEW-080] should report a dirty worktree without discard', async () => {
      const { id, worktreePath } = await open(7);
      daemon.worktrees.get(worktreePath)!.dirty = true;

      const result = await updateReviewWorktree(ctx.state, id, { discard: false });

      expect(result.dirty).toBe(true);
      expect(daemon.worktrees.get(worktreePath)!.dirty).toBe(true);
    });

    it('[FR-PRREVIEW-080] should drop the row when the worktree cannot be re-added', async () => {
      const { id } = await open(7);
      daemon.failures.add('WORKTREE_ADD_REQUEST');

      await expect(updateReviewWorktree(ctx.state, id, { discard: true })).rejects.toThrow();

      expect(rows()).toEqual([]);
    });

    it('[FR-PRREVIEW-080] should refuse a reused agent worktree', async () => {
      daemon.worktrees.set('/agent/wt', { branch: 'feat/seven', dirty: false, head: 'sha-agent' });
      const { id } = await open(7);

      await expect(updateReviewWorktree(ctx.state, id, { discard: true })).rejects.toThrow(
        'agent session',
      );
    });
  });

  describe('removeReviewWorktree', () => {
    it('[FR-PRREVIEW-090] should remove the worktree, refs and row', async () => {
      const { id, worktreePath } = await open(7);

      await removeReviewWorktree(ctx.state, id);

      expect(daemon.worktrees.has(worktreePath)).toBe(false);
      expect(daemon.refs.size).toBe(0);
      expect(rows()).toEqual([]);
    });

    it('[FR-PRREVIEW-090] should refuse a dirty worktree unless forced', async () => {
      const { id, worktreePath } = await open(7);
      daemon.worktrees.get(worktreePath)!.dirty = true;

      await expect(removeReviewWorktree(ctx.state, id)).rejects.toThrow('dirty');
      await removeReviewWorktree(ctx.state, id, { force: true });

      expect(rows()).toEqual([]);
    });

    it('[FR-PRREVIEW-090] should clean up when the worktree is already gone', async () => {
      const { id, worktreePath } = await open(7);
      daemon.worktrees.delete(worktreePath);

      await removeReviewWorktree(ctx.state, id);

      expect(rows()).toEqual([]);
    });

    it('[FR-PRREVIEW-090] should refuse a reused agent worktree', async () => {
      daemon.worktrees.set('/agent/wt', { branch: 'feat/seven', dirty: false, head: 'sha-agent' });
      const { id } = await open(7);

      await expect(removeReviewWorktree(ctx.state, id)).rejects.toThrow('agent session');
      expect(rows()).toHaveLength(1);
    });

    it('[FR-PRREVIEW-090] should reject an unknown id', async () => {
      await expect(removeReviewWorktree(ctx.state, 999)).rejects.toThrow('not found');
    });
  });

  describe('listReviewWorktrees', () => {
    it('[FR-PRREVIEW-100] should report why a worktree is kept', async () => {
      const dirty = await open(7);
      daemon.worktrees.get(dirty.worktreePath)!.dirty = true;
      const live = await open(8);
      ctx.state.terminalSessionMeta.set('t1', {
        scopeType: 'workspace',
        scopeLabel: 'ws',
        cols: 80,
        rows: 24,
        workingDir: live.worktreePath,
      });

      const list = await listReviewWorktrees(ctx.state, workspaceId);

      expect(list.map((row) => [row.prNumber, row.kept])).toEqual([
        [7, 'local_changes'],
        [8, 'session_open'],
      ]);
    });

    it('[FR-PRREVIEW-100] should leave agent worktrees and other workspaces out of the kept state', async () => {
      daemon.worktrees.set('/agent/wt', { branch: 'feat/seven', dirty: true, head: 'sha-agent' });
      await open(7);
      ctx.db
        .insert(reviewWorktrees)
        .values({
          repoPath: '/repos/other',
          repoFullName: 'org/other',
          prNumber: 1,
          worktreePath: '/other/wt',
          headRefName: 'x',
          headSha: 'y',
          createdByReview: true,
        })
        .run();

      const list = await listReviewWorktrees(ctx.state, workspaceId);

      expect(list).toHaveLength(1);
      expect(list[0].kept).toBeNull();
    });
  });

  it('should not touch prs rows', async () => {
    await open(7);

    expect(ctx.db.select().from(prs).where(eq(prs.number, 7)).all()).toHaveLength(1);
  });
});
