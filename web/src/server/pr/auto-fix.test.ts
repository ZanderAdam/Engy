import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { workspaces, prs as prsTable, agentSessions, tasks, projects, taskGroups } from '../db/schema';
import { maybeDispatchCiFix } from './auto-fix';
import * as wsServer from '../ws/server';

// Mock dispatchExecutionStart only — buildResumeFlags/buildResumeConfig run for real
// against the test DB so we get integration-level coverage without a live WebSocket.
vi.mock('../ws/server', async (importOriginal) => {
  const actual = await importOriginal<typeof wsServer>();
  return { ...actual, dispatchExecutionStart: vi.fn().mockResolvedValue(undefined) };
});

const dispatchSpy = vi.mocked(wsServer.dispatchExecutionStart);

// ── Fixtures ─────────────────────────────────────────────────────────────

const REPO = '/repo-a';
const BRANCH = 'feat/my-pr';
const PR_NUMBER = 42;
const WORKTREE = '/path/to/worktree';
const SESSION_ID = 'session-abc-123';

interface SeedResult {
  workspaceId: number;
  projectId: number;
  taskId: number;
  taskGroupId: number;
}

function seedWorkspace(
  ctx: TestContext,
  overrides: { autoCiFix?: boolean; maxConcurrency?: number } = {},
): number {
  const ws = ctx.db
    .insert(workspaces)
    .values({
      name: 'WS',
      slug: 'ws',
      repos: [REPO],
      autoCiFix: overrides.autoCiFix ?? true,
      maxConcurrency: overrides.maxConcurrency ?? 2,
    })
    .returning()
    .get();
  return ws.id;
}

function seedProject(ctx: TestContext, workspaceId: number): number {
  const project = ctx.db
    .insert(projects)
    .values({ workspaceId, name: 'Default', slug: 'default', projectDir: REPO })
    .returning()
    .get();
  return project.id;
}

function seedTaskAndGroup(
  ctx: TestContext,
  projectId: number,
): { taskId: number; taskGroupId: number } {
  const group = ctx.db
    .insert(taskGroups)
    .values({ projectId, name: 'TG1' })
    .returning()
    .get();
  const task = ctx.db
    .insert(tasks)
    .values({ projectId, title: 'Task 1', type: 'ai', needsPlan: false })
    .returning()
    .get();
  return { taskId: task.id, taskGroupId: group.id };
}

function seedCorrelatedSession(
  ctx: TestContext,
  taskGroupId: number,
  taskId: number | null,
  opts: { worktreePath?: string | null; status?: string } = {},
): void {
  ctx.db
    .insert(agentSessions)
    .values({
      sessionId: SESSION_ID,
      executionMode: 'group',
      status: (opts.status ?? 'stopped') as 'stopped',
      branch: BRANCH,
      worktreePath: opts.worktreePath !== undefined ? opts.worktreePath : WORKTREE,
      taskGroupId,
      taskId,
    })
    .run();
}

function seedPr(
  ctx: TestContext,
  overrides: { autoFixAttempts?: number; attentionReason?: string } = {},
): typeof prsTable.$inferSelect {
  return ctx.db
    .insert(prsTable)
    .values({
      repo: REPO,
      number: PR_NUMBER,
      title: 'My PR',
      url: 'https://github.com/org/repo/pull/42',
      headBranch: BRANCH,
      headSha: 'sha1',
      author: 'alice',
      isDraft: false,
      state: 'open',
      ciStatus: 'failing',
      checks: [],
      autoFixAttempts: overrides.autoFixAttempts ?? 0,
      attentionReason: overrides.attentionReason ?? null,
    })
    .returning()
    .get();
}

function seedAll(
  ctx: TestContext,
  wsOverrides: { autoCiFix?: boolean; maxConcurrency?: number } = {},
): SeedResult {
  const workspaceId = seedWorkspace(ctx, wsOverrides);
  const projectId = seedProject(ctx, workspaceId);
  const { taskId, taskGroupId } = seedTaskAndGroup(ctx, projectId);
  seedCorrelatedSession(ctx, taskGroupId, taskId);
  return { workspaceId, projectId, taskId, taskGroupId };
}

function getWorkspace(ctx: TestContext, workspaceId: number) {
  return ctx.db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get()!;
}

function getPr(ctx: TestContext) {
  return ctx.db
    .select()
    .from(prsTable)
    .where(and(eq(prsTable.repo, REPO), eq(prsTable.number, PR_NUMBER)))
    .get();
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('maybeDispatchCiFix', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTestDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  describe('bail: non-mechanical classification', () => {
    it('should return non-mechanical reason and persist attentionReason', async () => {
      const { workspaceId } = seedAll(ctx);
      const prRow = seedPr(ctx);
      const workspace = getWorkspace(ctx, workspaceId);

      const result = await maybeDispatchCiFix({
        state: ctx.state,
        db: ctx.db,
        prRow,
        classification: 'non-mechanical',
        logs: [],
        workspace,
      });

      expect(result).toEqual({ dispatched: false, reason: 'non-mechanical' });
      expect(getPr(ctx)?.attentionReason).toBe('non-mechanical');
      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });

  describe('bail: auto-ci-fix disabled', () => {
    it('should return auto-ci-fix-disabled and not modify attentionReason', async () => {
      const { workspaceId } = seedAll(ctx, { autoCiFix: false });
      const prRow = seedPr(ctx, { attentionReason: 'prior-reason' });
      const workspace = getWorkspace(ctx, workspaceId);

      const result = await maybeDispatchCiFix({
        state: ctx.state,
        db: ctx.db,
        prRow,
        classification: 'mechanical',
        logs: [],
        workspace,
      });

      expect(result).toEqual({ dispatched: false, reason: 'auto-ci-fix-disabled' });
      expect(getPr(ctx)?.attentionReason).toBe('prior-reason');
      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });

  describe('bail: no daemon', () => {
    it('should return no-daemon when daemon is null', async () => {
      const { workspaceId } = seedAll(ctx);
      const prRow = seedPr(ctx);
      const workspace = getWorkspace(ctx, workspaceId);
      ctx.state.daemon = null;

      const result = await maybeDispatchCiFix({
        state: ctx.state,
        db: ctx.db,
        prRow,
        classification: 'mechanical',
        logs: [],
        workspace,
      });

      expect(result).toEqual({ dispatched: false, reason: 'no-daemon' });
      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });

  describe('bail: uncorrelated', () => {
    it('should return uncorrelated and persist attentionReason when no matching session', async () => {
      const workspaceId = seedWorkspace(ctx);
      seedProject(ctx, workspaceId);
      // No correlated session seeded
      const prRow = seedPr(ctx);
      const workspace = getWorkspace(ctx, workspaceId);
      ctx.state.daemon = { readyState: 1, OPEN: 1 } as never;

      const result = await maybeDispatchCiFix({
        state: ctx.state,
        db: ctx.db,
        prRow,
        classification: 'mechanical',
        logs: [],
        workspace,
      });

      expect(result).toEqual({ dispatched: false, reason: 'uncorrelated' });
      expect(getPr(ctx)?.attentionReason).toBe('uncorrelated');
      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });

  describe('bail: concurrency full', () => {
    it('should return concurrency-full when active sessions reach maxConcurrency', async () => {
      const { workspaceId, projectId } = seedAll(ctx, { maxConcurrency: 1 });
      const prRow = seedPr(ctx);
      const workspace = getWorkspace(ctx, workspaceId);
      ctx.state.daemon = { readyState: 1, OPEN: 1 } as never;

      // Active session linked via task → project → workspace, counts against concurrency limit
      const { taskId: activeTaskId } = seedTaskAndGroup(ctx, projectId);
      ctx.db
        .insert(agentSessions)
        .values({
          sessionId: 'active-session',
          executionMode: 'task',
          status: 'active',
          worktreePath: '/active/worktree',
          taskId: activeTaskId,
          updatedAt: new Date().toISOString(),
        })
        .run();

      const result = await maybeDispatchCiFix({
        state: ctx.state,
        db: ctx.db,
        prRow,
        classification: 'mechanical',
        logs: [],
        workspace,
      });

      expect(result).toEqual({ dispatched: false, reason: 'concurrency-full' });
      expect(getPr(ctx)?.attentionReason).toBeNull();
      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });

  describe('bail: attempt cap', () => {
    it('should return attempt-cap and persist attentionReason when autoFixAttempts >= 2', async () => {
      const { workspaceId } = seedAll(ctx);
      const prRow = seedPr(ctx, { autoFixAttempts: 2 });
      const workspace = getWorkspace(ctx, workspaceId);
      ctx.state.daemon = { readyState: 1, OPEN: 1 } as never;

      const result = await maybeDispatchCiFix({
        state: ctx.state,
        db: ctx.db,
        prRow,
        classification: 'mechanical',
        logs: [],
        workspace,
      });

      expect(result).toEqual({ dispatched: false, reason: 'attempt-cap' });
      expect(getPr(ctx)?.attentionReason).toBe('attempt-cap');
      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });

  describe('bail: no worktree', () => {
    it('should return no-worktree when the correlated session has no worktreePath', async () => {
      const { workspaceId } = seedAll(ctx);
      ctx.db
        .update(agentSessions)
        .set({ worktreePath: null })
        .where(eq(agentSessions.sessionId, SESSION_ID))
        .run();
      const prRow = seedPr(ctx);
      const workspace = getWorkspace(ctx, workspaceId);
      ctx.state.daemon = { readyState: 1, OPEN: 1 } as never;

      const result = await maybeDispatchCiFix({
        state: ctx.state,
        db: ctx.db,
        prRow,
        classification: 'mechanical',
        logs: [],
        workspace,
      });

      expect(result).toEqual({ dispatched: false, reason: 'no-worktree' });
      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });

  describe('successful dispatch', () => {
    it('should increment autoFixAttempts, reset session, dispatch with --resume, and clear attentionReason', async () => {
      const { workspaceId } = seedAll(ctx);
      const prRow = seedPr(ctx, { autoFixAttempts: 1, attentionReason: 'prior-reason' });
      const workspace = getWorkspace(ctx, workspaceId);
      ctx.state.daemon = { readyState: 1, OPEN: 1 } as never;

      const result = await maybeDispatchCiFix({
        state: ctx.state,
        db: ctx.db,
        prRow,
        classification: 'mechanical',
        logs: [{ checkName: 'lint', excerpt: 'Error: unexpected token' }],
        workspace,
      });

      expect(result).toEqual({ dispatched: true });

      const updatedPr = getPr(ctx);
      expect(updatedPr?.autoFixAttempts).toBe(2);
      expect(updatedPr?.attentionReason).toBeNull();

      const updatedSession = ctx.db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.sessionId, SESSION_ID))
        .get();
      expect(updatedSession?.status).toBe('active');
      expect(updatedSession?.completionSummary).toBeNull();

      expect(dispatchSpy).toHaveBeenCalledOnce();
      const [, calledSessionId, prompt, flags] = dispatchSpy.mock.calls[0]!;
      expect(calledSessionId).toBe(SESSION_ID);
      expect(flags).toContain('--resume');
      expect(flags).toContain(SESSION_ID);
      expect(prompt).toContain('unexpected token');
    });

    it('should dispatch without resume flags when session has no taskId', async () => {
      const workspaceId = seedWorkspace(ctx);
      const projectId = seedProject(ctx, workspaceId);
      const { taskGroupId } = seedTaskAndGroup(ctx, projectId);

      ctx.db
        .insert(agentSessions)
        .values({
          sessionId: SESSION_ID,
          executionMode: 'group',
          status: 'stopped',
          branch: BRANCH,
          worktreePath: WORKTREE,
          taskGroupId,
          taskId: null,
        })
        .run();

      const prRow = seedPr(ctx);
      const workspace = getWorkspace(ctx, workspaceId);
      ctx.state.daemon = { readyState: 1, OPEN: 1 } as never;

      const result = await maybeDispatchCiFix({
        state: ctx.state,
        db: ctx.db,
        prRow,
        classification: 'mechanical',
        logs: [],
        workspace,
      });

      expect(result).toEqual({ dispatched: true });
      const [, , , flags] = dispatchSpy.mock.calls[0]!;
      expect(flags).toEqual(['--resume', SESSION_ID]);
    });
  });

  describe('dispatch failure', () => {
    it('should rollback autoFixAttempts and session status when dispatchExecutionStart throws', async () => {
      const { workspaceId } = seedAll(ctx);
      const prRow = seedPr(ctx, { autoFixAttempts: 0 });
      const workspace = getWorkspace(ctx, workspaceId);
      ctx.state.daemon = { readyState: 1, OPEN: 1 } as never;

      dispatchSpy.mockRejectedValueOnce(new Error('daemon timeout'));

      await expect(
        maybeDispatchCiFix({
          state: ctx.state,
          db: ctx.db,
          prRow,
          classification: 'mechanical',
          logs: [],
          workspace,
        }),
      ).rejects.toThrow('daemon timeout');

      const rollbackPr = getPr(ctx);
      expect(rollbackPr?.autoFixAttempts).toBe(0);

      const rollbackSession = ctx.db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.sessionId, SESSION_ID))
        .get();
      expect(rollbackSession?.status).toBe('stopped');
    });
  });

  describe('attentionReason persistence', () => {
    it('should not modify attentionReason for no-daemon bail', async () => {
      const { workspaceId } = seedAll(ctx);
      const prRow = seedPr(ctx, { attentionReason: 'non-mechanical' });
      const workspace = getWorkspace(ctx, workspaceId);
      ctx.state.daemon = null;

      await maybeDispatchCiFix({
        state: ctx.state,
        db: ctx.db,
        prRow,
        classification: 'mechanical',
        logs: [],
        workspace,
      });

      expect(getPr(ctx)?.attentionReason).toBe('non-mechanical');
    });

    it('should not modify attentionReason for concurrency-full bail', async () => {
      const { workspaceId, projectId } = seedAll(ctx, { maxConcurrency: 1 });
      const prRow = seedPr(ctx, { attentionReason: 'prior' });
      const workspace = getWorkspace(ctx, workspaceId);
      ctx.state.daemon = { readyState: 1, OPEN: 1 } as never;

      const { taskId: activeTaskId } = seedTaskAndGroup(ctx, projectId);
      ctx.db
        .insert(agentSessions)
        .values({
          sessionId: 'active-2',
          executionMode: 'task',
          status: 'active',
          worktreePath: '/active2',
          taskId: activeTaskId,
          updatedAt: new Date().toISOString(),
        })
        .run();

      await maybeDispatchCiFix({
        state: ctx.state,
        db: ctx.db,
        prRow,
        classification: 'mechanical',
        logs: [],
        workspace,
      });

      expect(getPr(ctx)?.attentionReason).toBe('prior');
    });
  });
});
