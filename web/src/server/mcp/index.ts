import type { Server as HttpServer, IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { eq, asc } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { getEngyDir } from '../db/client.js';
import {
  workspaces,
  projects,
  tasks,
  milestones,
  taskGroups,
  fleetingMemories,
} from '../db/schema.js';
import { generateSlug, uniqueWorkspaceSlug } from '../trpc/utils.js';

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
  registerMilestoneTools(mcp);
  registerTaskGroupTools(mcp);
  registerMemoryTools(mcp);
  registerFileTools(mcp);

  mcpInstance = mcp;
  return mcp;
}

/** Reset singleton for testing */
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

function getAllowedRoots(): string[] {
  const roots = [getEngyDir()];

  try {
    const db = getDb();
    const allWorkspaces = db.select().from(workspaces).all();
    for (const ws of allWorkspaces) {
      const wsDir = path.join(getEngyDir(), ws.slug);
      const yamlPath = path.join(wsDir, 'workspace.yaml');
      if (fs.existsSync(yamlPath)) {
        const content = fs.readFileSync(yamlPath, 'utf-8');
        const repoLines = content.split('\n').filter((l) => l.trim().startsWith('- path:'));
        for (const line of repoLines) {
          const repoPath = line.replace(/.*- path:\s*/, '').trim();
          if (repoPath) roots.push(repoPath);
        }
      }
    }
  } catch {
    // DB might not be ready yet — only engy dir allowed
  }

  return roots;
}

export function isPathAllowed(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  const roots = getAllowedRoots();
  return roots.some((root) => resolved.startsWith(path.resolve(root)));
}

// ── Tool Registration ──────────────────────────────────────────────

function registerWorkspaceTools(mcp: McpServer): void {
  mcp.tool(
    'createWorkspace',
    'Create a new workspace. Requires the client daemon for repo validation — will fail without it.',
    { name: z.string().describe('Workspace name') },
    async ({ name }) => {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              error: 'createWorkspace requires the client daemon for repo path validation. Use the web UI or tRPC API with an active daemon connection.',
              hint: 'Start the daemon with: pnpm --filter client dev',
            }),
          },
        ],
        isError: true,
      };
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
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Workspace "${slug}" not found` }) }],
          isError: true,
        };
      }

      const wsDir = path.join(getEngyDir(), slug);
      let config: string | null = null;
      const yamlPath = path.join(wsDir, 'workspace.yaml');
      if (fs.existsSync(yamlPath)) {
        config = fs.readFileSync(yamlPath, 'utf-8');
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ workspace, config }) }],
      };
    },
  );

  mcp.tool('listWorkspaces', 'List all workspaces', {}, async () => {
    const db = getDb();
    const result = db.select().from(workspaces).all();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    };
  });
}

function registerProjectTools(mcp: McpServer): void {
  mcp.tool(
    'createProject',
    'Create a new project within a workspace',
    {
      workspaceId: z.number().describe('Workspace ID'),
      name: z.string().describe('Project name'),
      specPath: z.string().optional().describe('Path to project specification'),
    },
    async ({ workspaceId, name, specPath }) => {
      const db = getDb();
      const slug = generateSlug(name);
      const project = db
        .insert(projects)
        .values({ workspaceId, name, slug, specPath })
        .returning()
        .get();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(project) }],
      };
    },
  );

  mcp.tool(
    'getProject',
    'Get a project by ID',
    { id: z.number().describe('Project ID') },
    async ({ id }) => {
      const db = getDb();
      const project = db.select().from(projects).where(eq(projects.id, id)).get();
      if (!project) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Project not found' }) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(project) }],
      };
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
      if (!result) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Project not found' }) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  mcp.tool(
    'listProjects',
    'List all projects in a workspace',
    { workspaceId: z.number().describe('Workspace ID') },
    async ({ workspaceId }) => {
      const db = getDb();
      const result = db
        .select()
        .from(projects)
        .where(eq(projects.workspaceId, workspaceId))
        .all();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );
}

function registerTaskTools(mcp: McpServer): void {
  mcp.tool(
    'createTask',
    'Create a new task',
    {
      projectId: z.number().optional().describe('Project ID'),
      milestoneId: z.number().optional().describe('Milestone ID'),
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
      const db = getDb();
      const task = db
        .insert(tasks)
        .values({
          projectId: args.projectId,
          milestoneId: args.milestoneId,
          taskGroupId: args.taskGroupId,
          title: args.title,
          description: args.description,
          type: args.type,
          importance: args.importance,
          urgency: args.urgency,
          dependencies: args.dependencies,
          specId: args.specId,
        })
        .returning()
        .get();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(task) }],
      };
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
      milestoneId: z.number().nullable().optional().describe('New milestone ID'),
      taskGroupId: z.number().nullable().optional().describe('New task group ID'),
    },
    async ({ id, ...updates }) => {
      const db = getDb();
      const result = db
        .update(tasks)
        .set({ ...updates, updatedAt: new Date().toISOString() })
        .where(eq(tasks.id, id))
        .returning()
        .get();
      if (!result) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Task not found' }) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  mcp.tool(
    'listTasks',
    'List tasks, optionally filtered by project, milestone, or task group',
    {
      projectId: z.number().optional().describe('Filter by project ID'),
      milestoneId: z.number().optional().describe('Filter by milestone ID'),
      taskGroupId: z.number().optional().describe('Filter by task group ID'),
    },
    async ({ projectId, milestoneId, taskGroupId }) => {
      const db = getDb();
      let result;

      if (taskGroupId) {
        result = db.select().from(tasks).where(eq(tasks.taskGroupId, taskGroupId)).all();
      } else if (milestoneId) {
        result = db.select().from(tasks).where(eq(tasks.milestoneId, milestoneId)).all();
      } else if (projectId) {
        result = db.select().from(tasks).where(eq(tasks.projectId, projectId)).all();
      } else {
        result = db.select().from(tasks).all();
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  mcp.tool(
    'getTask',
    'Get a task by ID',
    { id: z.number().describe('Task ID') },
    async ({ id }) => {
      const db = getDb();
      const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
      if (!task) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Task not found' }) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(task) }],
      };
    },
  );
}

function registerMilestoneTools(mcp: McpServer): void {
  mcp.tool(
    'createMilestone',
    'Create a new milestone within a project',
    {
      projectId: z.number().describe('Project ID'),
      title: z.string().describe('Milestone title'),
      scope: z.string().optional().describe('Milestone scope description'),
      sortOrder: z.number().optional().describe('Sort order'),
    },
    async ({ projectId, title, scope, sortOrder }) => {
      const db = getDb();
      const milestone = db
        .insert(milestones)
        .values({ projectId, title, scope, sortOrder: sortOrder ?? 0 })
        .returning()
        .get();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(milestone) }],
      };
    },
  );

  mcp.tool(
    'listMilestones',
    'List milestones for a project',
    { projectId: z.number().describe('Project ID') },
    async ({ projectId }) => {
      const db = getDb();
      const result = db
        .select()
        .from(milestones)
        .where(eq(milestones.projectId, projectId))
        .orderBy(asc(milestones.sortOrder))
        .all();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );
}

function registerTaskGroupTools(mcp: McpServer): void {
  mcp.tool(
    'createTaskGroup',
    'Create a new task group within a milestone',
    {
      milestoneId: z.number().describe('Milestone ID'),
      name: z.string().describe('Task group name'),
      repos: z.array(z.string()).optional().describe('Repository paths'),
    },
    async ({ milestoneId, name, repos }) => {
      const db = getDb();
      const group = db
        .insert(taskGroups)
        .values({ milestoneId, name, repos })
        .returning()
        .get();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(group) }],
      };
    },
  );

  mcp.tool(
    'listTaskGroups',
    'List task groups for a milestone',
    { milestoneId: z.number().describe('Milestone ID') },
    async ({ milestoneId }) => {
      const db = getDb();
      const result = db
        .select()
        .from(taskGroups)
        .where(eq(taskGroups.milestoneId, milestoneId))
        .all();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
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
    async ({ workspaceId, content, type, source, projectId, tags }) => {
      const db = getDb();
      const memory = db
        .insert(fleetingMemories)
        .values({ workspaceId, content, type, source, projectId, tags })
        .returning()
        .get();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(memory) }],
      };
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
      let result;

      if (projectId) {
        result = db
          .select()
          .from(fleetingMemories)
          .where(eq(fleetingMemories.projectId, projectId))
          .all();
      } else if (workspaceId) {
        result = db
          .select()
          .from(fleetingMemories)
          .where(eq(fleetingMemories.workspaceId, workspaceId))
          .all();
      } else {
        result = db.select().from(fleetingMemories).all();
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );
}

function registerFileTools(mcp: McpServer): void {
  mcp.tool(
    'readFile',
    'Read a file from an allowed path (engy dir or workspace repo)',
    { path: z.string().describe('Absolute path to the file') },
    async ({ path: filePath }) => {
      if (!isPathAllowed(filePath)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'Path not allowed. Only files within the engy directory or workspace repos are accessible.',
              }),
            },
          ],
          isError: true,
        };
      }

      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'File not found' }) }],
          isError: true,
        };
      }

      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Path is not a file' }) }],
          isError: true,
        };
      }

      const content = fs.readFileSync(resolved, 'utf-8');
      return {
        content: [{ type: 'text' as const, text: content }],
      };
    },
  );

  mcp.tool(
    'listDirectory',
    'List directory contents from an allowed path (engy dir or workspace repo)',
    { path: z.string().describe('Absolute path to the directory') },
    async ({ path: dirPath }) => {
      if (!isPathAllowed(dirPath)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'Path not allowed. Only directories within the engy directory or workspace repos are accessible.',
              }),
            },
          ],
          isError: true,
        };
      }

      const resolved = path.resolve(dirPath);
      if (!fs.existsSync(resolved)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Directory not found' }) }],
          isError: true,
        };
      }

      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Path is not a directory' }) }],
          isError: true,
        };
      }

      const entries = fs.readdirSync(resolved, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
      }));

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(entries) }],
      };
    },
  );
}
