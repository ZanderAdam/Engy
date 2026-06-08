import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appRouter } from '../trpc/root';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { getDb } from '../db/client';
import { fleetingMemories, agentSessions, tasks, taskGroups } from '../db/schema';
import { eq } from 'drizzle-orm';

describe('ProjectCompletionService', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;
  let workspaceId: number;
  let projectId: number;

  beforeEach(async () => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
    const ws = await caller.workspace.create({ name: 'Test WS' });
    workspaceId = ws.id;
    const project = await caller.project.create({
      workspaceSlug: 'test-ws',
      name: 'My Project',
    });
    projectId = project.id;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('startCompletion', () => {
    it('should set project status to completing', async () => {
      await caller.project.startCompletion({ projectId });
      const project = await caller.project.get({ id: projectId });
      expect(project.status).toBe('completing');
    });

    it('should return unpromoted fleeting memories for the workspace', async () => {
      const db = getDb();
      db.insert(fleetingMemories)
        .values({ workspaceId, content: 'Note A', source: 'user', tags: ['auth'], promoted: false })
        .run();
      db.insert(fleetingMemories)
        .values({ workspaceId, content: 'Note B', source: 'agent', tags: [], promoted: false })
        .run();

      const result = await caller.project.startCompletion({ projectId });
      expect(result.candidates.length).toBe(2);
      expect(result.candidates.every((c) => !c.promoted)).toBe(true);
    });

    it('should not include promoted fleeting memories', async () => {
      const db = getDb();
      db.insert(fleetingMemories)
        .values({ workspaceId, content: 'Promoted', source: 'user', promoted: true })
        .run();
      db.insert(fleetingMemories)
        .values({ workspaceId, content: 'Unpromoted', source: 'user', promoted: false })
        .run();

      const result = await caller.project.startCompletion({ projectId });
      expect(result.candidates.length).toBe(1);
      expect(result.candidates[0].content).toBe('Unpromoted');
    });

    it('should only surface fleetings from the same workspace', async () => {
      const db = getDb();
      const otherWs = await caller.workspace.create({ name: 'Other WS' });

      db.insert(fleetingMemories)
        .values({ workspaceId, content: 'Mine', source: 'user', promoted: false })
        .run();
      db.insert(fleetingMemories)
        .values({ workspaceId: otherWs.id, content: 'Other', source: 'user', promoted: false })
        .run();

      const result = await caller.project.startCompletion({ projectId });
      expect(result.candidates.length).toBe(1);
      expect(result.candidates[0].content).toBe('Mine');
    });

    it('should sort higher-signal candidates first', async () => {
      const db = getDb();
      // Low signal: agent-sourced, no tags, no sources
      db.insert(fleetingMemories)
        .values({ workspaceId, content: 'Low signal', source: 'agent', tags: [], sources: [], promoted: false })
        .run();
      // High signal: user-sourced with tags and sources
      db.insert(fleetingMemories)
        .values({
          workspaceId,
          content: 'High signal',
          source: 'user',
          tags: ['important'],
          sources: ['/memory/sources/ref.md'],
          promoted: false,
        })
        .run();

      const result = await caller.project.startCompletion({ projectId });
      expect(result.candidates[0].content).toBe('High signal');
      expect(result.candidates[1].content).toBe('Low signal');
    });

    it('should return empty candidates when no fleetings exist', async () => {
      const result = await caller.project.startCompletion({ projectId });
      expect(result.candidates).toEqual([]);
    });

    it('should throw NOT_FOUND for unknown project', async () => {
      await expect(caller.project.startCompletion({ projectId: 9999 })).rejects.toThrow('not found');
    });
  });

  describe('archive', () => {
    it('should set project status to archived', async () => {
      await caller.project.archive({ projectId });
      const project = await caller.project.get({ id: projectId });
      expect(project.status).toBe('archived');
    });

    it('should delete agent sessions linked to project tasks', async () => {
      const db = getDb();
      const task = await caller.task.create({ projectId, title: 'Task 1' });
      db.insert(agentSessions)
        .values({
          sessionId: 'sess-task-1',
          taskId: task.id,
          executionMode: 'task',
          status: 'completed',
        })
        .run();

      await caller.project.archive({ projectId });

      const remaining = db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.sessionId, 'sess-task-1'))
        .get();
      expect(remaining).toBeUndefined();
    });

    it('should delete agent sessions linked to project task groups', async () => {
      const db = getDb();
      const [taskGroup] = db
        .insert(taskGroups)
        .values({ projectId, milestoneRef: 'm1', name: 'Group 1' })
        .returning()
        .all();
      db.insert(agentSessions)
        .values({
          sessionId: 'sess-group-1',
          taskGroupId: taskGroup.id,
          executionMode: 'group',
          status: 'completed',
        })
        .run();

      await caller.project.archive({ projectId });

      const remaining = db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.sessionId, 'sess-group-1'))
        .get();
      expect(remaining).toBeUndefined();
    });

    it('should delete sessions from both tasks and task groups', async () => {
      const db = getDb();
      const task = await caller.task.create({ projectId, title: 'Task A' });
      const [taskGroup] = db
        .insert(taskGroups)
        .values({ projectId, milestoneRef: 'm1', name: 'Group A' })
        .returning()
        .all();

      db.insert(agentSessions)
        .values({ sessionId: 'sess-t', taskId: task.id, executionMode: 'task', status: 'completed' })
        .run();
      db.insert(agentSessions)
        .values({ sessionId: 'sess-g', taskGroupId: taskGroup.id, executionMode: 'group', status: 'completed' })
        .run();

      await caller.project.archive({ projectId });

      const allSessions = db.select().from(agentSessions).all();
      expect(allSessions.length).toBe(0);
    });

    it('should preserve plan content, tasks, and task groups', async () => {
      const db = getDb();
      await caller.task.create({ projectId, title: 'Preserved Task' });
      db.insert(taskGroups)
        .values({ projectId, milestoneRef: 'm1', name: 'Preserved Group' })
        .run();

      await caller.project.archive({ projectId });

      const remainingTasks = db.select().from(tasks).where(eq(tasks.projectId, projectId)).all();
      const remainingGroups = db
        .select()
        .from(taskGroups)
        .where(eq(taskGroups.projectId, projectId))
        .all();

      expect(remainingTasks.length).toBe(1);
      expect(remainingGroups.length).toBe(1);
    });

    it('should preserve fleeting memories after archival', async () => {
      const db = getDb();
      db.insert(fleetingMemories)
        .values({ workspaceId, content: 'Keep me', source: 'user', promoted: false })
        .run();

      await caller.project.archive({ projectId });

      const memories = db.select().from(fleetingMemories).all();
      expect(memories.length).toBe(1);
      expect(memories[0].content).toBe('Keep me');
    });

    it('should not affect sessions from other projects', async () => {
      const db = getDb();
      const otherProject = await caller.project.create({
        workspaceSlug: 'test-ws',
        name: 'Other Project',
      });
      const otherTask = await caller.task.create({ projectId: otherProject.id, title: 'Other Task' });
      db.insert(agentSessions)
        .values({ sessionId: 'sess-other', taskId: otherTask.id, executionMode: 'task', status: 'completed' })
        .run();

      await caller.project.archive({ projectId });

      const otherSession = db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.sessionId, 'sess-other'))
        .get();
      expect(otherSession).toBeDefined();
    });

    it('should succeed when project has no tasks or sessions', async () => {
      const result = await caller.project.archive({ projectId });
      expect(result.success).toBe(true);
    });

    it('should throw NOT_FOUND for unknown project', async () => {
      await expect(caller.project.archive({ projectId: 9999 })).rejects.toThrow('not found');
    });
  });
});
