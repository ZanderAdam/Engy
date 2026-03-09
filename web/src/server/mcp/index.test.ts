import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

    it('createTask should create a task', async () => {
      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['createTask'];

      const result = await tool.handler(
        { title: 'Do something', projectId, type: 'human', importance: 'not_important', urgency: 'not_urgent', blockedBy: [] },
        {} as any,
      );
      const data = JSON.parse(result.content[0].text);
      expect(data.title).toBe('Do something');
      expect(data.status).toBe('todo');
    });

    it('updateTask should update task fields', async () => {
      const db = getDb();
      const task = db
        .insert(tasks)
        .values({ title: 'T1', projectId })
        .returning()
        .get();

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['updateTask'];

      const result = await tool.handler({ id: task.id, status: 'in_progress' }, {} as any);
      const data = JSON.parse(result.content[0].text);
      expect(data.status).toBe('in_progress');
    });

    it('updateTask should return error for missing task', async () => {
      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['updateTask'];

      const result = await tool.handler({ id: 9999, status: 'done' }, {} as any);
      expect(result.isError).toBe(true);
    });

    it('getTask should return a task by ID', async () => {
      const db = getDb();
      const task = db
        .insert(tasks)
        .values({ title: 'T1', projectId })
        .returning()
        .get();

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['getTask'];

      const result = await tool.handler({ id: task.id }, {} as any);
      const data = JSON.parse(result.content[0].text);
      expect(data.title).toBe('T1');
    });

    it('listTasks should filter by projectId', async () => {
      const db = getDb();
      db.insert(tasks).values({ title: 'T1', projectId }).run();
      db.insert(tasks).values({ title: 'T2', projectId }).run();

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['listTasks'];

      const result = await tool.handler({ projectId }, {} as any);
      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveLength(2);
    });

    it('listTasks should return all tasks when no filter', async () => {
      const db = getDb();
      db.insert(tasks).values({ title: 'T1', projectId }).run();

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['listTasks'];

      const result = await tool.handler({}, {} as any);
      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveLength(1);
    });

    it('listTasks should filter by milestoneRef', async () => {
      const db = getDb();
      db.insert(tasks).values({ title: 'T1', projectId, milestoneRef: 'm1' }).run();
      db.insert(tasks).values({ title: 'T2', projectId }).run();

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['listTasks'];

      const result = await tool.handler({ milestoneRef: 'm1' }, {} as any);
      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveLength(1);
      expect(data[0].title).toBe('T1');
    });

    it('listTasks should filter by taskGroupId', async () => {
      const db = getDb();
      const grp = db.insert(taskGroups).values({ milestoneRef: 'm1', name: 'G1' }).returning().get();
      db.insert(tasks).values({ title: 'T1', projectId, taskGroupId: grp.id }).run();
      db.insert(tasks).values({ title: 'T2', projectId }).run();

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['listTasks'];

      const result = await tool.handler({ taskGroupId: grp.id }, {} as any);
      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveLength(1);
      expect(data[0].title).toBe('T1');
    });

    it('createTask should return error for non-existent dependency', async () => {
      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['createTask'];

      const result = await tool.handler(
        { title: 'Bad Dep', projectId, type: 'human', importance: 'not_important', urgency: 'not_urgent', blockedBy: [9999] },
        {} as any,
      );
      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toContain('9999');
      expect(data.error).toContain('does not exist');
    });

    it('createTask should return error when any dependency does not exist', async () => {
      const db = getDb();
      const existing = db.insert(tasks).values({ title: 'Real', projectId }).returning().get();

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['createTask'];

      const result = await tool.handler(
        { title: 'Mixed Deps', projectId, type: 'human', importance: 'not_important', urgency: 'not_urgent', blockedBy: [existing.id, 8888] },
        {} as any,
      );
      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toContain('8888');
      expect(data.error).toContain('does not exist');
    });

    it('updateTask should return error for non-existent dependency', async () => {
      const db = getDb();
      const task = db.insert(tasks).values({ title: 'T1', projectId }).returning().get();

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['updateTask'];

      const result = await tool.handler({ id: task.id, blockedBy: [9999] }, {} as any);
      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toContain('9999');
      expect(data.error).toContain('does not exist');
    });

    it('updateTask should return error for circular dependency', async () => {
      const db = getDb();
      const taskA = db.insert(tasks).values({ title: 'A', projectId }).returning().get();
      const taskB = db.insert(tasks).values({ title: 'B', projectId }).returning().get();
      db.insert(taskDependencies).values({ taskId: taskB.id, blockerTaskId: taskA.id }).run();

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['updateTask'];

      const result = await tool.handler({ id: taskA.id, blockedBy: [taskB.id] }, {} as any);
      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toContain('Circular dependency');
    });
  });

  describe('task group tools', () => {
    const milestoneRef = 'm1';

    beforeEach(() => {
      const db = getDb();
      const ws = db.insert(workspaces).values({ name: 'Test', slug: 'test' }).returning().get();
      db.insert(projects).values({ workspaceId: ws.id, name: 'P1', slug: 'p1' }).run();
    });

    it('createTaskGroup should create a task group', async () => {
      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['createTaskGroup'];

      const result = await tool.handler({ milestoneRef, name: 'Group 1' }, {} as any);
      const data = JSON.parse(result.content[0].text);
      expect(data.name).toBe('Group 1');
      expect(data.status).toBe('planned');
    });

    it('listTaskGroups should return groups for a milestone', async () => {
      const db = getDb();
      db.insert(taskGroups).values({ milestoneRef, name: 'G1' }).run();
      db.insert(taskGroups).values({ milestoneRef, name: 'G2' }).run();

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['listTaskGroups'];

      const result = await tool.handler({ milestoneRef }, {} as any);
      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveLength(2);
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
      const tools = (mcp as any)._registeredTools;
      const tool = tools['createFleetingMemory'];

      const result = await tool.handler(
        { workspaceId, content: 'Remember this', type: 'capture', source: 'agent', tags: [] },
        {} as any,
      );
      const data = JSON.parse(result.content[0].text);
      expect(data.content).toBe('Remember this');
      expect(data.type).toBe('capture');
    });

    it('listMemories should return memories filtered by workspaceId', async () => {
      const db = getDb();
      db.insert(fleetingMemories)
        .values({ workspaceId, content: 'Memory 1', type: 'capture', source: 'agent' })
        .run();
      db.insert(fleetingMemories)
        .values({ workspaceId, content: 'Memory 2', type: 'idea', source: 'user' })
        .run();

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['listMemories'];

      const result = await tool.handler({ workspaceId }, {} as any);
      const data = JSON.parse(result.content[0].text);
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
        .values({ workspaceId, projectId: proj.id, content: 'Proj mem', type: 'capture', source: 'agent' })
        .run();
      db.insert(fleetingMemories)
        .values({ workspaceId, content: 'No proj', type: 'capture', source: 'agent' })
        .run();

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['listMemories'];

      const result = await tool.handler({ projectId: proj.id }, {} as any);
      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveLength(1);
      expect(data[0].content).toBe('Proj mem');
    });

    it('listMemories should return all memories when no filter', async () => {
      const db = getDb();
      db.insert(fleetingMemories)
        .values({ workspaceId, content: 'Mem', type: 'capture', source: 'agent' })
        .run();

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['listMemories'];

      const result = await tool.handler({}, {} as any);
      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveLength(1);
    });
  });
});
