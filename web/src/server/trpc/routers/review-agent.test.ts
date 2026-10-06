import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type WebSocket from 'ws';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';
import { workspaces } from '../../db/schema';
import { upsertPrs } from './pr';
import { makePr } from '../../github/pr-fixtures';
import { installFakeDaemon } from '../../review/fake-daemon';
import { spawnAgentTerminal } from '../../terminal-dispatch';
import { dispatchGitBranchFiles } from '../../ws/server';

vi.mock('../../terminal-dispatch', () => ({ spawnAgentTerminal: vi.fn() }));
vi.mock('../../ws/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ws/server')>()),
  dispatchGitBranchFiles: vi.fn(),
}));

const REPO_PATH = '/repos/app';

describe('review router agent review', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;
  let workspaceId: number;

  beforeEach(() => {
    ctx = setupTestDb();
    const daemon = installFakeDaemon(ctx.state);
    ctx.state.terminalDaemon = { readyState: 1, OPEN: 1, send: vi.fn() } as unknown as WebSocket;
    ctx.state.repoFullNames.set(REPO_PATH, 'org/app');
    caller = appRouter.createCaller({ state: ctx.state });
    ctx.db
      .insert(workspaces)
      .values({ name: 'WS', slug: 'ws', repos: [REPO_PATH] })
      .run();
    workspaceId = ctx.db.select().from(workspaces).get()!.id;
    daemon.remoteHeads.set(7, 'sha-7a');
    upsertPrs(ctx.db, REPO_PATH, [
      makePr({
        repoFullName: 'org/app',
        number: 7,
        title: 'PR',
        url: 'https://github.com/org/app/pull/7',
        headBranch: 'feat/seven',
        headSha: 'sha-7a',
      }),
    ]);
    vi.mocked(dispatchGitBranchFiles).mockResolvedValue({
      files: [],
      mergeBase: 'merge-base-sha',
      head: 'sha-7a',
    });
    vi.mocked(spawnAgentTerminal).mockReturnValue({ sessionId: 'term-1' });
  });

  afterEach(() => {
    vi.clearAllMocks();
    ctx.cleanup();
  });

  it('[FR-PRMON-310] should start a claude session in the review worktree on the PR range', async () => {
    const result = await caller.review.startAgentReview({
      workspaceId,
      repoFullName: 'org/app',
      prNumber: 7,
    });

    expect(result).toEqual({ sessionId: 'term-1' });
    const options = vi.mocked(spawnAgentTerminal).mock.calls[0][1];
    expect(options.agentType).toBe('claude');
    expect(options.prompt).toContain('merge-base-sha');
  });

  it('[FR-PRMON-310] should reject an unknown workspace', async () => {
    await expect(
      caller.review.startAgentReview({ workspaceId: 999, repoFullName: 'org/app', prNumber: 7 }),
    ).rejects.toThrow('Workspace not found');
  });
});
