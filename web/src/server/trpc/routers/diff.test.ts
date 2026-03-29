import { describe, it, expect, afterEach } from 'vitest';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';
import { agentSessions, tasks, projects, workspaces, taskGroups } from '../../db/schema';

describe('diff router', () => {
  let ctx: TestContext;

  afterEach(() => {
    ctx?.cleanup();
  });

  describe('getStatus', () => {
    it('throws when no daemon is connected', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(caller.diff.getStatus({ repoDir: '/tmp/repo' })).rejects.toThrow(
        'No daemon connected',
      );
    });

    it('throws when sessionId not found', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(
        caller.diff.getStatus({ repoDir: '/tmp/repo', sessionId: 'nonexistent' }),
      ).rejects.toThrow('Session "nonexistent" not found');
    });

    it('throws when session has no worktree path', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      ctx.db
        .insert(agentSessions)
        .values({ sessionId: 'sess-no-wt', status: 'active' })
        .run();

      await expect(
        caller.diff.getStatus({ repoDir: '/tmp/repo', sessionId: 'sess-no-wt' }),
      ).rejects.toThrow('Session "sess-no-wt" has no worktree path');
    });
  });

  describe('getLog', () => {
    it('throws when no daemon is connected', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(caller.diff.getLog({ repoDir: '/tmp/repo' })).rejects.toThrow(
        'No daemon connected',
      );
    });
  });

  describe('getCommitDiff', () => {
    it('throws when no daemon is connected', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(
        caller.diff.getCommitDiff({ repoDir: '/tmp/repo', commitHash: 'abc123' }),
      ).rejects.toThrow('No daemon connected');
    });
  });

  describe('getBranchDiff', () => {
    it('throws when no daemon is connected', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(
        caller.diff.getBranchDiff({ repoDir: '/tmp/repo', base: 'origin/main' }),
      ).rejects.toThrow('No daemon connected');
    });
  });

  describe('getSessions', () => {
    it('returns empty list when no sessions exist', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      const result = await caller.diff.getSessions({});
      expect(result).toEqual([]);
    });

    it('returns all sessions with context', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      ctx.db
        .insert(agentSessions)
        .values({
          sessionId: 'sess-1',
          status: 'active',
          worktreePath: '/repo/.worktrees/sess-1',
          branch: 'engy/session-abc',
        })
        .run();

      ctx.db
        .insert(agentSessions)
        .values({
          sessionId: 'sess-2',
          status: 'completed',
          worktreePath: '/repo/.worktrees/sess-2',
        })
        .run();

      const result = await caller.diff.getSessions({});
      expect(result).toHaveLength(2);
      expect(result[0].sessionId).toBe('sess-1');
      expect(result[0].branch).toBe('engy/session-abc');
      expect(result[1].sessionId).toBe('sess-2');
    });

    it('filters sessions by projectId', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      // Create a workspace + project + task
      ctx.db
        .insert(workspaces)
        .values({ id: 1, name: 'WS', slug: 'ws' })
        .run();
      ctx.db
        .insert(projects)
        .values({ id: 1, workspaceId: 1, name: 'P1', slug: 'p1' })
        .run();
      ctx.db
        .insert(tasks)
        .values({ id: 1, projectId: 1, title: 'Task 1' })
        .run();

      // Session linked to the project's task
      ctx.db
        .insert(agentSessions)
        .values({
          sessionId: 'sess-project',
          status: 'active',
          taskId: 1,
          worktreePath: '/repo/.worktrees/sess-project',
        })
        .run();

      // Session not linked to project
      ctx.db
        .insert(agentSessions)
        .values({
          sessionId: 'sess-other',
          status: 'active',
          worktreePath: '/repo/.worktrees/sess-other',
        })
        .run();

      const result = await caller.diff.getSessions({ projectId: 1 });
      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe('sess-project');
      expect(result[0].taskTitle).toBe('Task 1');
    });

    it('includes task group name in context', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      ctx.db
        .insert(taskGroups)
        .values({ id: 1, name: 'Feature Group' })
        .run();

      ctx.db
        .insert(agentSessions)
        .values({
          sessionId: 'sess-group',
          status: 'active',
          taskGroupId: 1,
          worktreePath: '/repo/.worktrees/sess-group',
        })
        .run();

      const result = await caller.diff.getSessions({});
      expect(result).toHaveLength(1);
      expect(result[0].groupName).toBe('Feature Group');
    });
  });
});
