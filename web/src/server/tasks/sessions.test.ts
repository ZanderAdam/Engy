import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { agentSessions, projects, taskSessions, tasks, workspaces } from '../db/schema';
import { appRouter } from '../trpc/root';
import { recordSessionStart, markSessionClosed } from '../ws/terminal-session-history';
import type { TerminalSessionMeta } from '../trpc/context';
import {
  linkSpawnedTerminal,
  linkTaskSessions,
  listSessionTaskIds,
  listTaskSessions,
} from './sessions';

function agentMeta(overrides: Partial<TerminalSessionMeta> = {}): TerminalSessionMeta {
  return {
    scopeType: 'project',
    scopeLabel: 'impl: task',
    workingDir: '/repo',
    agentType: 'claude',
    workspaceSlug: 'ws',
    projectSlug: 'proj',
    groupKey: 'ws:proj',
    cols: 80,
    rows: 24,
    ...overrides,
  };
}

describe('task sessions', () => {
  let ctx: TestContext;
  let taskA: number;
  let taskB: number;

  beforeEach(() => {
    ctx = setupTestDb();
    const ws = ctx.db.insert(workspaces).values({ name: 'ws', slug: 'ws' }).returning().get();
    const project = ctx.db
      .insert(projects)
      .values({ workspaceId: ws.id, name: 'proj', slug: 'proj' })
      .returning()
      .get();
    taskA = ctx.db.insert(tasks).values({ title: 'A', projectId: project.id }).returning().get().id;
    taskB = ctx.db.insert(tasks).values({ title: 'B', projectId: project.id }).returning().get().id;
    return () => ctx.cleanup();
  });

  function spawnLive(sessionId: string, meta: TerminalSessionMeta, extraTaskIds: number[] = []) {
    ctx.state.terminalSessionMeta.set(sessionId, meta);
    recordSessionStart(sessionId, meta);
    linkSpawnedTerminal(sessionId, meta, extraTaskIds);
  }

  describe('linkSpawnedTerminal', () => {
    it('[FR-TERMINAL-1120] should link the spawn task and every extra task to the session', () => {
      spawnLive('t1', agentMeta({ taskId: taskA }), [taskB]);

      expect(listSessionTaskIds('t1').sort()).toEqual([taskA, taskB].sort());
    });

    it('[FR-TERMINAL-1120] should key a resumed terminal by its conversation id', () => {
      spawnLive('t2', agentMeta({ taskId: taskA, resumedFrom: 'conv-1' }));

      expect(listSessionTaskIds('conv-1')).toEqual([taskA]);
      expect(listSessionTaskIds('t2')).toEqual([]);
    });

    it('[FR-TERMINAL-1120] should not link a terminal opened without a task', () => {
      spawnLive('t3', agentMeta());

      expect(ctx.db.select().from(taskSessions).all()).toHaveLength(0);
    });
  });

  describe('linkTaskSessions', () => {
    it('[FR-TERMINAL-1130] should still link the existing tasks when one task id is gone', () => {
      linkTaskSessions([taskA, 99999], { sessionKey: 's', kind: 'terminal', source: 'spawn' });

      expect(listSessionTaskIds('s')).toEqual([taskA]);
    });

    it('[FR-TERMINAL-1130] should keep one link per task and session and refresh its last-seen time', () => {
      linkTaskSessions([taskA], { sessionKey: 's', kind: 'terminal', source: 'spawn' });
      const first = ctx.db.select().from(taskSessions).get()!;

      linkTaskSessions([taskA], { sessionKey: 's', kind: 'terminal', source: 'mcp' });
      const rows = ctx.db.select().from(taskSessions).all();

      expect(rows).toHaveLength(1);
      expect(rows[0].source).toBe('spawn');
      expect(rows[0].lastSeenAt >= first.lastSeenAt).toBe(true);
    });

    it('[FR-TERMINAL-1130] should order a session tasks by most recent link', () => {
      linkTaskSessions([taskA], { sessionKey: 's', kind: 'terminal', source: 'spawn' });
      ctx.db.update(taskSessions).set({ lastSeenAt: '2000-01-01T00:00:00.000Z' }).run();
      linkTaskSessions([taskB], { sessionKey: 's', kind: 'terminal', source: 'mcp' });

      expect(listSessionTaskIds('s')).toEqual([taskB, taskA]);
    });
  });

  describe('listTaskSessions', () => {
    it('[FR-TASK-330] should list live, parked and ended terminals of the task', () => {
      spawnLive('live', agentMeta({ taskId: taskA }));
      spawnLive('parked', agentMeta({ taskId: taskA, dormant: true }));
      spawnLive('ended', agentMeta({ taskId: taskA }));
      ctx.state.terminalSessionMeta.delete('ended');
      markSessionClosed('ended');

      const states = Object.fromEntries(
        listTaskSessions(ctx.state, taskA).map((s) => [s.key, s.kind === 'terminal' && s.state]),
      );

      expect(states).toEqual({ live: 'live', parked: 'parked', ended: 'ended' });
    });

    it('[FR-TASK-330] should include sessions from another worktree of the project', () => {
      spawnLive(
        'wt',
        agentMeta({ taskId: taskA, groupKey: 'ws:proj:feature', worktreeBranch: 'feature' }),
      );

      const [session] = listTaskSessions(ctx.state, taskA);

      expect(session).toMatchObject({ key: 'wt', worktreeBranch: 'feature' });
    });

    it('[FR-TASK-330] should list a session linked by a later task update', () => {
      spawnLive('t', agentMeta({ taskId: taskA }));
      linkTaskSessions([taskB], { sessionKey: 't', kind: 'terminal', source: 'mcp' });

      expect(listTaskSessions(ctx.state, taskB).map((s) => s.key)).toEqual(['t']);
    });

    it('[FR-TASK-330] should list every background execution of the task', () => {
      ctx.db
        .insert(agentSessions)
        .values([
          { sessionId: 'e1', taskId: taskA, status: 'completed', executionMode: 'task' },
          { sessionId: 'e2', taskId: taskA, status: 'stopped', executionMode: 'planning' },
          { sessionId: 'e3', status: 'active', executionMode: 'group' },
        ])
        .run();
      linkTaskSessions([taskA], { sessionKey: 'e3', kind: 'execution', source: 'spawn' });

      const keys = listTaskSessions(ctx.state, taskA)
        .filter((s) => s.kind === 'execution')
        .map((s) => s.key)
        .sort();

      expect(keys).toEqual(['e1', 'e2', 'e3']);
    });

    it('[FR-TASK-330] should return sessions newest first', () => {
      linkTaskSessions([taskA], { sessionKey: 'old', kind: 'terminal', source: 'spawn' });
      recordSessionStart('old', agentMeta());
      markSessionClosed('old');
      ctx.db.update(taskSessions).set({ lastSeenAt: '2000-01-01T00:00:00.000Z' }).run();
      spawnLive('new', agentMeta({ taskId: taskA }));

      expect(listTaskSessions(ctx.state, taskA)[0].key).toBe('new');
    });

    it('[FR-TASK-330] should be served by the task.listSessions procedure', async () => {
      spawnLive('t', agentMeta({ taskId: taskA }));
      const caller = appRouter.createCaller({ state: ctx.state });

      const sessions = await caller.task.listSessions({ id: taskA });

      expect(sessions.map((s) => s.key)).toEqual(['t']);
    });
  });

  describe('terminal.linkedTasks', () => {
    it('[FR-TERMINAL-1150] should return the tasks of a resumed terminal through its conversation id', async () => {
      linkTaskSessions([taskA, taskB], { sessionKey: 'conv', kind: 'terminal', source: 'mcp' });
      ctx.state.terminalSessionMeta.set('t-new', agentMeta({ resumedFrom: 'conv' }));
      const caller = appRouter.createCaller({ state: ctx.state });

      const linked = await caller.terminal.linkedTasks({ sessionId: 't-new' });

      expect([...linked].sort()).toEqual([taskA, taskB].sort());
    });
  });
});
