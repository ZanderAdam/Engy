import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';
import { getDb } from '../../db/client';
import { agentSessions } from '../../db/schema';
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

    it('should support milestone scope', async () => {
      const { proj } = await seedProject(caller);
      await caller.task.create({
        projectId: proj.id,
        title: 'Milestone task',
        milestoneRef: 'm1',
      });
      const { sent } = createMockDaemon(ctx);

      const result = await caller.execution.startExecution({ scope: 'milestone', id: 'm1' });

      expect(result.sessionId).toBeDefined();
      const msg = JSON.parse(sent[0]);
      expect(msg.payload.prompt).toContain('implement-milestone');
      expect(msg.payload.prompt).toContain('m1');
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

    it('should throw when session not found', async () => {
      createMockDaemon(ctx);

      await expect(
        caller.execution.retryExecution({ sessionId: 'abc-123' }),
      ).rejects.toThrow('Session not found');
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
      const encoded = session!.worktreePath!.replace(/^\//g, '').replace(/\//g, '-');
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

    it('should throw when session not found', async () => {
      await expect(
        caller.execution.getSessionFile({ sessionId: 'nonexistent' }),
      ).rejects.toThrow('Session not found');
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
});
