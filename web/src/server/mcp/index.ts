import type { Server as HttpServer, IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, getEngyDir } from '../db/client';
import {
  workspaces,
  projects,
  tasks,
  taskGroups,
  fleetingMemories,
} from '../db/schema';
import { generateSlug, uniqueProjectSlug } from '../trpc/utils';
import { getAppState } from '../trpc/context';
import { getWorkspaceDir } from '../engy-dir/init';
import {
  listSpecs,
  createSpec,
  getSpec,
  updateSpec,
  readContextFile,
  writeContextFile,
} from '../spec/service';
import { validateDependencies } from '../tasks/validation';

// ── MCP Response Helpers ──────────────────────────────────────────

type McpToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function mcpResult(data: unknown): McpToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

function mcpError(message: string): McpToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }], isError: true };
}

function mcpText(text: string): McpToolResult {
  return { content: [{ type: 'text' as const, text }] };
}

// ── Singleton McpServer ────────────────────────────────────────────

let mcpInstance: McpServer | null = null;

export function getMcpServer(): McpServer {
  if (mcpInstance) return mcpInstance;

  const mcp = new McpServer(
    { name: 'engy', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  registerWorkspaceTools(mcp);
  registerProjectTools(mcp);
  registerTaskTools(mcp);
  registerTaskGroupTools(mcp);
  registerMemoryTools(mcp);
  registerFileTools(mcp);
  registerSpecTools(mcp);
  registerProjectPlanningTools(mcp);

  mcpInstance = mcp;
  return mcp;
}

export function resetMcpServer(): void {
  mcpInstance = null;
}

// ── HTTP Mount ─────────────────────────────────────────────────────

const activeSessions = new Map<string, SSEServerTransport>();

export function attachMCP(server: HttpServer): void {
  const mcp = getMcpServer();

  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname !== '/mcp') return;

    if (req.method === 'GET') {
      handleSseConnection(mcp, req, res);
    } else if (req.method === 'POST') {
      handlePostMessage(req, res);
    } else {
      res.writeHead(405).end('Method Not Allowed');
    }
  });
}

async function handleSseConnection(
  mcp: McpServer,
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const transport = new SSEServerTransport('/mcp', res);
  activeSessions.set(transport.sessionId, transport);

  transport.onclose = () => {
    activeSessions.delete(transport.sessionId);
  };

  await mcp.connect(transport);
}

async function handlePostMessage(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const sessionId = url.searchParams.get('sessionId');

  if (!sessionId) {
    res.writeHead(400).end(JSON.stringify({ error: 'Missing sessionId query parameter' }));
    return;
  }

  const transport = activeSessions.get(sessionId);
  if (!transport) {
    res.writeHead(404).end(JSON.stringify({ error: 'Session not found' }));
    return;
  }

  await transport.handlePostMessage(req, res);
}

// ── Path Safety ────────────────────────────────────────────────────

function resolvePath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    // For non-existent paths, resolve the nearest existing ancestor
    const dir = path.dirname(p);
    try {
      return path.join(fs.realpathSync(dir), path.basename(p));
    } catch {
      return path.resolve(p);
    }
  }
}

function getAllowedRoots(): string[] {
  const roots = [resolvePath(getEngyDir())];

  try {
    const db = getDb();
    const allWorkspaces = db.select().from(workspaces).all();
    for (const ws of allWorkspaces) {
      const repos = (ws.repos as string[]) ?? [];
      for (const repoPath of repos) {
        if (repoPath) roots.push(resolvePath(repoPath));
      }
      if (ws.docsDir) {
        roots.push(resolvePath(ws.docsDir));
      }
    }
  } catch {
    // DB might not be ready yet — only engy dir allowed
  }

  return roots;
}

export function isPathAllowed(targetPath: string): boolean {
  const resolved = resolvePath(targetPath);
  const roots = getAllowedRoots();
  return roots.some((root) => {
    const rel = path.relative(root, resolved);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  });
}

// ── Tool Registration ──────────────────────────────────────────────

function registerWorkspaceTools(mcp: McpServer): void {
  mcp.tool(
    'createWorkspace',
    'Create a new workspace with optional repo paths and docs directory.',
    {
      name: z.string().describe('Workspace name'),
      repos: z.array(z.string()).default([]).describe('Repository paths'),
      docsDir: z.string().optional().describe('Custom docs directory path'),
    },
    async ({ name, repos, docsDir }) => {
      const state = getAppState();
      if (repos.length > 0 && (!state.daemon || state.daemon.readyState !== 1)) {
        return mcpError(
          'createWorkspace with repos requires the client daemon for repo path validation. Start the daemon first.',
        );
      }

      try {
        const db = getDb();
        const slug = generateSlug(name);
        const workspace = db
          .insert(workspaces)
          .values({ name, slug, repos, docsDir: docsDir ?? null })
          .returning()
          .get();

        const { initWorkspaceDir } = await import('../engy-dir/init');
        initWorkspaceDir(name, slug, repos, docsDir);

        db.insert(projects)
          .values({ workspaceId: workspace.id, name: 'Default', slug: 'default', isDefault: true })
          .run();

        return mcpResult(workspace);
      } catch (err) {
        return mcpError(`Failed to create workspace: ${(err as Error).message}`);
      }
    },
  );

  mcp.tool(
    'getWorkspaceConfig',
    'Get workspace configuration by slug',
    { slug: z.string().describe('Workspace slug') },
    async ({ slug }) => {
      const db = getDb();
      const workspace = db.select().from(workspaces).where(eq(workspaces.slug, slug)).get();
      if (!workspace) {
        return mcpError(`Workspace "${slug}" not found`);
      }

      const wsDir = getWorkspaceDir(workspace);
      const yamlPath = path.join(wsDir, 'workspace.yaml');
      let config: unknown = null;
      if (fs.existsSync(yamlPath)) {
        config = yaml.load(fs.readFileSync(yamlPath, 'utf-8'));
      }

      return mcpResult({ workspace, config });
    },
  );

  mcp.tool('listWorkspaces', 'List all workspaces', {}, async () => {
    const db = getDb();
    return mcpResult(db.select().from(workspaces).all());
  });
}

function registerProjectTools(mcp: McpServer): void {
  mcp.tool(
    'createProject',
    'Create a new project within a workspace',
    {
      workspaceId: z.number().describe('Workspace ID'),
      name: z.string().describe('Project name'),
      projectDir: z.string().optional().describe('Path to project directory'),
    },
    async ({ workspaceId, name, projectDir }) => {
      const db = getDb();
      const slug = generateSlug(name);
      const project = db
        .insert(projects)
        .values({ workspaceId, name, slug, projectDir })
        .returning()
        .get();
      return mcpResult(project);
    },
  );

  mcp.tool(
    'getProject',
    'Get a project by ID',
    { id: z.number().describe('Project ID') },
    async ({ id }) => {
      const db = getDb();
      const project = db.select().from(projects).where(eq(projects.id, id)).get();
      if (!project) return mcpError('Project not found');
      return mcpResult(project);
    },
  );

  mcp.tool(
    'updateProjectStatus',
    'Update a project status',
    {
      id: z.number().describe('Project ID'),
      status: z.enum(['planning', 'active', 'completing', 'archived']).describe('New status'),
    },
    async ({ id, status }) => {
      const db = getDb();
      const result = db
        .update(projects)
        .set({ status, updatedAt: new Date().toISOString() })
        .where(eq(projects.id, id))
        .returning()
        .get();
      if (!result) return mcpError('Project not found');
      return mcpResult(result);
    },
  );

  mcp.tool(
    'listProjects',
    'List all projects in a workspace',
    { workspaceId: z.number().describe('Workspace ID') },
    async ({ workspaceId }) => {
      const db = getDb();
      return mcpResult(
        db.select().from(projects).where(eq(projects.workspaceId, workspaceId)).all(),
      );
    },
  );
}

function registerTaskTools(mcp: McpServer): void {
  mcp.tool(
    'createTask',
    'Create a new task',
    {
      projectId: z.number().optional().describe('Project ID'),
      milestoneRef: z.string().optional().describe('Milestone ref (e.g. "m1")'),
      taskGroupId: z.number().optional().describe('Task group ID'),
      title: z.string().describe('Task title'),
      description: z.string().optional().describe('Task description'),
      type: z.enum(['ai', 'human']).default('human').describe('Task type'),
      importance: z.enum(['important', 'not_important']).default('not_important').describe('Importance level'),
      urgency: z.enum(['urgent', 'not_urgent']).default('not_urgent').describe('Urgency level'),
      dependencies: z.array(z.number()).default([]).describe('IDs of tasks this depends on'),
      specId: z.string().optional().describe('Specification ID'),
    },
    async (args) => {
      try {
        validateDependencies(null, args.dependencies);
      } catch (err) {
        return mcpError((err as Error).message);
      }

      const db = getDb();
      const task = db.insert(tasks).values(args).returning().get();
      return mcpResult(task);
    },
  );

  mcp.tool(
    'updateTask',
    'Update an existing task',
    {
      id: z.number().describe('Task ID'),
      title: z.string().optional().describe('New title'),
      description: z.string().optional().describe('New description'),
      status: z.enum(['todo', 'in_progress', 'review', 'done']).optional().describe('New status'),
      type: z.enum(['ai', 'human']).optional().describe('New type'),
      importance: z.enum(['important', 'not_important']).optional().describe('New importance'),
      urgency: z.enum(['urgent', 'not_urgent']).optional().describe('New urgency'),
      dependencies: z.array(z.number()).optional().describe('New dependencies'),
      milestoneRef: z.string().nullable().optional().describe('New milestone ref (e.g. "m1")'),
      taskGroupId: z.number().nullable().optional().describe('New task group ID'),
    },
    async ({ id, ...updates }) => {
      if (updates.dependencies) {
        try {
          validateDependencies(id, updates.dependencies);
        } catch (err) {
          return mcpError((err as Error).message);
        }
      }

      const db = getDb();
      const result = db
        .update(tasks)
        .set({ ...updates, updatedAt: new Date().toISOString() })
        .where(eq(tasks.id, id))
        .returning()
        .get();
      if (!result) return mcpError('Task not found');
      return mcpResult(result);
    },
  );

  mcp.tool(
    'listTasks',
    'List tasks, optionally filtered by project, milestone, or task group',
    {
      projectId: z.number().optional().describe('Filter by project ID'),
      milestoneRef: z.string().optional().describe('Filter by milestone ref (e.g. "m1")'),
      taskGroupId: z.number().optional().describe('Filter by task group ID'),
    },
    async ({ projectId, milestoneRef, taskGroupId }) => {
      const db = getDb();
      const query = db.select().from(tasks);

      if (taskGroupId) return mcpResult(query.where(eq(tasks.taskGroupId, taskGroupId)).all());
      if (milestoneRef) return mcpResult(query.where(eq(tasks.milestoneRef, milestoneRef)).all());
      if (projectId) return mcpResult(query.where(eq(tasks.projectId, projectId)).all());
      return mcpResult(query.all());
    },
  );

  mcp.tool(
    'getTask',
    'Get a task by ID',
    { id: z.number().describe('Task ID') },
    async ({ id }) => {
      const db = getDb();
      const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
      if (!task) return mcpError('Task not found');
      return mcpResult(task);
    },
  );
}

function registerTaskGroupTools(mcp: McpServer): void {
  mcp.tool(
    'createTaskGroup',
    'Create a new task group within a milestone',
    {
      milestoneRef: z.string().describe('Milestone ref (e.g. "m1")'),
      name: z.string().describe('Task group name'),
      repos: z.array(z.string()).optional().describe('Repository paths'),
    },
    async ({ milestoneRef, name, repos }) => {
      const db = getDb();
      const group = db
        .insert(taskGroups)
        .values({ milestoneRef, name, repos })
        .returning()
        .get();
      return mcpResult(group);
    },
  );

  mcp.tool(
    'listTaskGroups',
    'List task groups for a milestone',
    { milestoneRef: z.string().describe('Milestone ref (e.g. "m1")') },
    async ({ milestoneRef }) => {
      const db = getDb();
      return mcpResult(
        db.select().from(taskGroups).where(eq(taskGroups.milestoneRef, milestoneRef)).all(),
      );
    },
  );
}

function registerMemoryTools(mcp: McpServer): void {
  mcp.tool(
    'createFleetingMemory',
    'Create a fleeting memory note for quick capture',
    {
      workspaceId: z.number().describe('Workspace ID'),
      content: z.string().describe('Memory content'),
      type: z
        .enum(['capture', 'question', 'blocker', 'idea', 'reference'])
        .default('capture')
        .describe('Memory type'),
      source: z.enum(['agent', 'user', 'system']).default('agent').describe('Memory source'),
      projectId: z.number().optional().describe('Project ID'),
      tags: z.array(z.string()).default([]).describe('Tags for organization'),
    },
    async (args) => {
      const db = getDb();
      const memory = db.insert(fleetingMemories).values(args).returning().get();
      return mcpResult(memory);
    },
  );

  mcp.tool(
    'listMemories',
    'List fleeting memories, optionally filtered by workspace or project',
    {
      workspaceId: z.number().optional().describe('Filter by workspace ID'),
      projectId: z.number().optional().describe('Filter by project ID'),
    },
    async ({ workspaceId, projectId }) => {
      const db = getDb();
      const query = db.select().from(fleetingMemories);

      if (projectId) return mcpResult(query.where(eq(fleetingMemories.projectId, projectId)).all());
      if (workspaceId) return mcpResult(query.where(eq(fleetingMemories.workspaceId, workspaceId)).all());
      return mcpResult(query.all());
    },
  );
}

function registerSpecTools(mcp: McpServer): void {
  mcp.tool(
    'listSpecs',
    'List all specs in a workspace',
    { workspaceSlug: z.string().describe('Workspace slug') },
    async ({ workspaceSlug }) => {
      const ws = getWorkspaceForMcp(workspaceSlug);
      if (!ws) return mcpError(`Workspace "${workspaceSlug}" not found`);
      return mcpResult(listSpecs(ws));
    },
  );

  mcp.tool(
    'createSpec',
    'Create a new spec in a workspace',
    {
      workspaceSlug: z.string().describe('Workspace slug'),
      title: z.string().describe('Spec title'),
      type: z.enum(['buildable', 'vision']).default('buildable').describe('Spec type'),
    },
    async ({ workspaceSlug, title, type }) => {
      const ws = getWorkspaceForMcp(workspaceSlug);
      if (!ws) return mcpError(`Workspace "${workspaceSlug}" not found`);
      try {
        return mcpResult(createSpec(ws, title, type));
      } catch (err) {
        return mcpError((err as Error).message);
      }
    },
  );

  mcp.tool(
    'getSpec',
    'Get full spec content including frontmatter and context files',
    {
      workspaceSlug: z.string().describe('Workspace slug'),
      specSlug: z.string().describe('Spec directory name'),
    },
    async ({ workspaceSlug, specSlug }) => {
      const ws = getWorkspaceForMcp(workspaceSlug);
      if (!ws) return mcpError(`Workspace "${workspaceSlug}" not found`);
      try {
        return mcpResult(getSpec(ws, specSlug));
      } catch (err) {
        return mcpError((err as Error).message);
      }
    },
  );

  mcp.tool(
    'updateSpec',
    'Update a spec (title, status, or body)',
    {
      workspaceSlug: z.string().describe('Workspace slug'),
      specSlug: z.string().describe('Spec directory name'),
      title: z.string().optional().describe('New title'),
      status: z.enum(['draft', 'ready', 'approved', 'active', 'completed']).optional().describe('New status'),
      body: z.string().optional().describe('New body content'),
    },
    async ({ workspaceSlug, specSlug, ...updates }) => {
      const ws = getWorkspaceForMcp(workspaceSlug);
      if (!ws) return mcpError(`Workspace "${workspaceSlug}" not found`);
      try {
        return mcpResult(updateSpec(ws, specSlug, updates));
      } catch (err) {
        return mcpError((err as Error).message);
      }
    },
  );

  mcp.tool(
    'readSpecFile',
    'Read a context file from a spec',
    {
      workspaceSlug: z.string().describe('Workspace slug'),
      specSlug: z.string().describe('Spec directory name'),
      filename: z.string().describe('Context file name'),
    },
    async ({ workspaceSlug, specSlug, filename }) => {
      const ws = getWorkspaceForMcp(workspaceSlug);
      if (!ws) return mcpError(`Workspace "${workspaceSlug}" not found`);
      try {
        return mcpText(readContextFile(ws, specSlug, filename));
      } catch (err) {
        return mcpError((err as Error).message);
      }
    },
  );

  mcp.tool(
    'writeSpecFile',
    'Write a context file to a spec',
    {
      workspaceSlug: z.string().describe('Workspace slug'),
      specSlug: z.string().describe('Spec directory name'),
      filename: z.string().describe('Context file name'),
      content: z.string().describe('File content'),
    },
    async ({ workspaceSlug, specSlug, filename, content }) => {
      const ws = getWorkspaceForMcp(workspaceSlug);
      if (!ws) return mcpError(`Workspace "${workspaceSlug}" not found`);
      try {
        writeContextFile(ws, specSlug, filename, content);
        return mcpResult({ success: true });
      } catch (err) {
        return mcpError((err as Error).message);
      }
    },
  );

  mcp.tool(
    'listSpecTasks',
    'List tasks associated with a spec',
    { specId: z.string().describe('Spec ID (directory name)') },
    async ({ specId }) => {
      const db = getDb();
      return mcpResult(db.select().from(tasks).where(eq(tasks.specId, specId)).all());
    },
  );

  mcp.tool(
    'createSpecTask',
    'Create a task associated with a spec',
    {
      specId: z.string().describe('Spec ID (directory name)'),
      title: z.string().describe('Task title'),
      description: z.string().optional().describe('Task description'),
    },
    async ({ specId, title, description }) => {
      const db = getDb();
      const task = db.insert(tasks).values({ title, description, specId }).returning().get();
      return mcpResult(task);
    },
  );
}

function registerProjectPlanningTools(mcp: McpServer): void {
  mcp.tool(
    'createProjectFromSpec',
    'Create a project from an approved spec. Transitions the spec to active status.',
    {
      workspaceSlug: z.string().describe('Workspace slug'),
      specSlug: z.string().describe('Spec directory name'),
    },
    async ({ workspaceSlug, specSlug }) => {
      const ws = getWorkspaceForMcp(workspaceSlug);
      if (!ws) return mcpError(`Workspace "${workspaceSlug}" not found`);

      try {
        const spec = getSpec(ws, specSlug);
        if (spec.frontmatter.status !== 'approved') {
          return mcpError('spec must be in approved status');
        }

        const db = getDb();
        const workspace = db
          .select()
          .from(workspaces)
          .where(eq(workspaces.slug, workspaceSlug))
          .get()!;

        const slug = uniqueProjectSlug(workspace.id, spec.frontmatter.title);
        const project = db
          .insert(projects)
          .values({
            workspaceId: workspace.id,
            name: spec.frontmatter.title,
            slug,
            projectDir: specSlug,
          })
          .returning()
          .get();

        updateSpec(ws, specSlug, { status: 'active' });
        return mcpResult(project);
      } catch (err) {
        return mcpError((err as Error).message);
      }
    },
  );

  mcp.tool(
    'listProjectTasks',
    'List all tasks for a project grouped by task group.',
    {
      projectId: z.number().describe('Project ID'),
    },
    async ({ projectId }) => {
      const db = getDb();

      const projectTasks = db
        .select()
        .from(tasks)
        .where(eq(tasks.projectId, projectId))
        .all();

      const projectGroups = db
        .select()
        .from(taskGroups)
        .all()
        .filter((g) => projectTasks.some((t) => t.taskGroupId === g.id));

      return mcpResult({
        taskGroups: projectGroups.map((g) => ({
          ...g,
          tasks: projectTasks.filter((t) => t.taskGroupId === g.id),
        })),
        ungroupedTasks: projectTasks.filter((t) => !t.taskGroupId),
      });
    },
  );

  mcp.tool(
    'getProjectOverview',
    'Get project details with task counts and status summary.',
    {
      projectId: z.number().describe('Project ID'),
    },
    async ({ projectId }) => {
      const db = getDb();

      const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
      if (!project) return mcpError('Project not found');

      const projectTasks = db
        .select()
        .from(tasks)
        .where(eq(tasks.projectId, projectId))
        .all();

      return mcpResult({
        ...project,
        taskCount: projectTasks.length,
        completedTasks: projectTasks.filter((t) => t.status === 'done').length,
      });
    },
  );
}

function getWorkspaceForMcp(slug: string) {
  const db = getDb();
  const ws = db.select().from(workspaces).where(eq(workspaces.slug, slug)).get();
  if (!ws) return null;
  return { slug: ws.slug, docsDir: ws.docsDir };
}

function registerFileTools(mcp: McpServer): void {
  mcp.tool(
    'readFile',
    'Read a file from an allowed path (engy dir or workspace repo)',
    { path: z.string().describe('Absolute path to the file') },
    async ({ path: filePath }) => {
      if (!isPathAllowed(filePath)) {
        return mcpError('Path not allowed. Only files within the engy directory or workspace repos are accessible.');
      }

      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) return mcpError('File not found');
      if (!fs.statSync(resolved).isFile()) return mcpError('Path is not a file');

      return mcpText(fs.readFileSync(resolved, 'utf-8'));
    },
  );

  mcp.tool(
    'listDirectory',
    'List directory contents from an allowed path (engy dir or workspace repo)',
    { path: z.string().describe('Absolute path to the directory') },
    async ({ path: dirPath }) => {
      if (!isPathAllowed(dirPath)) {
        return mcpError('Path not allowed. Only directories within the engy directory or workspace repos are accessible.');
      }

      const resolved = path.resolve(dirPath);
      if (!fs.existsSync(resolved)) return mcpError('Directory not found');
      if (!fs.statSync(resolved).isDirectory()) return mcpError('Path is not a directory');

      const entries = fs.readdirSync(resolved, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
      }));
      return mcpResult(entries);
    },
  );
}
