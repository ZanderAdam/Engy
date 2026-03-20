import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getMcpServer } from './index';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { getDb } from '../db/client';
import {
  workspaces,
  projects,
  tasks,
  taskGroups,
  taskDependencies,
  fleetingMemories,
} from '../db/schema';

// Helper to call an MCP tool by name
function callTool(mcp: ReturnType<typeof getMcpServer>, name: string) {
  const tools = (mcp as any)._registeredTools;
  return async (params: Record<string, unknown> = {}) => {
    const result = await tools[name].handler(params, {} as any);
    return {
      raw: result,
      data: JSON.parse(result.content[0].text),
      isError: result.isError === true,
    };
  };
}

describe('MCP Server', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('getMcpServer', () => {
    it('should return a fresh McpServer instance each call', () => {
      const server1 = getMcpServer();
      const server2 = getMcpServer();
      expect(server1).not.toBe(server2);
    });
  });

  describe('workspace tools', () => {
    it('listWorkspaces should return all workspaces with id, name, slug', async () => {
      const db = getDb();
      db.insert(workspaces).values({ name: 'Engy', slug: 'engy' }).run();
      db.insert(workspaces).values({ name: 'Sandbox', slug: 'sandbox' }).run();

      const mcp = getMcpServer();
      const call = callTool(mcp, 'listWorkspaces');
      const { data } = await call();

      expect(data).toHaveLength(2);
      expect(data[0]).toEqual(expect.objectContaining({ name: 'Engy', slug: 'engy' }));
      expect(data[1]).toEqual(expect.objectContaining({ name: 'Sandbox', slug: 'sandbox' }));
      expect(Object.keys(data[0])).toEqual(['id', 'name', 'slug']);
    });

    it('listWorkspaces should return empty array when no workspaces', async () => {
      const mcp = getMcpServer();
      const call = callTool(mcp, 'listWorkspaces');
      const { data } = await call();
      expect(data).toEqual([]);
    });

    it('listProjects should return all projects when no filter', async () => {
      const db = getDb();
      const ws = db.insert(workspaces).values({ name: 'W1', slug: 'w1' }).returning().get();
      db.insert(projects).values({ workspaceId: ws.id, name: 'P1', slug: 'p1' }).run();
      db.insert(projects).values({ workspaceId: ws.id, name: 'P2', slug: 'p2' }).run();

      const mcp = getMcpServer();
      const call = callTool(mcp, 'listProjects');
      const { data } = await call();

      expect(data).toHaveLength(2);
    });

    it('listProjects should include slug and name', async () => {
      const db = getDb();
      const ws = db.insert(workspaces).values({ name: 'W1', slug: 'w1' }).returning().get();
      db.insert(projects).values({ workspaceId: ws.id, name: 'Initial', slug: 'initial' }).run();

      const mcp = getMcpServer();
      const call = callTool(mcp, 'listProjects');
      const { data } = await call();

      expect(data[0].name).toBe('Initial');
      expect(data[0].slug).toBe('initial');
    });

    it('listProjects should filter by workspaceId', async () => {
      const db = getDb();
      const ws1 = db.insert(workspaces).values({ name: 'W1', slug: 'w1' }).returning().get();
      const ws2 = db.insert(workspaces).values({ name: 'W2', slug: 'w2' }).returning().get();
      db.insert(projects).values({ workspaceId: ws1.id, name: 'P1', slug: 'p1' }).run();
      db.insert(projects).values({ workspaceId: ws2.id, name: 'P2', slug: 'p2' }).run();

      const mcp = getMcpServer();
      const call = callTool(mcp, 'listProjects');
      const { data } = await call({ workspaceId: ws1.id });

      expect(data).toHaveLength(1);
      expect(data[0].name).toBe('P1');
    });

    it('listProjects should return empty array when workspace has no projects', async () => {
      const db = getDb();
      const ws = db.insert(workspaces).values({ name: 'Empty', slug: 'empty' }).returning().get();

      const mcp = getMcpServer();
      const call = callTool(mcp, 'listProjects');
      const { data } = await call({ workspaceId: ws.id });

      expect(data).toHaveLength(0);
    });
  });

  describe('task tools', () => {
    let projectId: number;

    beforeEach(() => {
      const db = getDb();
      const ws = db.insert(workspaces).values({ name: 'Test', slug: 'test' }).returning().get();
      const proj = db
        .insert(projects)
        .values({ workspaceId: ws.id, name: 'P1', slug: 'p1' })
        .returning()
        .get();
      projectId = proj.id;
    });

    describe('createTask', () => {
      it('should return only the id', async () => {
        const mcp = getMcpServer();
        const call = callTool(mcp, 'createTask');
        const { data } = await call({
          title: 'Do something',
          projectId,
          type: 'human',
          importance: 'not_important',
          urgency: 'not_urgent',
          blockedBy: [],
        });

        expect(data).toEqual({ id: expect.any(Number) });
      });

      it('should return error for non-existent dependency', async () => {
        const mcp = getMcpServer();
        const call = callTool(mcp, 'createTask');
        const { data, isError } = await call({
          title: 'Bad Dep',
          projectId,
          type: 'human',
          importance: 'not_important',
          urgency: 'not_urgent',
          blockedBy: [9999],
        });

        expect(isError).toBe(true);
        expect(data.error).toContain('9999');
        expect(data.error).toContain('does not exist');
      });

      it('should return error when any dependency does not exist', async () => {
        const db = getDb();
        const existing = db.insert(tasks).values({ title: 'Real', projectId }).returning().get();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'createTask');
        const { data, isError } = await call({
          title: 'Mixed Deps',
          projectId,
          type: 'human',
          importance: 'not_important',
          urgency: 'not_urgent',
          blockedBy: [existing.id, 8888],
        });

        expect(isError).toBe(true);
        expect(data.error).toContain('8888');
        expect(data.error).toContain('does not exist');
      });
    });

    describe('updateTask', () => {
      it('should return success true', async () => {
        const db = getDb();
        const task = db.insert(tasks).values({ title: 'T1', projectId }).returning().get();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'updateTask');
        const { data } = await call({ id: task.id, status: 'in_progress' });

        expect(data).toEqual({ success: true });
      });

      it('should return error for missing task', async () => {
        const mcp = getMcpServer();
        const call = callTool(mcp, 'updateTask');
        const { isError } = await call({ id: 9999, status: 'done' });

        expect(isError).toBe(true);
      });

      it('should accept projectId', async () => {
        const db = getDb();
        const task = db.insert(tasks).values({ title: 'T1' }).returning().get();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'updateTask');
        const { data } = await call({ id: task.id, projectId });

        expect(data).toEqual({ success: true });
        const updated = db.select().from(tasks).where(eq(tasks.id, task.id)).get();
        expect(updated!.projectId).toBe(projectId);
      });

      it('should accept specId', async () => {
        const db = getDb();
        const task = db.insert(tasks).values({ title: 'T1', projectId }).returning().get();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'updateTask');
        const { data } = await call({ id: task.id, specId: 'spec-123' });

        expect(data).toEqual({ success: true });
        const updated = db.select().from(tasks).where(eq(tasks.id, task.id)).get();
        expect(updated!.specId).toBe('spec-123');
      });

      it('should allow nulling out projectId', async () => {
        const db = getDb();
        const task = db.insert(tasks).values({ title: 'T1', projectId }).returning().get();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'updateTask');
        const { data } = await call({ id: task.id, projectId: null });

        expect(data).toEqual({ success: true });
        const updated = db.select().from(tasks).where(eq(tasks.id, task.id)).get();
        expect(updated!.projectId).toBeNull();
      });

      it('should return error for non-existent dependency', async () => {
        const db = getDb();
        const task = db.insert(tasks).values({ title: 'T1', projectId }).returning().get();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'updateTask');
        const { data, isError } = await call({ id: task.id, blockedBy: [9999] });

        expect(isError).toBe(true);
        expect(data.error).toContain('9999');
        expect(data.error).toContain('does not exist');
      });

      it('should return error for circular dependency', async () => {
        const db = getDb();
        const taskA = db.insert(tasks).values({ title: 'A', projectId }).returning().get();
        const taskB = db.insert(tasks).values({ title: 'B', projectId }).returning().get();
        db.insert(taskDependencies)
          .values({ taskId: taskB.id, blockerTaskId: taskA.id })
          .run();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'updateTask');
        const { data, isError } = await call({ id: taskA.id, blockedBy: [taskB.id] });

        expect(isError).toBe(true);
        expect(data.error).toContain('Circular dependency');
      });
    });

    describe('listTasks', () => {
      it('should omit description by default (compact)', async () => {
        const db = getDb();
        db.insert(tasks)
          .values({ title: 'T1', projectId, description: 'Details here' })
          .run();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'listTasks');
        const { data } = await call({ projectId });

        expect(data).toHaveLength(1);
        expect(data[0].title).toBe('T1');
        expect(data[0]).not.toHaveProperty('description');
      });

      it('should include description when compact is false', async () => {
        const db = getDb();
        db.insert(tasks)
          .values({ title: 'T1', projectId, description: 'Details here' })
          .run();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'listTasks');
        const { data } = await call({ projectId, compact: false });

        expect(data[0].description).toBe('Details here');
      });

      it('should filter by projectId', async () => {
        const db = getDb();
        db.insert(tasks).values({ title: 'T1', projectId }).run();
        db.insert(tasks).values({ title: 'T2', projectId }).run();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'listTasks');
        const { data } = await call({ projectId });

        expect(data).toHaveLength(2);
      });

      it('should return all tasks when no filter', async () => {
        const db = getDb();
        db.insert(tasks).values({ title: 'T1', projectId }).run();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'listTasks');
        const { data } = await call();

        expect(data).toHaveLength(1);
      });

      it('should filter by milestoneRef', async () => {
        const db = getDb();
        db.insert(tasks).values({ title: 'T1', projectId, milestoneRef: 'm1' }).run();
        db.insert(tasks).values({ title: 'T2', projectId }).run();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'listTasks');
        const { data } = await call({ milestoneRef: 'm1' });

        expect(data).toHaveLength(1);
        expect(data[0].title).toBe('T1');
      });

      it('should filter by taskGroupId', async () => {
        const db = getDb();
        const grp = db
          .insert(taskGroups)
          .values({ milestoneRef: 'm1', name: 'G1' })
          .returning()
          .get();
        db.insert(tasks).values({ title: 'T1', projectId, taskGroupId: grp.id }).run();
        db.insert(tasks).values({ title: 'T2', projectId }).run();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'listTasks');
        const { data } = await call({ taskGroupId: grp.id });

        expect(data).toHaveLength(1);
        expect(data[0].title).toBe('T1');
      });

      it('should combine milestoneRef AND taskGroupId filters', async () => {
        const db = getDb();
        const grp = db
          .insert(taskGroups)
          .values({ milestoneRef: 'm1', name: 'G1' })
          .returning()
          .get();
        db.insert(tasks)
          .values({ title: 'A', projectId, milestoneRef: 'm1', taskGroupId: grp.id })
          .run();
        db.insert(tasks)
          .values({ title: 'B', projectId, milestoneRef: 'm1' })
          .run();
        db.insert(tasks)
          .values({ title: 'C', projectId, milestoneRef: 'm2', taskGroupId: grp.id })
          .run();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'listTasks');
        const { data } = await call({ milestoneRef: 'm1', taskGroupId: grp.id });

        expect(data).toHaveLength(1);
        expect(data[0].title).toBe('A');
      });

      it('should combine projectId AND milestoneRef filters', async () => {
        const db = getDb();
        db.insert(tasks).values({ title: 'A', projectId, milestoneRef: 'm1' }).run();
        db.insert(tasks).values({ title: 'B', projectId, milestoneRef: 'm2' }).run();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'listTasks');
        const { data } = await call({ projectId, milestoneRef: 'm1' });

        expect(data).toHaveLength(1);
        expect(data[0].title).toBe('A');
      });
    });

    describe('getTask', () => {
      it('should return a task by ID', async () => {
        const db = getDb();
        const task = db.insert(tasks).values({ title: 'T1', projectId }).returning().get();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'getTask');
        const { data } = await call({ id: task.id });

        expect(data.title).toBe('T1');
      });
    });

    describe('deleteTask', () => {
      it('should delete a task and return success', async () => {
        const db = getDb();
        const task = db.insert(tasks).values({ title: 'T1', projectId }).returning().get();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'deleteTask');
        const { data } = await call({ id: task.id });

        expect(data).toEqual({ success: true });
        expect(db.select().from(tasks).where(eq(tasks.id, task.id)).get()).toBeUndefined();
      });

      it('should return error for non-existent task', async () => {
        const mcp = getMcpServer();
        const call = callTool(mcp, 'deleteTask');
        const { data, isError } = await call({ id: 9999 });

        expect(isError).toBe(true);
        expect(data.error).toContain('Task not found');
      });
    });
  });

  describe('task group tools', () => {
    const milestoneRef = 'm1';

    beforeEach(() => {
      const db = getDb();
      const ws = db.insert(workspaces).values({ name: 'Test', slug: 'test' }).returning().get();
      db.insert(projects).values({ workspaceId: ws.id, name: 'P1', slug: 'p1' }).run();
    });

    describe('createTaskGroup', () => {
      it('should return only the id', async () => {
        const mcp = getMcpServer();
        const call = callTool(mcp, 'createTaskGroup');
        const { data } = await call({ milestoneRef, name: 'Group 1' });

        expect(data).toEqual({ id: expect.any(Number) });
      });
    });

    describe('listTaskGroups', () => {
      it('should return groups for a milestone', async () => {
        const db = getDb();
        db.insert(taskGroups).values({ milestoneRef, name: 'G1' }).run();
        db.insert(taskGroups).values({ milestoneRef, name: 'G2' }).run();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'listTaskGroups');
        const { data } = await call({ milestoneRef });

        expect(data).toHaveLength(2);
      });
    });

    describe('getTaskGroup', () => {
      it('should return a task group by ID', async () => {
        const db = getDb();
        const grp = db
          .insert(taskGroups)
          .values({ milestoneRef, name: 'Backend' })
          .returning()
          .get();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'getTaskGroup');
        const { data } = await call({ id: grp.id });

        expect(data.name).toBe('Backend');
        expect(data.milestoneRef).toBe(milestoneRef);
      });

      it('should return error for missing group', async () => {
        const mcp = getMcpServer();
        const call = callTool(mcp, 'getTaskGroup');
        const { data, isError } = await call({ id: 9999 });

        expect(isError).toBe(true);
        expect(data.error).toContain('Task group not found');
      });
    });

    describe('updateTaskGroup', () => {
      it('should return success true', async () => {
        const db = getDb();
        const grp = db
          .insert(taskGroups)
          .values({ milestoneRef, name: 'Old' })
          .returning()
          .get();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'updateTaskGroup');
        const { data } = await call({ id: grp.id, name: 'Frontend' });

        expect(data).toEqual({ success: true });
        const updated = db.select().from(taskGroups).where(eq(taskGroups.id, grp.id)).get();
        expect(updated!.name).toBe('Frontend');
      });

      it('should update status', async () => {
        const db = getDb();
        const grp = db
          .insert(taskGroups)
          .values({ milestoneRef, name: 'G1' })
          .returning()
          .get();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'updateTaskGroup');
        const { data } = await call({ id: grp.id, status: 'active' });

        expect(data).toEqual({ success: true });
        const updated = db.select().from(taskGroups).where(eq(taskGroups.id, grp.id)).get();
        expect(updated!.status).toBe('active');
      });

      it('should return error for missing group', async () => {
        const mcp = getMcpServer();
        const call = callTool(mcp, 'updateTaskGroup');
        const { data, isError } = await call({ id: 9999, name: 'X' });

        expect(isError).toBe(true);
        expect(data.error).toContain('Task group not found');
      });
    });

    describe('deleteTaskGroup', () => {
      it('should delete a group and return success', async () => {
        const db = getDb();
        const grp = db
          .insert(taskGroups)
          .values({ milestoneRef, name: 'G1' })
          .returning()
          .get();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'deleteTaskGroup');
        const { data } = await call({ id: grp.id });

        expect(data).toEqual({ success: true });
        expect(db.select().from(taskGroups).where(eq(taskGroups.id, grp.id)).get()).toBeUndefined();
      });

      it('should return error for non-existent group', async () => {
        const mcp = getMcpServer();
        const call = callTool(mcp, 'deleteTaskGroup');
        const { data, isError } = await call({ id: 9999 });

        expect(isError).toBe(true);
        expect(data.error).toContain('Task group not found');
      });
    });
  });

  describe('memory tools', () => {
    let workspaceId: number;

    beforeEach(() => {
      const db = getDb();
      const ws = db.insert(workspaces).values({ name: 'Test', slug: 'test' }).returning().get();
      workspaceId = ws.id;
    });

    it('createFleetingMemory should create a memory', async () => {
      const mcp = getMcpServer();
      const call = callTool(mcp, 'createFleetingMemory');
      const { data } = await call({
        workspaceId,
        content: 'Remember this',
        type: 'capture',
        source: 'agent',
        tags: [],
      });

      expect(data.content).toBe('Remember this');
      expect(data.type).toBe('capture');
    });

    it('listMemories should omit content by default (compact)', async () => {
      const db = getDb();
      db.insert(fleetingMemories)
        .values({ workspaceId, content: 'Memory 1', type: 'capture', source: 'agent' })
        .run();

      const mcp = getMcpServer();
      const call = callTool(mcp, 'listMemories');
      const { data } = await call({ workspaceId });

      expect(data).toHaveLength(1);
      expect(data[0]).not.toHaveProperty('content');
    });

    it('listMemories should include content when compact is false', async () => {
      const db = getDb();
      db.insert(fleetingMemories)
        .values({ workspaceId, content: 'Memory 1', type: 'capture', source: 'agent' })
        .run();

      const mcp = getMcpServer();
      const call = callTool(mcp, 'listMemories');
      const { data } = await call({ workspaceId, compact: false });

      expect(data[0].content).toBe('Memory 1');
    });

    it('listMemories should filter by workspaceId', async () => {
      const db = getDb();
      db.insert(fleetingMemories)
        .values({ workspaceId, content: 'Memory 1', type: 'capture', source: 'agent' })
        .run();
      db.insert(fleetingMemories)
        .values({ workspaceId, content: 'Memory 2', type: 'idea', source: 'user' })
        .run();

      const mcp = getMcpServer();
      const call = callTool(mcp, 'listMemories');
      const { data } = await call({ workspaceId });

      expect(data).toHaveLength(2);
    });

    it('listMemories should filter by projectId', async () => {
      const db = getDb();
      const proj = db
        .insert(projects)
        .values({ workspaceId, name: 'MemProj', slug: 'memproj' })
        .returning()
        .get();
      db.insert(fleetingMemories)
        .values({
          workspaceId,
          projectId: proj.id,
          content: 'Proj mem',
          type: 'capture',
          source: 'agent',
        })
        .run();
      db.insert(fleetingMemories)
        .values({ workspaceId, content: 'No proj', type: 'capture', source: 'agent' })
        .run();

      const mcp = getMcpServer();
      const call = callTool(mcp, 'listMemories');
      const { data } = await call({ projectId: proj.id, compact: false });

      expect(data).toHaveLength(1);
      expect(data[0].content).toBe('Proj mem');
    });

    it('listMemories should return all memories when no filter', async () => {
      const db = getDb();
      db.insert(fleetingMemories)
        .values({ workspaceId, content: 'Mem', type: 'capture', source: 'agent' })
        .run();

      const mcp = getMcpServer();
      const call = callTool(mcp, 'listMemories');
      const { data } = await call();

      expect(data).toHaveLength(1);
    });
  });
});
