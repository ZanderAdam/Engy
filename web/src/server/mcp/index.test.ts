import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi, type MockedFunction } from 'vitest';
import { eq } from 'drizzle-orm';
import { getMcpServer } from './index';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { getDb } from '../db/client';
import { appRouter } from '../trpc/root';
import { _resetStoreCache } from '../search/qmd-store';
import {
  workspaces,
  projects,
  tasks,
  taskGroups,
  taskDependencies,
  fleetingMemories,
  permanentMemories,
  frontmatter,
} from '../db/schema';

vi.mock('../search/qmd-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../search/qmd-store')>();
  return {
    ...actual,
    // Default to calling through to the real implementation; search tests override per-test.
    getStore: vi.fn(actual.getStore),
  };
});

import { getStore } from '../search/qmd-store';
const mockGetStore = getStore as MockedFunction<typeof getStore>;

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

      it('should return planContent when plan file exists', async () => {
        const db = getDb();
        const task = db.insert(tasks).values({ title: 'T1', projectId }).returning().get();

        const projectDir = path.join(ctx.tmpDir, 'test', 'projects', 'p1');
        const plansDir = path.join(projectDir, 'plans');
        fs.mkdirSync(plansDir, { recursive: true });
        fs.writeFileSync(path.join(plansDir, `test-T${task.id}.plan.md`), '# Task Plan');

        const mcp = getMcpServer();
        const call = callTool(mcp, 'getTask');
        const { data } = await call({ id: task.id });

        expect(data.planContent).toBe('# Task Plan');
      });

      it('should return planContent as null when no plan file exists', async () => {
        const db = getDb();
        const task = db.insert(tasks).values({ title: 'T1', projectId }).returning().get();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'getTask');
        const { data } = await call({ id: task.id });

        expect(data.planContent).toBeNull();
      });

      it('should return planContent as null when task has no projectId', async () => {
        const db = getDb();
        const task = db
          .insert(tasks)
          .values({ title: 'Orphan', projectId: null })
          .returning()
          .get();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'getTask');
        const { data } = await call({ id: task.id });

        expect(data.planContent).toBeNull();
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

    it('listMemories should filter by workspaceId when multiple workspaces exist', async () => {
      const db = getDb();
      const ws2 = db
        .insert(workspaces)
        .values({ name: 'WS2', slug: 'ws2' })
        .returning()
        .get();
      db.insert(fleetingMemories)
        .values({ workspaceId, content: 'WS1 mem', type: 'capture', source: 'agent' })
        .run();
      db.insert(fleetingMemories)
        .values({ workspaceId: ws2.id, content: 'WS2 mem', type: 'capture', source: 'agent' })
        .run();

      const mcp = getMcpServer();
      const call = callTool(mcp, 'listMemories');
      const { data } = await call({ workspaceId, compact: false });

      expect(data).toHaveLength(1);
      expect(data[0].content).toBe('WS1 mem');
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

  describe('index tools', () => {
    let wsWorkspaceId: number;
    let wsDir: string;
    let wsSlug: string;

    beforeEach(async () => {
      const caller = appRouter.createCaller({ state: ctx.state });
      const ws = await caller.workspace.create({ name: 'Index Test WS' });
      wsSlug = ws.slug;
      const db = getDb();
      const wsRow = db.select().from(workspaces).where(eq(workspaces.slug, ws.slug)).get()!;
      wsWorkspaceId = wsRow.id;
      wsDir = path.join(ctx.tmpDir, wsSlug);
    });

    afterEach(() => {
      _resetStoreCache();
    });

    function writeFixture(relPath: string, content: string): void {
      const abs = path.join(wsDir, relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
    }

    describe('reindex', () => {
      it('should return error for non-existent workspace', async () => {
        const mcp = getMcpServer();
        const { isError, data } = await callTool(mcp, 'reindex')({ workspaceId: 9999 });

        expect(isError).toBe(true);
        expect(data.error).toContain('Workspace not found');
      });

      it('should return per-collection counts for an empty workspace', async () => {
        const mcp = getMcpServer();
        const { data, isError } = await callTool(mcp, 'reindex')({ workspaceId: wsWorkspaceId });

        expect(isError).toBe(false);
        expect(data).toHaveProperty('durationMs');
        expect(data).toHaveProperty('collections');
        expect(Array.isArray(data.collections)).toBe(true);
        expect(data.collections).toHaveLength(4);
      });

      it('should index a new markdown file and return positive indexed count', async () => {
        writeFixture('docs/guide.md', '---\ntitle: Guide\n---\n\nContent here.\n');

        const mcp = getMcpServer();
        const { data } = await callTool(mcp, 'reindex')({
          workspaceId: wsWorkspaceId,
          collection: 'docs',
        });

        const docs = data.collections.find(
          (c: { collection: string }) => c.collection === 'docs',
        );
        expect(docs).toBeDefined();
        expect(docs.indexed + docs.updated).toBeGreaterThanOrEqual(1);
      });

      it('should accept full:true and return results for all four collections', async () => {
        writeFixture('system/arch.md', '---\ntitle: Architecture\n---\n');

        const mcp = getMcpServer();
        const { data, isError } = await callTool(mcp, 'reindex')({
          workspaceId: wsWorkspaceId,
          full: true,
        });

        expect(isError).toBe(false);
        expect(data.collections).toHaveLength(4);
      });

      it('should limit to a single collection when collection is specified', async () => {
        const mcp = getMcpServer();
        const { data } = await callTool(mcp, 'reindex')({
          workspaceId: wsWorkspaceId,
          collection: 'memory',
        });

        expect(data.collections).toHaveLength(1);
        expect(data.collections[0].collection).toBe('memory');
      });
    });

    describe('indexStatus', () => {
      it('should return error for non-existent workspace', async () => {
        const mcp = getMcpServer();
        const { isError, data } = await callTool(mcp, 'indexStatus')({ workspaceId: 9999 });

        expect(isError).toBe(true);
        expect(data.error).toContain('Workspace not found');
      });

      it('should return status with upToDate flag and collection counts', async () => {
        const mcp = getMcpServer();
        const { data, isError } = await callTool(mcp, 'indexStatus')({
          workspaceId: wsWorkspaceId,
        });

        expect(isError).toBe(false);
        expect(data).toHaveProperty('upToDate');
        expect(data).toHaveProperty('needsEmbedding');
        expect(data).toHaveProperty('durationMs');
        expect(data).toHaveProperty('collections');
        expect(Array.isArray(data.collections)).toBe(true);
        expect(data.collections).toHaveLength(4);
      });

      it('should report unchanged files after an initial reindex', async () => {
        writeFixture('docs/stable.md', '---\ntitle: Stable\n---\n');

        const mcp = getMcpServer();
        await callTool(mcp, 'reindex')({ workspaceId: wsWorkspaceId, collection: 'docs' });

        const { data } = await callTool(mcp, 'indexStatus')({ workspaceId: wsWorkspaceId });
        const docs = data.collections.find(
          (c: { collection: string }) => c.collection === 'docs',
        );
        expect(docs.unchanged).toBeGreaterThan(0);
      });
    });

    describe('validateWorkspace', () => {
      it('should return error for non-existent workspace', async () => {
        const mcp = getMcpServer();
        const { isError, data } = await callTool(mcp, 'validateWorkspace')({ workspaceId: 9999 });

        expect(isError).toBe(true);
        expect(data.error).toContain('Workspace not found');
      });

      it('should return a report with summary for an empty workspace', async () => {
        const mcp = getMcpServer();
        const { data, isError } = await callTool(mcp, 'validateWorkspace')({
          workspaceId: wsWorkspaceId,
        });

        expect(isError).toBe(false);
        expect(data).toHaveProperty('workspaceId', wsWorkspaceId);
        expect(data).toHaveProperty('findings');
        expect(data).toHaveProperty('summary');
        expect(data.summary).toMatchObject({
          errors: expect.any(Number),
          warnings: expect.any(Number),
          infos: expect.any(Number),
          total: expect.any(Number),
        });
      });

      it('should detect broken link in linkedMemories', async () => {
        const db = getDb();
        db.insert(permanentMemories)
          .values({
            workspaceId: wsWorkspaceId,
            subtype: 'fact',
            title: 'Broken Link',
            content: 'body',
            filePath: 'memory/facts/broken.md',
            linkedMemories: ['memory/patterns/missing.md'],
          })
          .run();
        writeFixture('memory/facts/broken.md', '---\ntitle: Broken Link\nsubtype: fact\n---\n');

        const mcp = getMcpServer();
        const { data } = await callTool(mcp, 'validateWorkspace')({
          workspaceId: wsWorkspaceId,
        });

        const brokenLinks = data.findings.filter(
          (f: { check: string }) => f.check === 'broken-links',
        );
        expect(brokenLinks.length).toBeGreaterThan(0);
        expect(brokenLinks[0].severity).toBe('error');
        expect(brokenLinks[0].message).toContain('missing.md');
      });

      it('should detect orphaned permanentMemory row when file is missing on disk', async () => {
        const db = getDb();
        db.insert(permanentMemories)
          .values({
            workspaceId: wsWorkspaceId,
            subtype: 'fact',
            title: 'Orphan',
            content: 'body',
            filePath: 'memory/facts/orphan.md',
          })
          .run();

        const mcp = getMcpServer();
        const { data } = await callTool(mcp, 'validateWorkspace')({
          workspaceId: wsWorkspaceId,
        });

        const orphans = data.findings.filter(
          (f: { check: string }) => f.check === 'orphaned-content',
        );
        expect(orphans.length).toBeGreaterThan(0);
        expect(orphans[0].severity).toBe('error');
        expect(orphans[0].path).toBe('memory/facts/orphan.md');
      });

      it('should detect lifecycle inconsistency for promoted fleeting missing promotedFromId', async () => {
        const db = getDb();
        // Insert a fleeting marked as promoted but without a promotedFromId.
        // The FK schema uses onDelete: 'set null', so deleting the permanent sets
        // promotedFromId to null — that's the warning case we're testing here.
        db.insert(fleetingMemories)
          .values({
            workspaceId: wsWorkspaceId,
            content: 'A learning',
            type: 'capture',
            source: 'agent',
            promoted: true,
          })
          .run();

        const mcp = getMcpServer();
        const { data } = await callTool(mcp, 'validateWorkspace')({
          workspaceId: wsWorkspaceId,
        });

        const lcIssues = data.findings.filter(
          (f: { check: string }) => f.check === 'lifecycle-consistency',
        );
        expect(lcIssues.length).toBeGreaterThan(0);
        expect(lcIssues[0].severity).toBe('warning');
        expect(lcIssues[0].message).toContain('promotedFromId');
      });

      it('should detect schema compliance issue for memory file missing title', async () => {
        writeFixture(
          'memory/facts/202501010001-no-title.md',
          '---\nsubtype: fact\n---\n\nNo title here.\n',
        );
        await callTool(getMcpServer(), 'reindex')({
          workspaceId: wsWorkspaceId,
          collection: 'memory',
        });

        const mcp = getMcpServer();
        const { data } = await callTool(mcp, 'validateWorkspace')({
          workspaceId: wsWorkspaceId,
        });

        const schemaIssues = data.findings.filter(
          (f: { check: string }) => f.check === 'schema-compliance',
        );
        expect(
          schemaIssues.some((f: { message: string }) => f.message.includes('title')),
        ).toBe(true);
      });
    });
  });

  describe('search tool', () => {
    let wsId: number;
    let wsSlugForSearch: string;

    beforeEach(async () => {
      const caller = appRouter.createCaller({ state: ctx.state });
      const ws = await caller.workspace.create({ name: 'Search Test WS' });
      wsSlugForSearch = ws.slug;
      const db = getDb();
      const wsRow = db.select().from(workspaces).where(eq(workspaces.slug, ws.slug)).get()!;
      wsId = wsRow.id;
    });

    afterEach(() => {
      _resetStoreCache();
      vi.restoreAllMocks();
    });

    it('should return error when workspace not found', async () => {
      const mcp = getMcpServer();
      const { isError, data } = await callTool(mcp, 'search')({
        workspaceId: 99999,
        query: 'test',
      });
      expect(isError).toBe(true);
      expect(data.error).toContain('Workspace not found');
    });

    it('should return error when neither query nor filters provided', async () => {
      const mcp = getMcpServer();
      const { isError, data } = await callTool(mcp, 'search')({ workspaceId: wsId });
      expect(isError).toBe(true);
      expect(data.error).toContain('at least one of');
    });

    describe('filters-only mode', () => {
      it('should filter by task status', async () => {
        const db = getDb();
        const proj = db
          .insert(projects)
          .values({ workspaceId: wsId, name: 'P1', slug: 'p1-search' })
          .returning()
          .get();
        db.insert(tasks).values({ title: 'Done Task', projectId: proj.id, status: 'done' }).run();
        db.insert(tasks).values({ title: 'Todo Task', projectId: proj.id, status: 'todo' }).run();

        const mcp = getMcpServer();
        const { data, isError } = await callTool(mcp, 'search')({
          workspaceId: wsId,
          filters: { status: 'done' },
        });

        expect(isError).toBe(false);
        const taskGroup = data.find((g: { collection: string }) => g.collection === 'tasks');
        expect(taskGroup).toBeDefined();
        expect(taskGroup.results).toHaveLength(1);
        expect(taskGroup.results[0].title).toBe('Done Task');
      });

      it('should filter frontmatter by tags using JSON1 membership', async () => {
        const db = getDb();
        db.insert(frontmatter)
          .values({
            workspaceId: wsId,
            collection: 'memory',
            path: 'memory/facts/tagged.md',
            data: JSON.stringify({ title: 'Tagged Memory', tags: ['auth', 'security'] }),
            indexedAt: new Date().toISOString(),
          })
          .run();
        db.insert(frontmatter)
          .values({
            workspaceId: wsId,
            collection: 'memory',
            path: 'memory/facts/other.md',
            data: JSON.stringify({ title: 'Other Memory', tags: ['unrelated'] }),
            indexedAt: new Date().toISOString(),
          })
          .run();

        const mcp = getMcpServer();
        const { data, isError } = await callTool(mcp, 'search')({
          workspaceId: wsId,
          filters: { tags: ['auth'] },
        });

        expect(isError).toBe(false);
        const memGroup = data.find((g: { collection: string }) => g.collection === 'memory');
        expect(memGroup).toBeDefined();
        expect(memGroup.results).toHaveLength(1);
        expect(memGroup.results[0].title).toBe('Tagged Memory');
      });

      it('should filter by linkedMemories for reverse-link queries', async () => {
        const db = getDb();
        const targetPath = 'memory/facts/target.md';
        db.insert(frontmatter)
          .values({
            workspaceId: wsId,
            collection: 'memory',
            path: 'memory/facts/linker.md',
            data: JSON.stringify({ title: 'Linker Memory', linkedMemories: [targetPath] }),
            indexedAt: new Date().toISOString(),
          })
          .run();
        db.insert(frontmatter)
          .values({
            workspaceId: wsId,
            collection: 'memory',
            path: 'memory/facts/unlinked.md',
            data: JSON.stringify({ title: 'Unlinked', linkedMemories: [] }),
            indexedAt: new Date().toISOString(),
          })
          .run();

        const mcp = getMcpServer();
        const { data, isError } = await callTool(mcp, 'search')({
          workspaceId: wsId,
          filters: { linkedMemories: [targetPath] },
        });

        expect(isError).toBe(false);
        const memGroup = data.find((g: { collection: string }) => g.collection === 'memory');
        expect(memGroup).toBeDefined();
        expect(memGroup.results.some((r: { title: string }) => r.title === 'Linker Memory')).toBe(true);
        expect(memGroup.results.some((r: { title: string }) => r.title === 'Unlinked')).toBe(false);
      });

      it('should scope to collection when collection filter is provided', async () => {
        const db = getDb();
        db.insert(frontmatter)
          .values({
            workspaceId: wsId,
            collection: 'memory',
            path: 'memory/facts/mem.md',
            data: JSON.stringify({ title: 'Mem', tags: ['shared-tag'] }),
            indexedAt: new Date().toISOString(),
          })
          .run();
        db.insert(frontmatter)
          .values({
            workspaceId: wsId,
            collection: 'docs',
            path: 'docs/guide.md',
            data: JSON.stringify({ title: 'Guide', tags: ['shared-tag'] }),
            indexedAt: new Date().toISOString(),
          })
          .run();

        const mcp = getMcpServer();
        const { data, isError } = await callTool(mcp, 'search')({
          workspaceId: wsId,
          collection: 'memory',
          filters: { tags: ['shared-tag'] },
        });

        expect(isError).toBe(false);
        expect(data.every((g: { collection: string }) => g.collection === 'memory')).toBe(true);
      });
    });

    describe('query-only mode (QMD_SKIP=1)', () => {
      beforeEach(() => {
        process.env.QMD_SKIP = '1';
      });
      afterEach(() => {
        delete process.env.QMD_SKIP;
      });

      it('should search tasks by LIKE query', async () => {
        const db = getDb();
        const proj = db
          .insert(projects)
          .values({ workspaceId: wsId, name: 'P2', slug: 'p2-search' })
          .returning()
          .get();
        db.insert(tasks).values({ title: 'Fix auth bug', projectId: proj.id }).run();
        db.insert(tasks).values({ title: 'Unrelated task', projectId: proj.id }).run();

        const mcp = getMcpServer();
        const { data, isError } = await callTool(mcp, 'search')({
          workspaceId: wsId,
          query: 'auth',
        });

        expect(isError).toBe(false);
        const taskGroup = data.find((g: { collection: string }) => g.collection === 'tasks');
        expect(taskGroup).toBeDefined();
        expect(taskGroup.results.some((r: { title: string }) => r.title === 'Fix auth bug')).toBe(true);
      });

      it('should return empty results when nothing matches', async () => {
        const mcp = getMcpServer();
        const { data, isError } = await callTool(mcp, 'search')({
          workspaceId: wsId,
          query: 'zzz-no-match-ever',
        });

        expect(isError).toBe(false);
        expect(data).toEqual([]);
      });
    });

    describe('query + filters mode (QMD_SKIP=1)', () => {
      beforeEach(() => {
        process.env.QMD_SKIP = '1';
      });
      afterEach(() => {
        delete process.env.QMD_SKIP;
      });

      it('should apply task status filter when both query and filters provided', async () => {
        const db = getDb();
        const proj = db
          .insert(projects)
          .values({ workspaceId: wsId, name: 'P3', slug: 'p3-search' })
          .returning()
          .get();
        db.insert(tasks).values({ title: 'Done Auth Task', projectId: proj.id, status: 'done' }).run();
        db.insert(tasks).values({ title: 'Todo Auth Task', projectId: proj.id, status: 'todo' }).run();

        const mcp = getMcpServer();
        const { data, isError } = await callTool(mcp, 'search')({
          workspaceId: wsId,
          query: 'auth',
          filters: { status: 'done' },
        });

        expect(isError).toBe(false);
        const taskGroup = data.find((g: { collection: string }) => g.collection === 'tasks');
        expect(taskGroup).toBeDefined();
        expect(taskGroup.results).toHaveLength(1);
        expect(taskGroup.results[0].title).toBe('Done Auth Task');
      });
    });
  });
});
