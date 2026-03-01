import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getMcpServer, resetMcpServer, isPathAllowed } from './index';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { getDb } from '../db/client';
import {
  workspaces,
  projects,
  tasks,
  milestones,
  taskGroups,
  fleetingMemories,
} from '../db/schema';

describe('MCP Server', () => {
  let ctx: TestContext;

  beforeEach(() => {
    resetMcpServer();
    ctx = setupTestDb();
  });

  afterEach(() => {
    resetMcpServer();
    ctx.cleanup();
  });

  describe('getMcpServer', () => {
    it('should return a singleton McpServer instance', () => {
      const server1 = getMcpServer();
      const server2 = getMcpServer();
      expect(server1).toBe(server2);
    });

    it('should return a new instance after reset', () => {
      const server1 = getMcpServer();
      resetMcpServer();
      const server2 = getMcpServer();
      expect(server1).not.toBe(server2);
    });
  });

  describe('isPathAllowed', () => {
    it('should allow paths under the engy dir', () => {
      const engyDir = ctx.tmpDir;
      expect(isPathAllowed(path.join(engyDir, 'some-file.txt'))).toBe(true);
    });

    it('should reject paths outside allowed roots', () => {
      expect(isPathAllowed('/etc/passwd')).toBe(false);
    });

    it('should reject path traversal attempts', () => {
      const engyDir = ctx.tmpDir;
      expect(isPathAllowed(path.join(engyDir, '..', '..', 'etc', 'passwd'))).toBe(false);
    });
  });

  describe('workspace tools', () => {
    it('createWorkspace should create a workspace without repos', async () => {
      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['createWorkspace'];
      expect(tool).toBeDefined();

      const result = await tool.handler({ name: 'test', repos: [] }, {} as any);
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.name).toBe('test');
      expect(data.slug).toBe('test');
    });

    it('createWorkspace should return error when repos provided but no daemon', async () => {
      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['createWorkspace'];

      const result = await tool.handler({ name: 'test-ws', repos: ['/some/path'] }, {} as any);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('daemon');
    });

    it('listWorkspaces should return empty array when no workspaces', async () => {
      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['listWorkspaces'];

      const result = await tool.handler({}, {} as any);
      const data = JSON.parse(result.content[0].text);
      expect(data).toEqual([]);
    });

    it('listWorkspaces should return workspaces from DB', async () => {
      const db = getDb();
      db.insert(workspaces).values({ name: 'Test WS', slug: 'test-ws' }).run();

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['listWorkspaces'];

      const result = await tool.handler({}, {} as any);
      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveLength(1);
      expect(data[0].slug).toBe('test-ws');
    });

    it('getWorkspaceConfig should return workspace and config', async () => {
      const db = getDb();
      db.insert(workspaces).values({ name: 'Test WS', slug: 'test-ws' }).run();

      const wsDir = path.join(ctx.tmpDir, 'test-ws');
      fs.mkdirSync(wsDir, { recursive: true });
      fs.writeFileSync(path.join(wsDir, 'workspace.yaml'), 'name: Test WS\nslug: test-ws\n');

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['getWorkspaceConfig'];

      const result = await tool.handler({ slug: 'test-ws' }, {} as any);
      const data = JSON.parse(result.content[0].text);
      expect(data.workspace.slug).toBe('test-ws');
      expect(data.config).toContain('name: Test WS');
    });

    it('getWorkspaceConfig should return error for missing workspace', async () => {
      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['getWorkspaceConfig'];

      const result = await tool.handler({ slug: 'nonexistent' }, {} as any);
      expect(result.isError).toBe(true);
    });
  });

  describe('project tools', () => {
    let workspaceId: number;

    beforeEach(() => {
      const db = getDb();
      const ws = db.insert(workspaces).values({ name: 'Test', slug: 'test' }).returning().get();
      workspaceId = ws.id;
    });

    it('createProject should create a project', async () => {
      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['createProject'];

      const result = await tool.handler({ workspaceId, name: 'My Project' }, {} as any);
      const data = JSON.parse(result.content[0].text);
      expect(data.name).toBe('My Project');
      expect(data.slug).toBe('my-project');
    });

    it('getProject should return project by ID', async () => {
      const db = getDb();
      const proj = db
        .insert(projects)
        .values({ workspaceId, name: 'P1', slug: 'p1' })
        .returning()
        .get();

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['getProject'];

      const result = await tool.handler({ id: proj.id }, {} as any);
      const data = JSON.parse(result.content[0].text);
      expect(data.name).toBe('P1');
    });

    it('getProject should return error for missing project', async () => {
      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['getProject'];

      const result = await tool.handler({ id: 9999 }, {} as any);
      expect(result.isError).toBe(true);
    });

    it('updateProjectStatus should update status', async () => {
      const db = getDb();
      const proj = db
        .insert(projects)
        .values({ workspaceId, name: 'P1', slug: 'p1' })
        .returning()
        .get();

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['updateProjectStatus'];

      const result = await tool.handler({ id: proj.id, status: 'active' }, {} as any);
      const data = JSON.parse(result.content[0].text);
      expect(data.status).toBe('active');
    });

    it('updateProjectStatus should return error for missing project', async () => {
      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['updateProjectStatus'];

      const result = await tool.handler({ id: 9999, status: 'active' }, {} as any);
      expect(result.isError).toBe(true);
    });

    it('getWorkspaceConfig should return null config when yaml does not exist', async () => {
      const db = getDb();
      db.insert(workspaces).values({ name: 'No YAML', slug: 'no-yaml' }).run();

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['getWorkspaceConfig'];

      const result = await tool.handler({ slug: 'no-yaml' }, {} as any);
      const data = JSON.parse(result.content[0].text);
      expect(data.workspace.slug).toBe('no-yaml');
      expect(data.config).toBeNull();
    });

    it('listProjects should return projects for a workspace', async () => {
      const db = getDb();
      db.insert(projects).values({ workspaceId, name: 'P1', slug: 'p1' }).run();
      db.insert(projects).values({ workspaceId, name: 'P2', slug: 'p2' }).run();

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['listProjects'];

      const result = await tool.handler({ workspaceId }, {} as any);
      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveLength(2);
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
        { title: 'Do something', projectId, type: 'human', importance: 'not_important', urgency: 'not_urgent', dependencies: [] },
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

    it('listTasks should filter by milestoneId', async () => {
      const db = getDb();
      const ms = db.insert(milestones).values({ projectId, title: 'M1' }).returning().get();
      db.insert(tasks).values({ title: 'T1', projectId, milestoneId: ms.id }).run();
      db.insert(tasks).values({ title: 'T2', projectId }).run();

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['listTasks'];

      const result = await tool.handler({ milestoneId: ms.id }, {} as any);
      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveLength(1);
      expect(data[0].title).toBe('T1');
    });

    it('listTasks should filter by taskGroupId', async () => {
      const db = getDb();
      const ms = db.insert(milestones).values({ projectId, title: 'M1' }).returning().get();
      const grp = db.insert(taskGroups).values({ milestoneId: ms.id, name: 'G1' }).returning().get();
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
        { title: 'Bad Dep', projectId, type: 'human', importance: 'not_important', urgency: 'not_urgent', dependencies: [9999] },
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
        { title: 'Mixed Deps', projectId, type: 'human', importance: 'not_important', urgency: 'not_urgent', dependencies: [existing.id, 8888] },
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

      const result = await tool.handler({ id: task.id, dependencies: [9999] }, {} as any);
      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toContain('9999');
      expect(data.error).toContain('does not exist');
    });

    it('updateTask should return error for circular dependency', async () => {
      const db = getDb();
      const taskA = db.insert(tasks).values({ title: 'A', projectId }).returning().get();
      const taskB = db
        .insert(tasks)
        .values({ title: 'B', projectId, dependencies: [taskA.id] })
        .returning()
        .get();

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['updateTask'];

      const result = await tool.handler({ id: taskA.id, dependencies: [taskB.id] }, {} as any);
      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toContain('Circular dependency');
    });
  });

  describe('milestone tools', () => {
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

    it('createMilestone should create a milestone', async () => {
      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['createMilestone'];

      const result = await tool.handler({ projectId, title: 'M1' }, {} as any);
      const data = JSON.parse(result.content[0].text);
      expect(data.title).toBe('M1');
      expect(data.status).toBe('planned');
    });

    it('listMilestones should return milestones ordered by sortOrder', async () => {
      const db = getDb();
      db.insert(milestones).values({ projectId, title: 'M2', sortOrder: 2 }).run();
      db.insert(milestones).values({ projectId, title: 'M1', sortOrder: 1 }).run();

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['listMilestones'];

      const result = await tool.handler({ projectId }, {} as any);
      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveLength(2);
      expect(data[0].title).toBe('M1');
      expect(data[1].title).toBe('M2');
    });
  });

  describe('task group tools', () => {
    let milestoneId: number;

    beforeEach(() => {
      const db = getDb();
      const ws = db.insert(workspaces).values({ name: 'Test', slug: 'test' }).returning().get();
      const proj = db
        .insert(projects)
        .values({ workspaceId: ws.id, name: 'P1', slug: 'p1' })
        .returning()
        .get();
      const ms = db
        .insert(milestones)
        .values({ projectId: proj.id, title: 'M1' })
        .returning()
        .get();
      milestoneId = ms.id;
    });

    it('createTaskGroup should create a task group', async () => {
      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['createTaskGroup'];

      const result = await tool.handler({ milestoneId, name: 'Group 1' }, {} as any);
      const data = JSON.parse(result.content[0].text);
      expect(data.name).toBe('Group 1');
      expect(data.status).toBe('planned');
    });

    it('listTaskGroups should return groups for a milestone', async () => {
      const db = getDb();
      db.insert(taskGroups).values({ milestoneId, name: 'G1' }).run();
      db.insert(taskGroups).values({ milestoneId, name: 'G2' }).run();

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['listTaskGroups'];

      const result = await tool.handler({ milestoneId }, {} as any);
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

  describe('file tools', () => {
    it('readFile should return file contents for allowed paths', async () => {
      const filePath = path.join(ctx.tmpDir, 'test.txt');
      fs.writeFileSync(filePath, 'hello world');

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['readFile'];

      const result = await tool.handler({ path: filePath }, {} as any);
      expect(result.content[0].text).toBe('hello world');
      expect(result.isError).toBeUndefined();
    });

    it('readFile should reject paths outside allowed roots', async () => {
      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['readFile'];

      const result = await tool.handler({ path: '/etc/passwd' }, {} as any);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not allowed');
    });

    it('readFile should return error for non-existent file', async () => {
      const filePath = path.join(ctx.tmpDir, 'nonexistent.txt');

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['readFile'];

      const result = await tool.handler({ path: filePath }, {} as any);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });

    it('readFile should reject reading a directory', async () => {
      const dirPath = path.join(ctx.tmpDir, 'subdir');
      fs.mkdirSync(dirPath);

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['readFile'];

      const result = await tool.handler({ path: dirPath }, {} as any);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not a file');
    });

    it('listDirectory should return directory entries', async () => {
      const dirPath = ctx.tmpDir;
      fs.writeFileSync(path.join(dirPath, 'file.txt'), 'hello');
      fs.mkdirSync(path.join(dirPath, 'subdir'));

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['listDirectory'];

      const result = await tool.handler({ path: dirPath }, {} as any);
      const data = JSON.parse(result.content[0].text);
      const fileEntry = data.find((e: any) => e.name === 'file.txt');
      const dirEntry = data.find((e: any) => e.name === 'subdir');
      expect(fileEntry).toEqual({ name: 'file.txt', type: 'file' });
      expect(dirEntry).toEqual({ name: 'subdir', type: 'directory' });
    });

    it('listDirectory should reject paths outside allowed roots', async () => {
      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['listDirectory'];

      const result = await tool.handler({ path: '/etc' }, {} as any);
      expect(result.isError).toBe(true);
    });

    it('listDirectory should return error for non-existent directory', async () => {
      const dirPath = path.join(ctx.tmpDir, 'nonexistent-dir');

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['listDirectory'];

      const result = await tool.handler({ path: dirPath }, {} as any);
      expect(result.isError).toBe(true);
    });

    it('listDirectory should reject listing a file', async () => {
      const filePath = path.join(ctx.tmpDir, 'file.txt');
      fs.writeFileSync(filePath, 'hello');

      const mcp = getMcpServer();
      const tools = (mcp as any)._registeredTools;
      const tool = tools['listDirectory'];

      const result = await tool.handler({ path: filePath }, {} as any);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not a directory');
    });
  });
});
