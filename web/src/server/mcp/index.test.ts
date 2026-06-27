import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi, type MockedFunction } from 'vitest';
import { eq } from 'drizzle-orm';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { getMcpServer, activeSessions, evictIdleSessions, touchSession } from './index';
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
    // Mirror the production call path: validate + apply the tool's schema defaults
    // before invoking the handler. On invalid input, fall through with the raw
    // params so error-path assertions still reach the handler.
    const tool = tools[name];
    const parsed = tool.inputSchema?.safeParse?.(params);
    const args = parsed?.success ? parsed.data : params;
    const result = await tool.handler(args, {} as any);
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

  describe('[FR-MCP-060] getMcpServer', () => {
    it('[FR-MCP-060] should return a fresh McpServer instance each call', () => {
      const server1 = getMcpServer();
      const server2 = getMcpServer();
      expect(server1).not.toBe(server2);
    });
  });

  describe('workspace tools', () => {
    it('[FR-WORKSPACE-110] listWorkspaces should return all workspaces with id, name, slug', async () => {
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

    it('[FR-WORKSPACE-110] listWorkspaces should return empty array when no workspaces', async () => {
      const mcp = getMcpServer();
      const call = callTool(mcp, 'listWorkspaces');
      const { data } = await call();
      expect(data).toEqual([]);
    });

    it('[FR-WORKSPACE-110] listProjects should return all projects when no filter', async () => {
      const db = getDb();
      const ws = db.insert(workspaces).values({ name: 'W1', slug: 'w1' }).returning().get();
      db.insert(projects).values({ workspaceId: ws.id, name: 'P1', slug: 'p1' }).run();
      db.insert(projects).values({ workspaceId: ws.id, name: 'P2', slug: 'p2' }).run();

      const mcp = getMcpServer();
      const call = callTool(mcp, 'listProjects');
      const { data } = await call();

      expect(data).toHaveLength(2);
    });

    it('[FR-WORKSPACE-110] listProjects should include slug and name', async () => {
      const db = getDb();
      const ws = db.insert(workspaces).values({ name: 'W1', slug: 'w1' }).returning().get();
      db.insert(projects).values({ workspaceId: ws.id, name: 'Initial', slug: 'initial' }).run();

      const mcp = getMcpServer();
      const call = callTool(mcp, 'listProjects');
      const { data } = await call();

      expect(data[0].name).toBe('Initial');
      expect(data[0].slug).toBe('initial');
    });

    it('[FR-WORKSPACE-110] listProjects should filter by workspaceId', async () => {
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

    it('[FR-WORKSPACE-110] listProjects should return empty array when workspace has no projects', async () => {
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

      it('[FR-TASK-020] should return error for non-existent dependency', async () => {
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

      it('[FR-TASK-020] should return error when any dependency does not exist', async () => {
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

      it('[FR-TASK-020] should return error for non-existent dependency', async () => {
        const db = getDb();
        const task = db.insert(tasks).values({ title: 'T1', projectId }).returning().get();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'updateTask');
        const { data, isError } = await call({ id: task.id, blockedBy: [9999] });

        expect(isError).toBe(true);
        expect(data.error).toContain('9999');
        expect(data.error).toContain('does not exist');
      });

      it('[FR-TASK-040] should return error for circular dependency', async () => {
        const db = getDb();
        const taskA = db.insert(tasks).values({ title: 'A', projectId }).returning().get();
        const taskB = db.insert(tasks).values({ title: 'B', projectId }).returning().get();
        db.insert(taskDependencies).values({ taskId: taskB.id, blockerTaskId: taskA.id }).run();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'updateTask');
        const { data, isError } = await call({ id: taskA.id, blockedBy: [taskB.id] });

        expect(isError).toBe(true);
        expect(data.error).toContain('Circular dependency');
      });

      it('[FR-TASK-140] should create fleeting memories on the task workspace when memories are passed', async () => {
        const db = getDb();
        const ws = db.select().from(workspaces).where(eq(workspaces.slug, 'test')).get()!;
        const task = db.insert(tasks).values({ title: 'Task with memories', projectId }).returning().get();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'updateTask');
        await call({
          id: task.id,
          memories: [
            { content: 'First learning from the task', type: 'capture' },
            { content: 'Second learning from the task', type: 'idea' },
          ],
        });

        const rows = db
          .select()
          .from(fleetingMemories)
          .where(eq(fleetingMemories.workspaceId, ws.id))
          .all();
        expect(rows).toHaveLength(2);
        expect(rows.find((r) => r.content === 'First learning from the task')?.type).toBe('capture');
        expect(rows.find((r) => r.content === 'Second learning from the task')?.type).toBe('idea');
        expect(rows.every((r) => r.source === 'agent')).toBe(true);
      });

      it('[FR-TASK-140] should be a no-op for memories when the task has no projectId', async () => {
        const db = getDb();
        // Create a task without a projectId so there is no workspace to scope memories to
        const task = db.insert(tasks).values({ title: 'Unscoped task' }).returning().get();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'updateTask');
        const { data, isError } = await call({
          id: task.id,
          memories: [{ content: 'This should not be stored', type: 'capture' }],
        });

        expect(isError).toBe(false);
        expect(data).toEqual({ success: true });
        const rows = db.select().from(fleetingMemories).all();
        expect(rows).toHaveLength(0);
      });
    });

    describe('listTasks', () => {
      it('[FR-TASK-120] should omit description by default (compact)', async () => {
        const db = getDb();
        db.insert(tasks).values({ title: 'T1', projectId, description: 'Details here' }).run();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'listTasks');
        const { data } = await call({ projectId });

        expect(data).toHaveLength(1);
        expect(data[0].title).toBe('T1');
        expect(data[0]).not.toHaveProperty('description');
      });

      it('[FR-TASK-120] should include description when compact is false', async () => {
        const db = getDb();
        db.insert(tasks).values({ title: 'T1', projectId, description: 'Details here' }).run();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'listTasks');
        const { data } = await call({ projectId, compact: false });

        expect(data[0].description).toBe('Details here');
      });

      it('[FR-TASK-110] should filter by projectId', async () => {
        const db = getDb();
        db.insert(tasks).values({ title: 'T1', projectId }).run();
        db.insert(tasks).values({ title: 'T2', projectId }).run();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'listTasks');
        const { data } = await call({ projectId });

        expect(data).toHaveLength(2);
      });

      it('[FR-TASK-110] should return all tasks when no filter', async () => {
        const db = getDb();
        db.insert(tasks).values({ title: 'T1', projectId }).run();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'listTasks');
        const { data } = await call();

        expect(data).toHaveLength(1);
      });

      it('[FR-TASK-110] should filter by milestoneRef', async () => {
        const db = getDb();
        db.insert(tasks).values({ title: 'T1', projectId, milestoneRef: 'm1' }).run();
        db.insert(tasks).values({ title: 'T2', projectId }).run();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'listTasks');
        const { data } = await call({ milestoneRef: 'm1' });

        expect(data).toHaveLength(1);
        expect(data[0].title).toBe('T1');
      });

      it('[FR-TASK-110] should filter by taskGroupId', async () => {
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

      it('[FR-TASK-110] should combine milestoneRef AND taskGroupId filters', async () => {
        const db = getDb();
        const grp = db
          .insert(taskGroups)
          .values({ milestoneRef: 'm1', name: 'G1' })
          .returning()
          .get();
        db.insert(tasks)
          .values({ title: 'A', projectId, milestoneRef: 'm1', taskGroupId: grp.id })
          .run();
        db.insert(tasks).values({ title: 'B', projectId, milestoneRef: 'm1' }).run();
        db.insert(tasks)
          .values({ title: 'C', projectId, milestoneRef: 'm2', taskGroupId: grp.id })
          .run();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'listTasks');
        const { data } = await call({ milestoneRef: 'm1', taskGroupId: grp.id });

        expect(data).toHaveLength(1);
        expect(data[0].title).toBe('A');
      });

      it('[FR-TASK-110] should combine projectId AND milestoneRef filters', async () => {
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
      it('[FR-TASK-130] should return a task by ID', async () => {
        const db = getDb();
        const task = db.insert(tasks).values({ title: 'T1', projectId }).returning().get();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'getTask');
        const { data } = await call({ id: task.id });

        expect(data.title).toBe('T1');
      });

      it('[FR-TASK-130] should return planContent when plan file exists', async () => {
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

      it('[FR-TASK-130] should return planContent as null when no plan file exists', async () => {
        const db = getDb();
        const task = db.insert(tasks).values({ title: 'T1', projectId }).returning().get();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'getTask');
        const { data } = await call({ id: task.id });

        expect(data.planContent).toBeNull();
      });

      it('[FR-TASK-130] should return planContent as null when task has no projectId', async () => {
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

      it('[FR-TASK-150] should assign sequential numInMilestone within a milestone', async () => {
        const db = getDb();
        const proj = db.select().from(projects).get();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'createTaskGroup');
        const { data: d1 } = await call({ projectId: proj!.id, milestoneRef, name: 'TG1' });
        const { data: d2 } = await call({ projectId: proj!.id, milestoneRef, name: 'TG2' });
        const { data: d3 } = await call({ projectId: proj!.id, milestoneRef, name: 'TG3' });

        const tg1 = db.select().from(taskGroups).where(eq(taskGroups.id, d1.id)).get();
        const tg2 = db.select().from(taskGroups).where(eq(taskGroups.id, d2.id)).get();
        const tg3 = db.select().from(taskGroups).where(eq(taskGroups.id, d3.id)).get();

        expect(tg1!.numInMilestone).toBe(1);
        expect(tg2!.numInMilestone).toBe(2);
        expect(tg3!.numInMilestone).toBe(3);
      });

      it('[FR-TASK-150] should restart at 1 for a different milestone', async () => {
        const db = getDb();
        const proj = db.select().from(projects).get();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'createTaskGroup');
        await call({ projectId: proj!.id, milestoneRef: 'm1', name: 'M1-TG1' });
        await call({ projectId: proj!.id, milestoneRef: 'm1', name: 'M1-TG2' });
        const { data: d } = await call({ projectId: proj!.id, milestoneRef: 'm2', name: 'M2-TG1' });

        const tg = db.select().from(taskGroups).where(eq(taskGroups.id, d.id)).get();
        expect(tg!.numInMilestone).toBe(1);
      });

      it('[FR-TASK-150] should number independently per project', async () => {
        const db = getDb();
        const ws = db.select().from(workspaces).get();
        const projB = db
          .insert(projects)
          .values({ workspaceId: ws!.id, name: 'P2', slug: 'p2' })
          .returning()
          .get();
        const projA = db.select().from(projects).where(eq(projects.slug, 'p1')).get();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'createTaskGroup');
        await call({ projectId: projA!.id, milestoneRef, name: 'A-TG1' });
        await call({ projectId: projA!.id, milestoneRef, name: 'A-TG2' });
        const { data: d } = await call({ projectId: projB.id, milestoneRef, name: 'B-TG1' });

        const tg = db.select().from(taskGroups).where(eq(taskGroups.id, d.id)).get();
        expect(tg!.numInMilestone).toBe(1);
      });

      it('[FR-TASK-150] delete should not renumber survivors', async () => {
        const db = getDb();
        const proj = db.select().from(projects).get();

        const mcp = getMcpServer();
        const create = callTool(mcp, 'createTaskGroup');
        await create({ projectId: proj!.id, milestoneRef, name: 'TG1' });
        const { data: d2 } = await create({ projectId: proj!.id, milestoneRef, name: 'TG2' });
        await create({ projectId: proj!.id, milestoneRef, name: 'TG3' });

        const del = callTool(mcp, 'deleteTaskGroup');
        await del({ id: d2.id });

        const list = callTool(mcp, 'listTaskGroups');
        const { data } = await list({ projectId: proj!.id, milestoneRef });
        const nums = (data as Array<{ numInMilestone: number }>).map((g) => g.numInMilestone).sort();
        expect(nums).toEqual([1, 3]);
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
      it('[FR-TASK-160] should return a task group by ID', async () => {
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

      it('[FR-TASK-160] should return error for missing group', async () => {
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
        const grp = db.insert(taskGroups).values({ milestoneRef, name: 'Old' }).returning().get();

        const mcp = getMcpServer();
        const call = callTool(mcp, 'updateTaskGroup');
        const { data } = await call({ id: grp.id, name: 'Frontend' });

        expect(data).toEqual({ success: true });
        const updated = db.select().from(taskGroups).where(eq(taskGroups.id, grp.id)).get();
        expect(updated!.name).toBe('Frontend');
      });

      it('should update status', async () => {
        const db = getDb();
        const grp = db.insert(taskGroups).values({ milestoneRef, name: 'G1' }).returning().get();

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
        const grp = db.insert(taskGroups).values({ milestoneRef, name: 'G1' }).returning().get();

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

    it('[FR-MEMORY-010] createFleetingMemory should create a memory', async () => {
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

    it('createFleetingMemory should persist sources when provided', async () => {
      const mcp = getMcpServer();
      const call = callTool(mcp, 'createFleetingMemory');
      const sources = ['memory/sources/ref-a.md', 'memory/references/ref-b.md'];
      const { data } = await call({
        workspaceId,
        content: 'Distilled from sources',
        type: 'capture',
        source: 'agent',
        tags: [],
        sources,
      });

      expect(data.sources).toEqual(sources);
    });

    it('createFleetingMemory should default sources to empty array when not provided', async () => {
      const mcp = getMcpServer();
      const call = callTool(mcp, 'createFleetingMemory');
      const { data } = await call({
        workspaceId,
        content: 'No sources',
        type: 'capture',
        source: 'agent',
        tags: [],
      });

      expect(data.sources).toEqual([]);
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

  describe('writeSourceSnapshot tool', () => {
    let workspaceId: number;
    let wsSlug: string;

    beforeEach(async () => {
      const caller = appRouter.createCaller({ state: ctx.state });
      const ws = await caller.workspace.create({ name: 'Snapshot Test WS' });
      wsSlug = ws.slug;
      const db = getDb();
      const wsRow = db.select().from(workspaces).where(eq(workspaces.slug, wsSlug)).get()!;
      workspaceId = wsRow.id;
    });

    it('[FR-MEMORY-130] should write a source file with provenance frontmatter', async () => {
      const mcp = getMcpServer();
      const { data, isError } = await callTool(mcp, 'writeSourceSnapshot')({
        workspaceId,
        title: 'Auth Research Article',
        content: 'Body content of the article about authentication.',
        sourceType: 'web',
        url: 'https://example.com/auth',
        origin: 'example.com',
        ingestedAt: '2026-01-01T00:00:00.000Z',
      });

      expect(isError).toBe(false);
      expect(data).toHaveProperty('filePath');
      expect(data.reused).toBe(false);

      const wsDir = path.join(ctx.tmpDir, wsSlug);
      const absPath = path.join(wsDir, data.filePath);
      expect(fs.existsSync(absPath)).toBe(true);

      const raw = fs.readFileSync(absPath, 'utf8');
      expect(raw).toContain('Auth Research Article');
      expect(raw).toContain('source_type: web');
      expect(raw).toContain('origin: example.com');
      expect(raw).toContain('ingester: mcp');
      expect(raw).toContain('content_hash:');
    });

    it('[FR-MEMORY-120] should return reused:true and no duplicate file for identical content', async () => {
      const body = 'Exactly identical content for MCP dedup test.';
      const mcp = getMcpServer();
      const call = callTool(mcp, 'writeSourceSnapshot');

      const { data: first, isError: firstErr } = await call({
        workspaceId,
        title: 'First Ingest',
        content: body,
        sourceType: 'paste',
      });
      expect(firstErr).toBe(false);
      expect(first.reused).toBe(false);

      const { data: second, isError: secondErr } = await call({
        workspaceId,
        title: 'Second Ingest Same Body',
        content: body,
        sourceType: 'paste',
      });
      expect(secondErr).toBe(false);
      expect(second.filePath).toBe(first.filePath);
      expect(second.reused).toBe(true);

      const wsDir = path.join(ctx.tmpDir, wsSlug);
      const sourcesDir = path.join(wsDir, 'memory', 'sources');
      const snapshots = fs.readdirSync(sourcesDir).filter((f) => f.endsWith('.md') && f !== 'README.md');
      expect(snapshots).toHaveLength(1);
    });
  });

  describe('updatePermanentMemory tool', () => {
    let workspaceId: number;
    let wsSlug: string;

    beforeEach(async () => {
      const caller = appRouter.createCaller({ state: ctx.state });
      const ws = await caller.workspace.create({ name: 'Update PM Test WS' });
      wsSlug = ws.slug;
      const db = getDb();
      const wsRow = db.select().from(workspaces).where(eq(workspaces.slug, wsSlug)).get()!;
      workspaceId = wsRow.id;
    });

    afterEach(() => {
      _resetStoreCache();
    });

    it('should set supersededById in DB and write supersededBy path to frontmatter', async () => {
      process.env.QMD_SKIP = '1';
      try {
        const db = getDb();

        // Create the "old" memory via the MCP createPermanentMemory tool so it has a file.
        const mcp = getMcpServer();
        const { data: oldData } = await callTool(mcp, 'createPermanentMemory')({
          workspaceId,
          subtype: 'fact',
          title: 'Old Fact',
          content: 'This is the old fact body.',
          keywords: ['old', 'fact'],
        });
        expect(oldData).toHaveProperty('filePath');

        const { data: newData } = await callTool(getMcpServer(), 'createPermanentMemory')({
          workspaceId,
          subtype: 'fact',
          title: 'New Fact',
          content: 'This is the replacement fact.',
        });
        expect(newData).toHaveProperty('filePath');

        const oldRow = db.select().from(permanentMemories).where(eq(permanentMemories.id, oldData.id)).get()!;
        const newRow = db.select().from(permanentMemories).where(eq(permanentMemories.id, newData.id)).get()!;

        // Update old memory to be superseded by new memory.
        const { data: updateResult, isError } = await callTool(getMcpServer(), 'updatePermanentMemory')({
          id: oldRow.id,
          supersededById: newRow.id,
        });

        expect(isError).toBe(false);
        expect(updateResult.success).toBe(true);

        // DB column must be set.
        const afterUpdate = db.select().from(permanentMemories).where(eq(permanentMemories.id, oldRow.id)).get()!;
        expect(afterUpdate.supersededById).toBe(newRow.id);

        // Markdown frontmatter must contain supersededBy with the new memory's path.
        const wsDir = path.join(ctx.tmpDir, wsSlug);
        const raw = fs.readFileSync(path.join(wsDir, oldRow.filePath!), 'utf8');
        expect(raw).toContain('supersededBy:');
        expect(raw).toContain(newRow.filePath!);
      } finally {
        delete process.env.QMD_SKIP;
      }
    });
  });

  describe('listMemories scope param', () => {
    let workspaceId: number;

    beforeEach(() => {
      const db = getDb();
      const ws = db.insert(workspaces).values({ name: 'Scope Test WS', slug: 'scope-test' }).returning().get();
      workspaceId = ws.id;
    });

    it('default scope (fleeting) returns only fleeting memories as flat array', async () => {
      const db = getDb();
      db.insert(fleetingMemories)
        .values({ workspaceId, content: 'A fleeting', type: 'capture', source: 'agent' })
        .run();
      db.insert(permanentMemories)
        .values({
          workspaceId,
          subtype: 'fact',
          title: 'A Permanent',
          content: 'Some fact',
          filePath: 'memory/facts/a-permanent.md',
        })
        .run();

      const mcp = getMcpServer();
      const { data } = await callTool(mcp, 'listMemories')({ workspaceId });

      // Flat array — fleeting-only backward-compat
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(1);
      expect(data[0]).not.toHaveProperty('subtype');
    });

    it('scope:permanent returns permanent rows with subtype, title, and keywords', async () => {
      const db = getDb();
      db.insert(permanentMemories)
        .values({
          workspaceId,
          subtype: 'fact',
          title: 'Cache Expiry Fact',
          content: 'All caches expire.',
          filePath: 'memory/facts/cache-expiry.md',
          keywords: ['cache', 'expiry'],
        })
        .run();

      const mcp = getMcpServer();
      const { data } = await callTool(mcp, 'listMemories')({ workspaceId, scope: 'permanent' });

      // Returns { permanent: [...] }
      expect(data).toHaveProperty('permanent');
      expect(Array.isArray(data.permanent)).toBe(true);
      expect(data.permanent).toHaveLength(1);
      const row = data.permanent[0];
      expect(row.subtype).toBe('fact');
      expect(row.title).toBe('Cache Expiry Fact');
      expect(row.keywords).toEqual(['cache', 'expiry']);
    });

    it('scope:both returns both fleeting and permanent arrays', async () => {
      const db = getDb();
      db.insert(fleetingMemories)
        .values({ workspaceId, content: 'Fleeting thought', type: 'idea', source: 'user' })
        .run();
      db.insert(permanentMemories)
        .values({
          workspaceId,
          subtype: 'insight',
          title: 'Permanent insight',
          content: 'An important insight.',
          filePath: 'memory/insights/permanent-insight.md',
        })
        .run();

      const mcp = getMcpServer();
      const { data } = await callTool(mcp, 'listMemories')({ workspaceId, scope: 'both' });

      expect(data).toHaveProperty('fleeting');
      expect(data).toHaveProperty('permanent');
      expect(data.fleeting).toHaveLength(1);
      expect(data.permanent).toHaveLength(1);
    });

    it('scope:permanent compact:false includes content field', async () => {
      const db = getDb();
      db.insert(permanentMemories)
        .values({
          workspaceId,
          subtype: 'convention',
          title: 'Test Convention',
          content: 'Always write tests.',
          filePath: 'memory/conventions/test-convention.md',
        })
        .run();

      const mcp = getMcpServer();
      const { data } = await callTool(mcp, 'listMemories')({
        workspaceId,
        scope: 'permanent',
        compact: false,
      });

      expect(data.permanent[0].content).toBe('Always write tests.');
    });

    it('scope:permanent compact:true (default) omits content', async () => {
      const db = getDb();
      db.insert(permanentMemories)
        .values({
          workspaceId,
          subtype: 'pattern',
          title: 'Repo Pattern',
          content: 'Use repository pattern.',
          filePath: 'memory/patterns/repo-pattern.md',
        })
        .run();

      const mcp = getMcpServer();
      const { data } = await callTool(mcp, 'listMemories')({ workspaceId, scope: 'permanent' });

      expect(data.permanent[0]).not.toHaveProperty('content');
    });
  });

  describe('promoteMemory tool', () => {
    let wsId: number;
    let wsSlug: string;

    beforeEach(async () => {
      const caller = appRouter.createCaller({ state: ctx.state });
      const ws = await caller.workspace.create({ name: 'Promote Test WS' });
      wsSlug = ws.slug;
      const db = getDb();
      const wsRow = db.select().from(workspaces).where(eq(workspaces.slug, wsSlug)).get()!;
      wsId = wsRow.id;
    });

    afterEach(() => {
      _resetStoreCache();
      vi.restoreAllMocks();
    });

    it('[FR-MEMORY-100] should return permanentMemoryId, filePath, and linkedMemories on success (QMD_SKIP=1)', async () => {
      process.env.QMD_SKIP = '1';
      try {
        const db = getDb();
        const fleeting = db
          .insert(fleetingMemories)
          .values({ workspaceId: wsId, content: 'A key insight', type: 'capture', source: 'agent' })
          .returning()
          .get();

        const mcp = getMcpServer();
        const { data, isError } = await callTool(mcp, 'promoteMemory')({
          fleetingMemoryId: fleeting.id,
          subtype: 'insight',
          title: 'Key Insight',
          keywords: ['insight'],
          themes: ['learning'],
          tags: [],
        });

        expect(isError).toBe(false);
        expect(data).toHaveProperty('permanentMemoryId');
        expect(data).toHaveProperty('filePath');
        expect(data).toHaveProperty('linkedMemories');
        expect(Array.isArray(data.linkedMemories)).toBe(true);
        // QMD_SKIP means autoLink returns immediately with no links
        expect(data.linkedMemories).toEqual([]);
      } finally {
        delete process.env.QMD_SKIP;
      }
    });

    it('[FR-MEMORY-150] should populate linkedMemories when autoLink finds siblings', async () => {
      if (process.env.QMD_SKIP === '1') return;

      const db = getDb();

      // Create an existing permanent memory that autoLink can find
      const sibling = db
        .insert(permanentMemories)
        .values({
          workspaceId: wsId,
          subtype: 'fact',
          title: 'Related Fact',
          content: 'Related content about the same topic',
          filePath: 'memory/facts/related-fact.md',
          linkedMemories: [],
        })
        .returning()
        .get();

      // Mock getStore to return the sibling as a high-score candidate
      mockGetStore.mockResolvedValue({
        search: async () => [
          {
            file: 'qmd://memory/facts/related-fact.md',
            displayPath: 'memory/facts/related-fact.md',
            title: 'Related Fact',
            score: 0.9,
          },
        ],
      } as any);

      const fleeting = db
        .insert(fleetingMemories)
        .values({
          workspaceId: wsId,
          content: 'A key insight about the same topic',
          type: 'capture',
          source: 'agent',
        })
        .returning()
        .get();

      // Write the sibling file so autoLink can read and update it
      const wsDir = path.join(ctx.tmpDir, wsSlug);
      const siblingPath = path.join(wsDir, 'memory', 'facts', 'related-fact.md');
      fs.mkdirSync(path.dirname(siblingPath), { recursive: true });
      fs.writeFileSync(
        siblingPath,
        '---\ntitle: Related Fact\nsubtype: fact\nlinkedMemories: []\n---\n\nRelated content.\n',
        'utf8',
      );

      const mcp = getMcpServer();
      const { data, isError } = await callTool(mcp, 'promoteMemory')({
        fleetingMemoryId: fleeting.id,
        subtype: 'insight',
        title: 'Key Insight',
        keywords: ['insight', 'topic'],
        themes: ['learning'],
        tags: [],
      });

      expect(isError).toBe(false);
      expect(Array.isArray(data.linkedMemories)).toBe(true);
      expect(data.linkedMemories.length).toBeGreaterThan(0);
      expect(data.linkedMemories.some((p: string) => p.includes('related-fact'))).toBe(true);

      // Verify DB row was also updated with the linked sibling
      const promoted = db
        .select()
        .from(permanentMemories)
        .where(eq(permanentMemories.id, data.permanentMemoryId))
        .get();
      expect((promoted?.linkedMemories as string[]).length).toBeGreaterThan(0);

      // Cleanup mock
      mockGetStore.mockReset();
      void sibling;
    }, 30000);

    it('should use provided content when content override is supplied', async () => {
      process.env.QMD_SKIP = '1';
      try {
        const db = getDb();
        const fleeting = db
          .insert(fleetingMemories)
          .values({ workspaceId: wsId, content: 'Raw fleeting content', type: 'capture', source: 'agent' })
          .returning()
          .get();

        const mcp = getMcpServer();
        const { data, isError } = await callTool(mcp, 'promoteMemory')({
          fleetingMemoryId: fleeting.id,
          subtype: 'insight',
          title: 'Refined Insight',
          content: 'Refined content for the permanent memory.',
        });

        expect(isError).toBe(false);
        const promoted = db
          .select()
          .from(permanentMemories)
          .where(eq(permanentMemories.id, data.permanentMemoryId))
          .get();
        expect(promoted?.content).toBe('Refined content for the permanent memory.');
      } finally {
        delete process.env.QMD_SKIP;
      }
    });

    it('should fall back to fleeting content when no content override is supplied', async () => {
      process.env.QMD_SKIP = '1';
      try {
        const db = getDb();
        const fleeting = db
          .insert(fleetingMemories)
          .values({ workspaceId: wsId, content: 'Original fleeting content', type: 'capture', source: 'agent' })
          .returning()
          .get();

        const mcp = getMcpServer();
        const { data, isError } = await callTool(mcp, 'promoteMemory')({
          fleetingMemoryId: fleeting.id,
          subtype: 'insight',
          title: 'Insight without override',
        });

        expect(isError).toBe(false);
        const promoted = db
          .select()
          .from(permanentMemories)
          .where(eq(permanentMemories.id, data.permanentMemoryId))
          .get();
        expect(promoted?.content).toBe('Original fleeting content');
      } finally {
        delete process.env.QMD_SKIP;
      }
    });
  });

  describe('updatePermanentMemory subtype relocation', () => {
    let wsId: number;
    let wsSlug: string;
    let wsDir: string;

    beforeEach(async () => {
      const caller = appRouter.createCaller({ state: ctx.state });
      const ws = await caller.workspace.create({ name: 'Update Subtype WS' });
      wsSlug = ws.slug;
      const db = getDb();
      const wsRow = db.select().from(workspaces).where(eq(workspaces.slug, wsSlug)).get()!;
      wsId = wsRow.id;
      wsDir = path.join(ctx.tmpDir, wsSlug);
    });

    afterEach(() => {
      _resetStoreCache();
    });

    it('should move the file to the new subtype dir when subtype changes', async () => {
      process.env.QMD_SKIP = '1';
      try {
        const mcp = getMcpServer();
        const { data: createData } = await callTool(mcp, 'createPermanentMemory')({
          workspaceId: wsId,
          subtype: 'fact',
          title: 'Relocatable Memory',
          content: 'Body to relocate.',
        });

        const originalFilePath: string = createData.filePath;
        expect(originalFilePath).toMatch(/^memory\/facts\//);

        const { data: updateData, isError } = await callTool(getMcpServer(), 'updatePermanentMemory')({
          id: createData.id,
          subtype: 'decision',
        });

        expect(isError).toBe(false);
        expect(updateData.filePath).toMatch(/^memory\/decisions\//);
        expect(updateData.filePath).not.toBe(originalFilePath);

        expect(fs.existsSync(path.join(wsDir, updateData.filePath))).toBe(true);
        expect(fs.existsSync(path.join(wsDir, originalFilePath))).toBe(false);

        // Verify DB row has the new filePath
        const db = getDb();
        const row = db
          .select({ filePath: permanentMemories.filePath })
          .from(permanentMemories)
          .where(eq(permanentMemories.id, createData.id))
          .get();
        expect(row?.filePath).toBe(updateData.filePath);
      } finally {
        delete process.env.QMD_SKIP;
      }
    });

    it('should keep filePath unchanged when subtype is not modified', async () => {
      process.env.QMD_SKIP = '1';
      try {
        const mcp = getMcpServer();
        const { data: createData } = await callTool(mcp, 'createPermanentMemory')({
          workspaceId: wsId,
          subtype: 'pattern',
          title: 'Stable Pattern',
          content: 'Body stays.',
        });

        const { data: updateData } = await callTool(getMcpServer(), 'updatePermanentMemory')({
          id: createData.id,
          title: 'Stable Pattern updated',
        });

        expect(updateData.filePath).toBe(createData.filePath);
      } finally {
        delete process.env.QMD_SKIP;
      }
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
      }, 30000);

      it('should report unchanged files after an initial reindex', async () => {
        writeFixture('docs/stable.md', '---\ntitle: Stable\n---\n');

        const mcp = getMcpServer();
        await callTool(mcp, 'reindex')({ workspaceId: wsWorkspaceId, collection: 'docs' });

        const { data } = await callTool(mcp, 'indexStatus')({ workspaceId: wsWorkspaceId });
        const docs = data.collections.find(
          (c: { collection: string }) => c.collection === 'docs',
        );
        expect(docs.unchanged).toBeGreaterThan(0);
      }, 30000);
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
      }, 30000);

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
      }, 30000);

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
      }, 30000);

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
      }, 30000);

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
      }, 30000);
    });
  });

  describe('search tool', () => {
    let wsId: number;

    beforeEach(async () => {
      const caller = appRouter.createCaller({ state: ctx.state });
      const ws = await caller.workspace.create({ name: 'Search Test WS' });
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

      it('should return only tasks and not frontmatter docs when status is the sole filter', async () => {
        const db = getDb();
        const proj = db
          .insert(projects)
          .values({ workspaceId: wsId, name: 'P1b', slug: 'p1b-search' })
          .returning()
          .get();
        db.insert(tasks).values({ title: 'Found Task', projectId: proj.id, status: 'done' }).run();
        db.insert(frontmatter)
          .values({
            workspaceId: wsId,
            collection: 'docs',
            path: 'docs/should-not-appear.md',
            data: JSON.stringify({ title: 'Should Not Appear' }),
            indexedAt: new Date().toISOString(),
          })
          .run();

        const mcp = getMcpServer();
        const { data, isError } = await callTool(mcp, 'search')({
          workspaceId: wsId,
          filters: { status: 'done' },
        });

        expect(isError).toBe(false);
        const collections = data.map((g: { collection: string }) => g.collection);
        expect(collections).not.toContain('docs');
        expect(collections).not.toContain('memory');
        const taskGroup = data.find((g: { collection: string }) => g.collection === 'tasks');
        expect(taskGroup).toBeDefined();
        expect(taskGroup.results.some((r: { title: string }) => r.title === 'Found Task')).toBe(true);
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

    describe('query-only mode with mocked qmd store', () => {
      beforeEach(() => {
        delete process.env.QMD_SKIP;
      });
      afterEach(() => {
        delete process.env.QMD_SKIP;
        mockGetStore.mockReset();
        vi.restoreAllMocks();
      });

      function mockQmdSearch(
        hits: Array<{ file: string; displayPath: string; title: string; bestChunk: string; score: number }>,
      ) {
        mockGetStore.mockResolvedValue({
          search: vi.fn().mockResolvedValue(hits),
          searchLex: vi.fn().mockResolvedValue([]),
          searchVector: vi.fn().mockResolvedValue([]),
        } as unknown as Awaited<ReturnType<typeof import('../search/qmd-store').getStore>>);
      }

      it('should replace slug title with frontmatter title when present', async () => {
        const db = getDb();
        db.insert(frontmatter)
          .values({
            workspaceId: wsId,
            collection: 'memory',
            path: 'memory/decisions/20260610221554-jwt-access-tokens-rotate-every-15-minutes.md',
            data: JSON.stringify({ title: 'JWT access tokens rotate every 15 minutes' }),
            indexedAt: new Date().toISOString(),
          })
          .run();

        mockQmdSearch([
          {
            file: 'qmd://memory/decisions/20260610221554-jwt-access-tokens-rotate-every-15-minutes.md',
            displayPath: 'memory/decisions/20260610221554-jwt-access-tokens-rotate-every-15-minutes.md',
            title: '20260610221554-jwt-access-tokens-rotate-every-15-minutes',
            bestChunk: 'JWT tokens expire after 15 minutes.',
            score: 0.88,
          },
        ]);

        const mcp = getMcpServer();
        const { data, isError } = await callTool(mcp, 'search')({
          workspaceId: wsId,
          query: 'JWT token rotation',
        });

        expect(isError).toBe(false);
        const memGroup = data.find((g: { collection: string }) => g.collection === 'memory');
        expect(memGroup).toBeDefined();
        expect(memGroup.results[0].title).toBe('JWT access tokens rotate every 15 minutes');
      });

      it('should fall back to qmd title when no frontmatter row exists', async () => {
        mockQmdSearch([
          {
            file: 'qmd://docs/no-frontmatter.md',
            displayPath: 'docs/no-frontmatter.md',
            title: 'qmd title',
            bestChunk: 'Some content.',
            score: 0.7,
          },
        ]);

        const mcp = getMcpServer();
        const { data, isError } = await callTool(mcp, 'search')({
          workspaceId: wsId,
          query: 'content',
        });

        expect(isError).toBe(false);
        const docsGroup = data.find((g: { collection: string }) => g.collection === 'docs');
        expect(docsGroup!.results[0].title).toBe('qmd title');
      });

      it('should drop readme.md hits from query results', async () => {
        mockQmdSearch([
          {
            file: 'qmd://memory/decisions/readme.md',
            displayPath: 'memory/decisions/readme.md',
            title: 'Decisions README',
            bestChunk: 'Table of contents.',
            score: 0.93,
          },
          {
            file: 'qmd://memory/decisions/20260610-jwt-rotation.md',
            displayPath: 'memory/decisions/20260610-jwt-rotation.md',
            title: 'JWT rotation',
            bestChunk: 'Rotate every 15 minutes.',
            score: 0.82,
          },
        ]);

        const mcp = getMcpServer();
        const { data, isError } = await callTool(mcp, 'search')({
          workspaceId: wsId,
          query: 'JWT rotation',
        });

        expect(isError).toBe(false);
        const memGroup = data.find((g: { collection: string }) => g.collection === 'memory');
        const paths = (memGroup?.results ?? []).map((r: { path: string }) => r.path);
        expect(paths).not.toContain('memory/decisions/readme.md');
        expect(paths).toContain('memory/decisions/20260610-jwt-rotation.md');
      });

      it('should fall back to path-derived title when qmd hit has no title', async () => {
        mockQmdSearch([
          {
            file: 'qmd://docs/my-doc.md',
            displayPath: 'docs/my-doc.md',
            title: '',
            bestChunk: 'Some content.',
            score: 0.7,
          },
        ]);

        const mcp = getMcpServer();
        const { data, isError } = await callTool(mcp, 'search')({
          workspaceId: wsId,
          query: 'content',
        });

        expect(isError).toBe(false);
        const docsGroup = data.find((g: { collection: string }) => g.collection === 'docs');
        expect(docsGroup!.results[0].title).toBe('my doc');
      });

      it('should drop README.MD hits case-insensitively', async () => {
        mockQmdSearch([
          {
            file: 'qmd://docs/README.MD',
            displayPath: 'docs/README.MD',
            title: 'Docs index',
            bestChunk: 'Overview.',
            score: 0.91,
          },
          {
            file: 'qmd://docs/guide.md',
            displayPath: 'docs/guide.md',
            title: 'Guide',
            bestChunk: 'The guide.',
            score: 0.75,
          },
        ]);

        const mcp = getMcpServer();
        const { data, isError } = await callTool(mcp, 'search')({
          workspaceId: wsId,
          query: 'guide',
        });

        expect(isError).toBe(false);
        const docsGroup = data.find((g: { collection: string }) => g.collection === 'docs');
        const paths = (docsGroup?.results ?? []).map((r: { path: string }) => r.path);
        expect(paths).not.toContain('docs/README.MD');
        expect(paths).toContain('docs/guide.md');
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

  describe('[FR-MCP-090] trace tool', () => {
    function seedTraceWorkspace(): number {
      const db = getDb();
      const codeDir = path.join(ctx.tmpDir, 'repo');
      const src = path.join(codeDir, 'src');
      fs.mkdirSync(src, { recursive: true });
      fs.writeFileSync(path.join(src, 'rank.ts'), 'export const rank = () => {};');
      fs.writeFileSync(
        path.join(src, 'rank.test.ts'),
        `it('[FR-SEARCH-001] ranks by score', () => {});`,
      );

      const ws = db
        .insert(workspaces)
        .values({ name: 'Trace WS', slug: 'trace-ws', repos: [codeDir] })
        .returning()
        .get();

      const featuresDir = path.join(ctx.tmpDir, ws.slug, 'system', 'features');
      fs.mkdirSync(featuresDir, { recursive: true });
      fs.writeFileSync(
        path.join(featuresDir, 'search.md'),
        `## Requirements\n\n| ID | Requirement (EARS) |\n|----|----|\n| FR-SEARCH-001 | The system SHALL rank by score. |\n| FR-SEARCH-002 | The system SHALL anchor on filters. |\n`,
      );
      return ws.id;
    }

    it('[FR-MCP-090] should trace an FR to its tests and colocated source', async () => {
      const wsId = seedTraceWorkspace();
      const { data, isError } = await callTool(getMcpServer(), 'trace')({
        workspaceId: wsId,
        fr: 'FR-SEARCH-001',
      });
      expect(isError).toBe(false);
      expect(data.kind).toBe('fr');
      expect(data.covered).toBe(true);
      expect(data.sources).toEqual(['src/rank.ts']);
    });

    it('[FR-MCP-095] should return a coverage summary with no fr/file', async () => {
      const wsId = seedTraceWorkspace();
      const { data } = await callTool(getMcpServer(), 'trace')({ workspaceId: wsId });
      expect(data.kind).toBe('summary');
      expect(data.uncovered).toEqual(['FR-SEARCH-002']);
    });

    it('should error for an unknown workspace', async () => {
      const { isError } = await callTool(getMcpServer(), 'trace')({ workspaceId: 99999 });
      expect(isError).toBe(true);
    });
  });

  describe('setWorkspaceEarsBdd tool', () => {
    it('[FR-WORKSPACE-115] should toggle earsBdd in the DB and workspace.yaml', async () => {
      const caller = appRouter.createCaller({ state: ctx.state });
      const created = await caller.workspace.create({ name: 'Ears MCP' });
      const db = getDb();
      const ws = db.select().from(workspaces).where(eq(workspaces.slug, created.slug)).get()!;

      const { data, isError } = await callTool(getMcpServer(), 'setWorkspaceEarsBdd')({
        workspaceId: ws.id,
        enabled: true,
      });
      expect(isError).toBe(false);
      expect(data.earsBdd).toBe(true);

      const row = db.select().from(workspaces).where(eq(workspaces.id, ws.id)).get()!;
      expect(row.earsBdd).toBe(true);

      const yamlPath = path.join(ctx.tmpDir, ws.slug, 'workspace.yaml');
      expect(fs.readFileSync(yamlPath, 'utf-8')).toContain('earsBdd: true');
    });

    it('[FR-WORKSPACE-115] should error for an unknown workspace', async () => {
      const { isError } = await callTool(getMcpServer(), 'setWorkspaceEarsBdd')({
        workspaceId: 99999,
        enabled: true,
      });
      expect(isError).toBe(true);
    });
  });
});

// Mirrors SESSION_IDLE_TTL_MS in index.ts (private constant).
const SESSION_IDLE_TTL_MS = 30 * 60_000;

function fakeTransport() {
  const close = vi.fn();
  return { transport: { close } as unknown as StreamableHTTPServerTransport, close };
}

describe('[FR-MCP-080] session reaper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    activeSessions.clear();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    activeSessions.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('[FR-MCP-080] evictIdleSessions', () => {
    it('[FR-MCP-080] should close and remove a session idle past the TTL', () => {
      const { transport, close } = fakeTransport();
      activeSessions.set('idle', transport);
      touchSession('idle');

      vi.advanceTimersByTime(SESSION_IDLE_TTL_MS + 1);
      evictIdleSessions();

      expect(close).toHaveBeenCalledOnce();
      expect(activeSessions.has('idle')).toBe(false);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('idle'));
    });

    it('[FR-MCP-080] should retain a session active within the TTL', () => {
      const { transport, close } = fakeTransport();
      activeSessions.set('fresh', transport);
      touchSession('fresh');

      vi.advanceTimersByTime(SESSION_IDLE_TTL_MS - 1);
      evictIdleSessions();

      expect(close).not.toHaveBeenCalled();
      expect(activeSessions.has('fresh')).toBe(true);
    });

    it('[FR-MCP-080] should evict only the idle session in a mixed set', () => {
      const idle = fakeTransport();
      activeSessions.set('idle', idle.transport);
      touchSession('idle');

      vi.advanceTimersByTime(SESSION_IDLE_TTL_MS + 1);

      const fresh = fakeTransport();
      activeSessions.set('fresh', fresh.transport);
      touchSession('fresh');

      evictIdleSessions();

      expect(idle.close).toHaveBeenCalledOnce();
      expect(activeSessions.has('idle')).toBe(false);
      expect(fresh.close).not.toHaveBeenCalled();
      expect(activeSessions.has('fresh')).toBe(true);
    });

    it('[FR-MCP-080] should retain a session with no recorded activity (treated as just-seen)', () => {
      const { transport, close } = fakeTransport();
      activeSessions.set('unknown', transport);

      vi.advanceTimersByTime(SESSION_IDLE_TTL_MS + 1);
      evictIdleSessions();

      expect(close).not.toHaveBeenCalled();
      expect(activeSessions.has('unknown')).toBe(true);
    });
  });
});
