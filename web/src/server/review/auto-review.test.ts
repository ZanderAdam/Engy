import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type WebSocket from 'ws';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { agentSessions, prs, projects, reviewWorktrees, tasks, workspaces } from '../db/schema';
import { upsertPrs } from '../trpc/routers/pr';
import type { GithubPr } from '../github/prs';
import { spawnAgentTerminal } from '../terminal-dispatch';
import { dispatchGitBranchFiles } from '../ws/server';
import { installFakeDaemon, type FakeDaemon } from './fake-daemon';
import { maybeStartAutoReview, startManualReview } from './auto-review';

vi.mock('../terminal-dispatch', () => ({ spawnAgentTerminal: vi.fn() }));
vi.mock('../ws/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ws/server')>()),
  dispatchGitBranchFiles: vi.fn(),
}));

const REPO_PATH = '/repos/app';
const REPO_FULL_NAME = 'org/app';

function makePr(overrides: Partial<GithubPr> = {}): GithubPr {
  return {
    number: 7,
    title: 'Add thing',
    url: 'https://github.com/org/app/pull/7',
    state: 'OPEN',
    isDraft: false,
    author: 'alice',
    headBranch: 'feat/seven',
    headSha: 'sha-7a',
    baseRefName: 'main',
    checks: [],
    ciStatus: 'passing',
    reviewDecision: null,
    reviewRequests: [],
    additions: 1,
    deletions: 0,
    commentCount: 0,
    repoFullName: REPO_FULL_NAME,
    ...overrides,
  } as GithubPr;
}

const openSocket = { readyState: 1, OPEN: 1, send: vi.fn() } as unknown as WebSocket;

describe('auto review', () => {
  let ctx: TestContext;
  let daemon: FakeDaemon;
  let workspaceId: number;

  function setWorkspace(values: Partial<typeof workspaces.$inferInsert>): void {
    ctx.db.update(workspaces).set(values).where(eq(workspaces.id, workspaceId)).run();
  }

  function start() {
    return maybeStartAutoReview(ctx.state, {
      workspaceId,
      repoFullName: REPO_FULL_NAME,
      prNumber: 7,
    });
  }

  function seedActiveSession(): void {
    const project = ctx.db
      .insert(projects)
      .values({ workspaceId, name: 'P', slug: 'p' })
      .returning()
      .get();
    const task = ctx.db
      .insert(tasks)
      .values({ projectId: project.id, title: 'T', status: 'in_progress' })
      .returning()
      .get();
    ctx.db
      .insert(agentSessions)
      .values({
        sessionId: 'sess-1',
        taskId: task.id,
        status: 'active',
        worktreePath: '/wt/other',
      } as typeof agentSessions.$inferInsert)
      .run();
  }

  beforeEach(() => {
    ctx = setupTestDb();
    daemon = installFakeDaemon(ctx.state);
    ctx.state.terminalDaemon = openSocket;
    ctx.state.repoFullNames.set(REPO_PATH, REPO_FULL_NAME);
    ctx.db
      .insert(workspaces)
      .values({ name: 'WS', slug: 'ws', repos: [REPO_PATH], autoReviewOnRequest: true })
      .run();
    workspaceId = ctx.db.select().from(workspaces).get()!.id;
    daemon.remoteHeads.set(7, 'sha-7a');
    upsertPrs(ctx.db, REPO_PATH, [makePr()]);
    vi.mocked(dispatchGitBranchFiles).mockResolvedValue({
      files: [],
      mergeBase: 'merge-base-sha',
      head: 'sha-7a',
    });
    vi.mocked(spawnAgentTerminal).mockReturnValue({ sessionId: 'term-1' });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  describe('gate order', () => {
    it.each([
      ['setting off', () => setWorkspace({ autoReviewOnRequest: false }), 'setting-off'],
      [
        'setting off and no daemon',
        () => {
          setWorkspace({ autoReviewOnRequest: false });
          ctx.state.daemon = null;
        },
        'setting-off',
      ],
      [
        'no daemon and concurrency full',
        () => {
          ctx.state.daemon = null;
          seedActiveSession();
        },
        'no-daemon',
      ],
      ['no terminal daemon', () => (ctx.state.terminalDaemon = null), 'no-daemon'],
      ['concurrency full', () => seedActiveSession(), 'concurrency-full'],
      [
        'worktree open failing',
        () => ctx.db.delete(prs).where(eq(prs.number, 7)).run(),
        'open-failed',
      ],
    ])(
      '[FR-PRMON-300] should skip with the first failing gate: %s',
      async (_name, arrange, reason) => {
        arrange();
        if (reason === 'open-failed') daemon.failures.add('GIT_FETCH_REQUEST');

        const result = await start();

        expect(result).toEqual({ started: false, reason });
        expect(spawnAgentTerminal).not.toHaveBeenCalled();
      },
    );

    it('[FR-PRMON-300] should not open a worktree while a gate before it fails', async () => {
      setWorkspace({ autoReviewOnRequest: false });

      await start();

      expect(daemon.calls).toEqual([]);
    });
  });

  describe('start', () => {
    it('[FR-PRMON-300] should spawn a claude session in the review worktree on the PR range', async () => {
      const result = await start();

      expect(result).toEqual({ started: true, sessionId: 'term-1' });
      const options = vi.mocked(spawnAgentTerminal).mock.calls[0][1];
      const worktreePath = ctx.db.select().from(reviewWorktrees).get()!.worktreePath;
      expect(options.agentType).toBe('claude');
      expect(options.workingDir).toBe(worktreePath);
      expect(options.prompt).toContain('/engy:review-diff');
      expect(options.prompt).toContain('merge-base-sha');
      expect(options.prompt).toContain(`worktreePath: ${worktreePath}`);
      expect(options.prompt).not.toContain('reviewGuide:');
      expect(path.isAbsolute(options.workingDir)).toBe(true);
    });

    it('[FR-PRMON-300] should diff against the origin base branch of the PR', async () => {
      await start();

      expect(dispatchGitBranchFiles).toHaveBeenCalledWith(
        expect.any(String),
        'origin/main',
        ctx.state,
      );
    });

    it('[FR-PRMON-300] should tell the agent never to use GitHub', async () => {
      await start();

      const prompt = vi.mocked(spawnAgentTerminal).mock.calls[0][1].prompt;
      expect(prompt).toContain('Never use `gh` or the GitHub API');
    });
  });

  describe('once per head SHA', () => {
    it('[FR-PRMON-300] should record the reviewed SHA and skip the same SHA next time', async () => {
      await start();
      const second = await start();

      expect(ctx.state.autoReviewedShas.get('org/app#7')).toBe('sha-7a');
      expect(second).toEqual({ started: false, reason: 'already-reviewed' });
      expect(spawnAgentTerminal).toHaveBeenCalledTimes(1);
    });

    it('[FR-PRMON-300] should review again after the head SHA changes', async () => {
      await start();
      daemon.remoteHeads.set(7, 'sha-7b');
      upsertPrs(ctx.db, REPO_PATH, [makePr({ headSha: 'sha-7b' })]);

      const result = await start();

      expect(result).toEqual({ started: true, sessionId: 'term-1' });
      expect(spawnAgentTerminal).toHaveBeenCalledTimes(2);
    });

    it('[FR-PRMON-300] should start only one review for two concurrent requests', async () => {
      const results = await Promise.all([start(), start()]);

      expect(results.filter((result) => result.started)).toHaveLength(1);
      expect(spawnAgentTerminal).toHaveBeenCalledTimes(1);
    });

    it('[FR-PRMON-300] should allow a retry when the session cannot start', async () => {
      vi.mocked(dispatchGitBranchFiles).mockRejectedValueOnce(new Error('no base'));

      const failed = await start();
      const retried = await start();

      expect(failed).toEqual({ started: false, reason: 'open-failed' });
      expect(retried).toEqual({ started: true, sessionId: 'term-1' });
    });
  });

  describe('manual start', () => {
    function startManual(projectSlug?: string) {
      return startManualReview(ctx.state, {
        workspaceId,
        repoFullName: REPO_FULL_NAME,
        prNumber: 7,
        projectSlug,
      });
    }

    function seedProjectGuide(): string {
      ctx.db.insert(projects).values({ workspaceId, name: 'G', slug: 'guided' }).run();
      const dir = path.join(process.env.ENGY_DIR!, 'ws', 'projects', 'guided');
      fs.mkdirSync(dir, { recursive: true });
      const guidePath = path.join(dir, 'review-guide.md');
      fs.writeFileSync(guidePath, '# guide');
      return guidePath;
    }

    it('[FR-PRMON-310] should start even when auto review is off and the SHA was reviewed', async () => {
      setWorkspace({ autoReviewOnRequest: false });
      await startManual();

      const result = await startManual();

      expect(result).toEqual({ sessionId: 'term-1' });
      expect(spawnAgentTerminal).toHaveBeenCalledTimes(2);
      expect(ctx.state.autoReviewedShas.size).toBe(0);
    });

    it('[FR-PRMON-310] should pass the guide of the chosen project', async () => {
      const guidePath = seedProjectGuide();

      await startManual('guided');

      const prompt = vi.mocked(spawnAgentTerminal).mock.calls[0][1].prompt;
      expect(prompt).toContain(`reviewGuide: ${guidePath}`);
      expect(prompt).toContain('merge-base-sha');
    });

    it('[FR-PRMON-310] should use the default guide when the project has none', async () => {
      ctx.db.insert(projects).values({ workspaceId, name: 'G', slug: 'plain' }).run();

      await startManual('plain');

      expect(vi.mocked(spawnAgentTerminal).mock.calls[0][1].prompt).not.toContain('reviewGuide:');
    });

    it.each([
      ['no daemon', () => (ctx.state.daemon = null), 'daemon is not connected'],
      ['no terminal daemon', () => (ctx.state.terminalDaemon = null), 'daemon is not connected'],
      ['concurrency full', () => seedActiveSession(), 'Too many agent sessions'],
    ])('[FR-PRMON-310] should refuse with a clear message: %s', async (_name, arrange, message) => {
      arrange();

      await expect(startManual()).rejects.toThrow(message);
      expect(spawnAgentTerminal).not.toHaveBeenCalled();
    });

    it('[FR-PRMON-310] should report a failed start', async () => {
      vi.mocked(dispatchGitBranchFiles).mockRejectedValueOnce(new Error('no base'));

      await expect(startManual()).rejects.toThrow('Could not start the review: no base');
    });
  });
});
