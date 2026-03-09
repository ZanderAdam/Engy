import type { Server as HttpServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { tasks, taskDependencies, taskGroups, fleetingMemories } from '../db/schema';
import { validateDependencies, attachBlockedBy } from '../tasks/validation';

// ── MCP Response Helpers ──────────────────────────────────────────

type McpToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function mcpResult(data: unknown): McpToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

function mcpError(message: string): McpToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }], isError: true };
}

// ── McpServer Factory ─────────────────────────────────────────────

export function getMcpServer(): McpServer {
  const mcp = new McpServer(
    { name: 'engy', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  registerTaskTools(mcp);
  registerTaskGroupTools(mcp);
  registerMemoryTools(mcp);

  return mcp;
}

// ── HTTP Mount ─────────────────────────────────────────────────────

const activeSessions = new Map<string, StreamableHTTPServerTransport>();

export function attachMCP(server: HttpServer): void {
  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname !== '/mcp') return;

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (req.method === 'POST') {
      const transport = sessionId ? activeSessions.get(sessionId) : undefined;
      if (transport) {
        transport.handleRequest(req, res);
      } else {
        handleNewSession(req, res);
      }
    } else if (req.method === 'GET') {
      if (!sessionId) {
        res.writeHead(400).end(JSON.stringify({ error: 'Missing mcp-session-id header' }));
        return;
      }
      const transport = activeSessions.get(sessionId);
      if (!transport) {
        res.writeHead(404).end(JSON.stringify({ error: 'Session not found' }));
        return;
      }
      transport.handleRequest(req, res);
    } else if (req.method === 'DELETE') {
      if (!sessionId) {
        res.writeHead(400).end(JSON.stringify({ error: 'Missing mcp-session-id header' }));
        return;
      }
      const transport = activeSessions.get(sessionId);
      if (!transport) {
        res.writeHead(404).end(JSON.stringify({ error: 'Session not found' }));
        return;
      }
      activeSessions.delete(sessionId);
      transport.close();
      res.writeHead(200).end();
    } else {
      res.writeHead(405).end('Method Not Allowed');
    }
  });
}

async function handleNewSession(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      activeSessions.set(sessionId, transport);
    },
  });

  transport.onclose = () => {
    if (transport.sessionId) {
      activeSessions.delete(transport.sessionId);
    }
  };

  const mcp = getMcpServer();
  await mcp.connect(transport);
  await transport.handleRequest(req, res);
}

// ── Tool Registration ──────────────────────────────────────────────

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
      blockedBy: z.array(z.number()).default([]).describe('IDs of tasks that block this task'),
      specId: z.string().optional().describe('Specification ID'),
    },
    async ({ blockedBy: rawBlockedBy, ...values }) => {
      let dedupedBlockedBy: number[];
      try {
        dedupedBlockedBy = validateDependencies(null, rawBlockedBy);
      } catch (err) {
        return mcpError((err as Error).message);
      }

      const db = getDb();
      const task = db.transaction((tx) => {
        const t = tx.insert(tasks).values(values).returning().get();
        for (const blockerId of dedupedBlockedBy) {
          tx.insert(taskDependencies).values({ taskId: t.id, blockerTaskId: blockerId }).run();
        }
        return t;
      });

      return mcpResult({ ...task, blockedBy: dedupedBlockedBy });
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
      blockedBy: z.array(z.number()).optional().describe('IDs of tasks that block this task'),
      milestoneRef: z.string().nullable().optional().describe('New milestone ref (e.g. "m1")'),
      taskGroupId: z.number().nullable().optional().describe('New task group ID'),
    },
    async ({ id, blockedBy, ...updates }) => {
      const db = getDb();

      let dedupedBlockedBy: number[] | undefined;
      if (blockedBy !== undefined) {
        try {
          dedupedBlockedBy = validateDependencies(id, blockedBy);
        } catch (err) {
          return mcpError((err as Error).message);
        }
      }

      const result = db.transaction((tx) => {
        if (dedupedBlockedBy !== undefined) {
          tx.delete(taskDependencies).where(eq(taskDependencies.taskId, id)).run();
          for (const blockerId of dedupedBlockedBy) {
            tx.insert(taskDependencies).values({ taskId: id, blockerTaskId: blockerId }).run();
          }
        }

        return tx
          .update(tasks)
          .set({ ...updates, updatedAt: new Date().toISOString() })
          .where(eq(tasks.id, id))
          .returning()
          .get();
      });
      if (!result) return mcpError('Task not found');

      return mcpResult(attachBlockedBy([result])[0]);
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

      let rows;
      if (taskGroupId) rows = query.where(eq(tasks.taskGroupId, taskGroupId)).all();
      else if (milestoneRef) rows = query.where(eq(tasks.milestoneRef, milestoneRef)).all();
      else if (projectId) rows = query.where(eq(tasks.projectId, projectId)).all();
      else rows = query.all();

      return mcpResult(attachBlockedBy(rows));
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
      return mcpResult(attachBlockedBy([task])[0]);
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
