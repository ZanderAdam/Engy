import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';
import { getDb } from '../../db/client';
import { agentSessions, tasks, workspaces } from '../../db/schema';
import { eq } from 'drizzle-orm';

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return {
    ...actual,
    default: {
      ...actual,
      homedir: () => process.env.__TEST_HOME_DIR__ || actual.homedir(),
    },
    homedir: () => process.env.__TEST_HOME_DIR__ || actual.homedir(),
  };
});

function createMockDaemon(ctx: TestContext) {
  const sent: string[] = [];
  const mock = {
    readyState: WebSocket.OPEN,
    OPEN: WebSocket.OPEN,
    send: (data: string) => {
      sent.push(data);
      const msg = JSON.parse(data);
      if (msg.type === 'EXECUTION_START_REQUEST') {
        const pending = ctx.state.pendingExecutionStart.get(msg.payload.requestId);
        if (pending) {
          ctx.state.pendingExecutionStart.delete(msg.payload.requestId);
          pending.resolve({ sessionId: 'daemon-session-id' });
        }
      }
      if (msg.type === 'EXECUTION_STOP_REQUEST') {
        const pending = ctx.state.pendingExecutionStop.get(msg.payload.requestId);
        if (pending) {
          ctx.state.pendingExecutionStop.delete(msg.payload.requestId);
          pending.resolve({ success: true });
        }
      }
    },
  };
  ctx.state.daemon = mock as unknown as WebSocket;
  return { sent };
}

function createFailingDaemon(ctx: TestContext, errorMessage: string) {
  const mock = {
    readyState: WebSocket.OPEN,
    OPEN: WebSocket.OPEN,
    send: (data: string) => {
      const msg = JSON.parse(data);
      if (msg.type === 'EXECUTION_START_REQUEST') {
        const pending = ctx.state.pendingExecutionStart.get(msg.payload.requestId);
        if (pending) {
          ctx.state.pendingExecutionStart.delete(msg.payload.requestId);
          pending.reject(new Error(errorMessage));
        }
      }
    },
  };
  ctx.state.daemon = mock as unknown as WebSocket;
}

async function seedProject(caller: ReturnType<typeof appRouter.createCaller>) {
  const ws = await caller.workspace.create({ name: 'Exec WS' });
  const proj = await caller.project.create({ workspaceSlug: ws.slug, name: 'Exec Project' });
  return { ws, proj };
}

describe('execution router', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('startExecution', () => {
    it('should create an agentSessions record with status active and executionMode task', async () => {
      const { proj } = await seedProject(caller);
      const task = await caller.task.create({ projectId: proj.id, title: 'Test task' });
      createMockDaemon(ctx);

      const result = await caller.execution.startExecution({ scope: 'task', id: task.id });

      expect(result.sessionId).toBeDefined();
      expect(typeof result.sessionId).toBe('string');

      const db = getDb();
      const session = db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.sessionId, result.sessionId))
        .get();

      expect(session).toBeDefined();
      expect(session!.status).toBe('active');
      expect(session!.executionMode).toBe('task');
      expect(session!.taskId).toBe(task.id);
    });

    it('should dispatch EXECUTION_START_REQUEST to daemon with built prompt', async () => {
      const { proj } = await seedProject(caller);
      const task = await caller.task.create({ projectId: proj.id, title: 'Build feature' });
      const { sent } = createMockDaemon(ctx);

      await caller.execution.startExecution({ scope: 'task', id: task.id });

      expect(sent.length).toBe(1);
      const msg = JSON.parse(sent[0]);
      expect(msg.type).toBe('EXECUTION_START_REQUEST');
      expect(msg.payload.prompt).toContain('/engy:implement');
      expect(msg.payload.flags).toContain('--append-system-prompt');
      const flagIndex = (msg.payload.flags as string[]).indexOf('--append-system-prompt');
      expect((msg.payload.flags as string[])[flagIndex + 1]).toContain('Workspace: exec-ws');
    });

    it('should clean up session and task on dispatch failure', async () => {
      const { proj } = await seedProject(caller);
      const task = await caller.task.create({ projectId: proj.id, title: 'Failing task' });
      createFailingDaemon(ctx, 'Command failed: coder ssh');

      await expect(
        caller.execution.startExecution({ scope: 'task', id: task.id }),
      ).rejects.toThrow('Failed to start execution: Command failed: coder ssh');

      const db = getDb();

      // Session should be marked stopped with error in completionSummary
      const sessions = db.select().from(agentSessions).all();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].status).toBe('stopped');
      expect(sessions[0].completionSummary).toBe('Command failed: coder ssh');

      // Task should have subStatus 'failed' and status reverted to 'todo'
      const updatedTask = db.select().from(tasks).where(eq(tasks.id, task.id)).get();
      expect(updatedTask!.status).toBe('todo');
      expect(updatedTask!.subStatus).toBe('failed');
    });

    it('should include repo paths in system prompt when workspace has repos', async () => {
      const { ws, proj } = await seedProject(caller);
      getDb()
        .update(workspaces)
        .set({ repos: ['/Users/me/repo1', '/Users/me/repo2'] })
        .where(eq(workspaces.id, ws.id))
        .run();
      const task = await caller.task.create({ projectId: proj.id, title: 'Repos task' });
      const { sent } = createMockDaemon(ctx);

      await caller.execution.startExecution({ scope: 'task', id: task.id });

      const msg = JSON.parse(sent[0]);
      const flagIndex = (msg.payload.flags as string[]).indexOf('--append-system-prompt');
      const systemPrompt = (msg.payload.flags as string[])[flagIndex + 1];
      expect(systemPrompt).toContain('Repos: /Users/me/repo1, /Users/me/repo2');
    });

    it('should throw when task not found', async () => {
      createMockDaemon(ctx);

      await expect(
        caller.execution.startExecution({ scope: 'task', id: 9999 }),
      ).rejects.toThrow('Task 9999 not found');
    });

    it('should throw when no daemon is connected for task scope', async () => {
      const { proj } = await seedProject(caller);
      const task = await caller.task.create({ projectId: proj.id, title: 'Test task' });

      await expect(
        caller.execution.startExecution({ scope: 'task', id: task.id }),
      ).rejects.toThrow('No daemon connected');
    });

    it('should support milestone scope and link session to first task', async () => {
      const { proj } = await seedProject(caller);
      const firstTask = await caller.task.create({
        projectId: proj.id,
        title: 'First milestone task',
        milestoneRef: 'm1',
      });
      await caller.task.create({
        projectId: proj.id,
        title: 'Second milestone task',
        milestoneRef: 'm1',
      });
      const { sent } = createMockDaemon(ctx);

      const result = await caller.execution.startExecution({ scope: 'milestone', id: 'm1' });

      expect(result.sessionId).toBeDefined();
      const msg = JSON.parse(sent[0]);
      expect(msg.payload.prompt).toContain('implement-milestone');
      expect(msg.payload.prompt).toContain('m1');

      const db = getDb();
      const session = db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.sessionId, result.sessionId))
        .get();
      expect(session!.executionMode).toBe('milestone');
      expect(session!.taskId).toBe(firstTask.id);
    });

    it('should support taskGroup scope', async () => {
      const { proj } = await seedProject(caller);
      const group = await caller.taskGroup.create({
        milestoneRef: 'm1',
        name: 'Frontend Tasks',
      });
      await caller.task.create({
        projectId: proj.id,
        title: 'Group task',
        taskGroupId: group.id,
      });
      createMockDaemon(ctx);

      const result = await caller.execution.startExecution({
        scope: 'taskGroup',
        id: group.id,
      });

      expect(result.sessionId).toBeDefined();

      const db = getDb();
      const session = db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.sessionId, result.sessionId))
        .get();
      expect(session!.executionMode).toBe('group');
      expect(session!.taskGroupId).toBe(group.id);
    });
  });

  describe('stopExecution', () => {
    it('should dispatch EXECUTION_STOP_REQUEST and update session status to stopped', async () => {
      const { proj } = await seedProject(caller);
      const task = await caller.task.create({ projectId: proj.id, title: 'Running task' });
      createMockDaemon(ctx);

      const { sessionId } = await caller.execution.startExecution({
        scope: 'task',
        id: task.id,
      });

      const result = await caller.execution.stopExecution({ sessionId });

      expect(result.success).toBe(true);

      const db = getDb();
      const session = db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.sessionId, sessionId))
        .get();
      expect(session!.status).toBe('stopped');
    });

    it('should throw when session not found', async () => {
      createMockDaemon(ctx);

      await expect(
        caller.execution.stopExecution({ sessionId: 'nonexistent' }),
      ).rejects.toThrow('Session not found');
    });
  });

  describe('retryExecution', () => {
    it('should create a new session linked to original worktree with --resume flag', async () => {
      const { proj } = await seedProject(caller);
      const task = await caller.task.create({ projectId: proj.id, title: 'Failed task' });
      createMockDaemon(ctx);

      const original = await caller.execution.startExecution({
        scope: 'task',
        id: task.id,
      });

      // Stop the original
      await caller.execution.stopExecution({ sessionId: original.sessionId });

      const { sent } = createMockDaemon(ctx);
      const retry = await caller.execution.retryExecution({
        sessionId: original.sessionId,
      });

      expect(retry.sessionId).toBeDefined();
      expect(retry.sessionId).not.toBe(original.sessionId);

      const db = getDb();
      const newSession = db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.sessionId, retry.sessionId))
        .get();
      expect(newSession).toBeDefined();
      expect(newSession!.status).toBe('active');
      expect(newSession!.taskId).toBe(task.id);

      // Original session worktree is preserved on the new session
      const originalSession = db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.sessionId, original.sessionId))
        .get();
      expect(newSession!.worktreePath).toBe(originalSession!.worktreePath);

      // Verify the dispatch included --resume flag
      const msg = JSON.parse(sent[0]);
      expect(msg.type).toBe('EXECUTION_START_REQUEST');
      expect(msg.payload.flags).toEqual(['--resume', original.sessionId]);
    });

    it('should clean up new session on dispatch failure', async () => {
      const { proj } = await seedProject(caller);
      const task = await caller.task.create({ projectId: proj.id, title: 'Retry fail task' });
      createMockDaemon(ctx);

      const original = await caller.execution.startExecution({ scope: 'task', id: task.id });
      await caller.execution.stopExecution({ sessionId: original.sessionId });

      createFailingDaemon(ctx, 'Daemon crashed');

      await expect(
        caller.execution.retryExecution({ sessionId: original.sessionId }),
      ).rejects.toThrow('Failed to retry execution: Daemon crashed');

      const db = getDb();
      const sessions = db.select().from(agentSessions).all();
      const newSession = sessions.find((s) => s.sessionId !== original.sessionId);
      expect(newSession).toBeDefined();
      expect(newSession!.status).toBe('stopped');
      expect(newSession!.completionSummary).toBe('Daemon crashed');

      // Task should have subStatus 'failed'
      const updatedTask = db.select().from(tasks).where(eq(tasks.id, task.id)).get();
      expect(updatedTask!.subStatus).toBe('failed');
    });

    it('should throw when session not found', async () => {
      createMockDaemon(ctx);

      await expect(
        caller.execution.retryExecution({ sessionId: 'abc-123' }),
      ).rejects.toThrow('Session not found');
    });
  });

  describe('getSessionStatus', () => {
    it('should include completionSummary for failed sessions', async () => {
      const { proj } = await seedProject(caller);
      const task = await caller.task.create({ projectId: proj.id, title: 'Status task' });
      createFailingDaemon(ctx, 'Worktree creation failed');

      await expect(
        caller.execution.startExecution({ scope: 'task', id: task.id }),
      ).rejects.toThrow();

      const result = await caller.execution.getSessionStatus({ scope: 'task', id: task.id });
      expect(result.status).toBe('stopped');
      expect(result.completionSummary).toBe('Worktree creation failed');
    });

    it('should return session for milestone scope', async () => {
      const { proj } = await seedProject(caller);
      await caller.task.create({
        projectId: proj.id,
        title: 'MS task',
        milestoneRef: 'm2',
      });
      createMockDaemon(ctx);

      const { sessionId } = await caller.execution.startExecution({
        scope: 'milestone',
        id: 'm2',
      });

      const result = await caller.execution.getSessionStatus({ scope: 'milestone', id: 'm2' });
      expect(result.status).toBe('active');
      expect(result.sessionId).toBe(sessionId);
      expect(result.completionSummary).toBeNull();
    });

    it('should return null completionSummary when no session exists', async () => {
      const result = await caller.execution.getSessionStatus({ scope: 'task', id: 9999 });
      expect(result.status).toBeNull();
      expect(result.sessionId).toBeNull();
      expect(result.completionSummary).toBeNull();
    });
  });

  describe('getSessionFile', () => {
    it('should return parsed JSONL entries from session file', async () => {
      const { proj } = await seedProject(caller);
      const task = await caller.task.create({ projectId: proj.id, title: 'Logged task' });
      createMockDaemon(ctx);

      // Point homedir mock to the test temp dir
      process.env.__TEST_HOME_DIR__ = ctx.tmpDir;

      const { sessionId } = await caller.execution.startExecution({
        scope: 'task',
        id: task.id,
      });

      const db = getDb();
      const session = db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.sessionId, sessionId))
        .get();

      expect(session?.worktreePath).toBeDefined();
      const encoded = session!.worktreePath!.replace(/\//g, '-');
      const sessionDir = path.join(ctx.tmpDir, '.claude', 'projects', encoded);
      fs.mkdirSync(sessionDir, { recursive: true });
      const sessionFile = path.join(sessionDir, `${sessionId}.jsonl`);
      const lines = [
        JSON.stringify({ type: 'message', content: 'hello' }),
        JSON.stringify({ type: 'tool_use', name: 'write' }),
      ];
      fs.writeFileSync(sessionFile, lines.join('\n') + '\n');

      const result = await caller.execution.getSessionFile({ sessionId });

      expect(result.entries).toHaveLength(2);
      expect(result.entries[0]).toEqual({ type: 'message', content: 'hello' });
      expect(result.entries[1]).toEqual({ type: 'tool_use', name: 'write' });

      delete process.env.__TEST_HOME_DIR__;
    });

    it('should return empty entries when session file does not exist', async () => {
      const { proj } = await seedProject(caller);
      const task = await caller.task.create({ projectId: proj.id, title: 'No file task' });
      createMockDaemon(ctx);

      const { sessionId } = await caller.execution.startExecution({
        scope: 'task',
        id: task.id,
      });

      const result = await caller.execution.getSessionFile({ sessionId });
      expect(result.entries).toEqual([]);
    });

    it('should return empty entries when session not found', async () => {
      const result = await caller.execution.getSessionFile({ sessionId: 'nonexistent' });
      expect(result.entries).toEqual([]);
    });
  });

  describe('getActiveSessions', () => {
    it('should return sessions filtered by projectId', async () => {
      const { proj } = await seedProject(caller);
      const task = await caller.task.create({ projectId: proj.id, title: 'Session task' });
      createMockDaemon(ctx);

      await caller.execution.startExecution({ scope: 'task', id: task.id });

      const sessions = await caller.execution.getActiveSessions({ projectId: proj.id });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].taskId).toBe(task.id);
    });

    it('should return all sessions when no projectId given', async () => {
      const { proj } = await seedProject(caller);
      const task1 = await caller.task.create({ projectId: proj.id, title: 'Task 1' });
      const task2 = await caller.task.create({ projectId: proj.id, title: 'Task 2' });
      createMockDaemon(ctx);

      await caller.execution.startExecution({ scope: 'task', id: task1.id });
      await caller.execution.startExecution({ scope: 'task', id: task2.id });

      const sessions = await caller.execution.getActiveSessions({});
      expect(sessions).toHaveLength(2);
    });

    it('should not return sessions from other projects', async () => {
      const { proj } = await seedProject(caller);
      const ws2 = await caller.workspace.create({ name: 'Other WS' });
      const proj2 = await caller.project.create({ workspaceSlug: ws2.slug, name: 'Other' });

      const task1 = await caller.task.create({ projectId: proj.id, title: 'Proj1 task' });
      const task2 = await caller.task.create({ projectId: proj2.id, title: 'Proj2 task' });
      createMockDaemon(ctx);

      await caller.execution.startExecution({ scope: 'task', id: task1.id });
      await caller.execution.startExecution({ scope: 'task', id: task2.id });

      const sessions = await caller.execution.getActiveSessions({ projectId: proj.id });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].taskId).toBe(task1.id);
    });
  });

  describe('remote execution', () => {
    it('should create session with submitted status for remote execution', async () => {
      const { ws, proj } = await seedProject(caller);
      getDb().update(workspaces).set({ repos: ['/tmp/fake-repo'] }).where(eq(workspaces.id, ws.id)).run();
      const task = await caller.task.create({ projectId: proj.id, title: 'Remote task' });
      createMockDaemon(ctx);

      const result = await caller.execution.startExecution({
        scope: 'task',
        id: task.id,
        remote: true,
      });

      const db = getDb();
      const session = db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.sessionId, result.sessionId))
        .get();

      expect(session!.status).toBe('submitted');
    });

    it('should dispatch with remote config and no flags', async () => {
      const { ws, proj } = await seedProject(caller);
      getDb().update(workspaces).set({ repos: ['/tmp/fake-repo'] }).where(eq(workspaces.id, ws.id)).run();
      const task = await caller.task.create({ projectId: proj.id, title: 'Remote dispatch' });
      const { sent } = createMockDaemon(ctx);

      await caller.execution.startExecution({ scope: 'task', id: task.id, remote: true });

      const msg = JSON.parse(sent[0]);
      expect(msg.payload.config.remote).toBe(true);
      expect(msg.payload.flags).toEqual([]);
    });

    it('should reject retry for submitted (remote) sessions', async () => {
      const { ws, proj } = await seedProject(caller);
      getDb().update(workspaces).set({ repos: ['/tmp/fake-repo'] }).where(eq(workspaces.id, ws.id)).run();
      const task = await caller.task.create({ projectId: proj.id, title: 'Remote retry' });
      createMockDaemon(ctx);

      const { sessionId } = await caller.execution.startExecution({
        scope: 'task',
        id: task.id,
        remote: true,
      });

      await expect(caller.execution.retryExecution({ sessionId })).rejects.toThrow(
        'Cannot retry a remote session',
      );
    });

    it('should reject feedback for submitted (remote) sessions', async () => {
      const { ws, proj } = await seedProject(caller);
      getDb().update(workspaces).set({ repos: ['/tmp/fake-repo'] }).where(eq(workspaces.id, ws.id)).run();
      const task = await caller.task.create({ projectId: proj.id, title: 'Remote feedback' });
      createMockDaemon(ctx);

      const { sessionId } = await caller.execution.startExecution({
        scope: 'task',
        id: task.id,
        remote: true,
      });

      await expect(
        caller.execution.sendFeedback({ sessionId, feedback: 'Fix this' }),
      ).rejects.toThrow('Cannot send feedback to a remote session');
    });

    it('should throw when workspace has no repos for remote execution', async () => {
      const { proj } = await seedProject(caller);
      const task = await caller.task.create({ projectId: proj.id, title: 'No repos task' });
      createMockDaemon(ctx);

      await expect(
        caller.execution.startExecution({ scope: 'task', id: task.id, remote: true }),
      ).rejects.toThrow('Remote execution requires at least one repository');
    });

    it('should block duplicate remote sessions for the same task', async () => {
      const { ws, proj } = await seedProject(caller);
      getDb().update(workspaces).set({ repos: ['/tmp/fake-repo'] }).where(eq(workspaces.id, ws.id)).run();
      const task = await caller.task.create({ projectId: proj.id, title: 'Dup remote' });
      createMockDaemon(ctx);

      await caller.execution.startExecution({ scope: 'task', id: task.id, remote: true });

      await expect(
        caller.execution.startExecution({ scope: 'task', id: task.id, remote: true }),
      ).rejects.toThrow('An execution is already active for this scope');
    });
  });

  describe('startBatchExecution', () => {
    it('should create a session and mark all tasks as in_progress/implementing', async () => {
      const { proj } = await seedProject(caller);
      const t1 = await caller.task.create({ projectId: proj.id, title: 'Batch 1' });
      const t2 = await caller.task.create({ projectId: proj.id, title: 'Batch 2' });
      const t3 = await caller.task.create({ projectId: proj.id, title: 'Batch 3' });
      const { sent } = createMockDaemon(ctx);

      const result = await caller.execution.startBatchExecution({
        taskIds: [t1.id, t2.id, t3.id],
      });

      expect(result.sessionId).toBeDefined();

      // Verify prompt includes all task slugs (workspace slug is "exec-ws")
      const msg = JSON.parse(sent[0]);
      expect(msg.type).toBe('EXECUTION_START_REQUEST');
      expect(msg.payload.prompt).toContain(`exec-ws-T${t1.id}`);
      expect(msg.payload.prompt).toContain(`exec-ws-T${t2.id}`);
      expect(msg.payload.prompt).toContain(`exec-ws-T${t3.id}`);

      // Verify all tasks moved to in_progress/implementing
      const db = getDb();
      for (const id of [t1.id, t2.id, t3.id]) {
        const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
        expect(task!.status).toBe('in_progress');
        expect(task!.subStatus).toBe('implementing');
      }
    });

    it('should throw when a task already has an active session', async () => {
      const { proj } = await seedProject(caller);
      const t1 = await caller.task.create({ projectId: proj.id, title: 'Active task' });
      const t2 = await caller.task.create({ projectId: proj.id, title: 'Free task' });
      createMockDaemon(ctx);

      await caller.execution.startExecution({ scope: 'task', id: t1.id });

      await expect(
        caller.execution.startBatchExecution({ taskIds: [t1.id, t2.id] }),
      ).rejects.toThrow('already has an active session');
    });

    it('should throw when task has no project', async () => {
      const task = await caller.task.create({ title: 'No project' });
      createMockDaemon(ctx);

      await expect(
        caller.execution.startBatchExecution({ taskIds: [task.id] }),
      ).rejects.toThrow('has no project');
    });

    it('should require at least one task', async () => {
      createMockDaemon(ctx);

      await expect(
        caller.execution.startBatchExecution({ taskIds: [] }),
      ).rejects.toThrow();
    });

    it('should reject tasks from different projects', async () => {
      const { proj } = await seedProject(caller);
      const ws2 = await caller.workspace.create({ name: 'Other WS' });
      const proj2 = await caller.project.create({ workspaceSlug: ws2.slug, name: 'Other' });

      const t1 = await caller.task.create({ projectId: proj.id, title: 'Proj1 task' });
      const t2 = await caller.task.create({ projectId: proj2.id, title: 'Proj2 task' });
      createMockDaemon(ctx);

      await expect(
        caller.execution.startBatchExecution({ taskIds: [t1.id, t2.id] }),
      ).rejects.toThrow('All tasks in a batch must belong to the same project');
    });
  });
});
