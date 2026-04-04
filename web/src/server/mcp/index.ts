import type { Server as HttpServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { eq, and, desc, inArray, type SQL } from 'drizzle-orm';
import path from 'node:path';
import { getDb } from '../db/client';
import {
  tasks,
  taskDependencies,
  taskGroups,
  fleetingMemories,
  workspaces,
  projects,
  agentSessions,
  questions,
} from '../db/schema';
import { validateDependencies, attachBlockedBy } from '../tasks/validation';
import { getWorkspaceDir, resolveProjectDir } from '../engy-dir/init';
import { readTaskPlan } from '../plan/service';
import { broadcastTaskChange, broadcastQuestionChange } from '../ws/broadcast';

// ── MCP Response Helpers ──────────────────────────────────────────

type McpToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function mcpResult(data: unknown): McpToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

function mcpError(message: string): McpToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }], isError: true };
}

function omitKey<T extends Record<string, unknown>, K extends keyof T>(
  rows: T[],
  key: K,
): Omit<T, K>[] {
  return rows.map((row) => {
    const copy = { ...row };
    delete copy[key];
    return copy;
  });
}

// ── McpServer Factory ─────────────────────────────────────────────

export function getMcpServer(toolset?: string): McpServer {
  const mcp = new McpServer(
    { name: 'engy', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  if (toolset === 'execution') {
    registerQuestionTools(mcp);
  } else {
    registerWorkspaceTools(mcp);
    registerTaskTools(mcp);
    registerTaskGroupTools(mcp);
    registerMemoryTools(mcp);
  }

  return mcp;
}

// ── HTTP Mount ─────────────────────────────────────────────────────

const activeSessions = new Map<string, StreamableHTTPServerTransport>();

export function attachMCP(server: HttpServer): void {
  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname !== '/mcp') return;

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    const toolset = url.searchParams.get('toolset') ?? undefined;

    if (req.method === 'POST') {
      const transport = sessionId ? activeSessions.get(sessionId) : undefined;
      if (transport) {
        transport.handleRequest(req, res);
      } else {
        handleNewSession(req, res, toolset);
      }
    } else if (req.method === 'GET' || req.method === 'DELETE') {
      if (!sessionId) {
        res.writeHead(400).end(JSON.stringify({ error: 'Missing mcp-session-id header' }));
        return;
      }
      const transport = activeSessions.get(sessionId);
      if (!transport) {
        res.writeHead(404).end(JSON.stringify({ error: 'Session not found' }));
        return;
      }
      if (req.method === 'DELETE') {
        activeSessions.delete(sessionId);
        transport.close();
        res.writeHead(200).end();
      } else {
        transport.handleRequest(req, res);
      }
    } else {
      res.writeHead(405).end('Method Not Allowed');
    }
  });
}

async function handleNewSession(
  req: IncomingMessage,
  res: ServerResponse,
  toolset?: string,
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

  const mcp = getMcpServer(toolset);
  await mcp.connect(transport);
  await transport.handleRequest(req, res);
}

// ── Path Helpers ────────────────────────────────────────────────────

type WorkspaceRow = { slug: string; docsDir: string | null };

function resolveWorkspacePaths(ws: WorkspaceRow) {
  const workspaceDir = getWorkspaceDir(ws);
  return {
    workspaceDir,
    specsDir: path.join(workspaceDir, 'projects'),
    docsDir: path.join(workspaceDir, 'docs'),
    memoryDir: path.join(workspaceDir, 'memory'),
    systemDir: path.join(workspaceDir, 'system'),
  };
}

function resolveSpecPath(ws: WorkspaceRow, specId: string): string {
  const { specsDir } = resolveWorkspacePaths(ws);
  return path.join(specsDir, specId);
}

function attachSpecPaths<T extends { projectId: number | null; specId: string | null }>(
  rows: T[],
): (T & { specPath: string | null })[] {
  const projectIds = [...new Set(rows.map((r) => r.projectId).filter((id): id is number => id != null))];
  if (projectIds.length === 0) return rows.map((r) => ({ ...r, specPath: null }));

  const db = getDb();
  const wsCache = new Map<number, WorkspaceRow>();
  const projectWsMap = new Map<number, WorkspaceRow>();

  const projectRows = projectIds
    .map((id) => db.select().from(projects).where(eq(projects.id, id)).get())
    .filter((p): p is NonNullable<typeof p> => p != null);
  for (const p of projectRows) {
    if (!wsCache.has(p.workspaceId)) {
      const ws = db.select().from(workspaces).where(eq(workspaces.id, p.workspaceId)).get();
      if (ws) wsCache.set(p.workspaceId, ws);
    }
    const ws = wsCache.get(p.workspaceId);
    if (ws) projectWsMap.set(p.id, ws);
  }

  return rows.map((r) => {
    if (!r.specId || !r.projectId) return { ...r, specPath: null };
    const ws = projectWsMap.get(r.projectId);
    if (!ws) return { ...r, specPath: null };
    return { ...r, specPath: resolveSpecPath(ws, r.specId) };
  });
}

// ── Tool Registration ──────────────────────────────────────────────

function registerWorkspaceTools(mcp: McpServer): void {
  mcp.tool(
    'listWorkspaces',
    'List all workspaces with id, name, and slug for discovery',
    {},
    async () => {
      const db = getDb();
      const rows = db.select().from(workspaces).all();
      return mcpResult(rows.map((w) => ({ id: w.id, name: w.name, slug: w.slug })));
    },
  );

  mcp.tool(
    'getWorkspaceDetails',
    'Get workspace details with filesystem paths for direct file access',
    {
      workspaceId: z.number().describe('Workspace ID'),
    },
    async ({ workspaceId }) => {
      const db = getDb();
      const ws = db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
      if (!ws) return mcpError('Workspace not found');

      const projectRows = db.select().from(projects).where(eq(projects.workspaceId, workspaceId)).all();

      const wsPaths = resolveWorkspacePaths(ws);
      return mcpResult({
        ...ws,
        paths: wsPaths,
        projects: projectRows.map((p) => ({
          ...p,
          projectDir: p.projectDir ? path.join(wsPaths.specsDir, p.projectDir) : null,
        })),
      });
    },
  );

  mcp.tool(
    'listProjects',
    'List projects (id, name, slug) optionally filtered by workspace',
    {
      workspaceId: z.number().optional().describe('Filter by workspace ID'),
    },
    async ({ workspaceId }) => {
      const db = getDb();
      const rows = workspaceId
        ? db.select().from(projects).where(eq(projects.workspaceId, workspaceId)).all()
        : db.select().from(projects).all();
      return mcpResult(rows);
    },
  );

  mcp.tool(
    'getProjectDetails',
    'Get project details with workspace context and filesystem paths',
    {
      projectId: z.number().describe('Project ID'),
    },
    async ({ projectId }) => {
      const db = getDb();
      const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
      if (!project) return mcpError('Project not found');

      const ws = db.select().from(workspaces).where(eq(workspaces.id, project.workspaceId)).get();
      if (!ws) return mcpError('Parent workspace not found');

      const wsPaths = resolveWorkspacePaths(ws);

      // Fetch execution data: sessions linked to this project's task groups
      const projectTasks = db.select().from(tasks).where(eq(tasks.projectId, projectId)).all();
      const taskGroupIds = [
        ...new Set(
          projectTasks.map((t) => t.taskGroupId).filter((id): id is number => id != null),
        ),
      ];

      const projectTaskIds = projectTasks.map((t) => t.id);

      const groupSessions =
        taskGroupIds.length > 0
          ? db
              .select()
              .from(agentSessions)
              .where(inArray(agentSessions.taskGroupId, taskGroupIds))
              .orderBy(desc(agentSessions.createdAt))
              .all()
          : [];

      const taskSessions =
        projectTaskIds.length > 0
          ? db
              .select()
              .from(agentSessions)
              .where(
                and(
                  inArray(agentSessions.taskId, projectTaskIds),
                  eq(agentSessions.executionMode, 'task'),
                ),
              )
              .orderBy(desc(agentSessions.createdAt))
              .all()
          : [];

      const sessions = [...groupSessions, ...taskSessions];

      // Build per-taskGroup execution summary (latest session wins)
      const taskGroupExecution: Record<
        number,
        {
          status: string;
          sessionId: string;
          worktreePath: string | null;
          currentTaskId: number | null;
          currentTaskTitle: string | null;
        }
      > = {};

      for (const tgId of taskGroupIds) {
        const latestSession = sessions.find((s) => s.taskGroupId === tgId);
        if (!latestSession) continue;

        // Find the current task: the one with a subStatus set in this group
        const currentTask = projectTasks.find(
          (t) => t.taskGroupId === tgId && t.subStatus != null,
        );

        taskGroupExecution[tgId] = {
          status: latestSession.status,
          sessionId: latestSession.sessionId,
          worktreePath: latestSession.worktreePath,
          currentTaskId: currentTask?.id ?? null,
          currentTaskTitle: currentTask?.title ?? null,
        };
      }

      const activeExecutionSessions = sessions
        .filter((s) => s.status === 'active')
        .map((s) => ({
          sessionId: s.sessionId,
          status: s.status,
          worktreePath: s.worktreePath,
          taskId: s.taskId,
          taskGroupId: s.taskGroupId,
        }));

      return mcpResult({
        ...project,
        workspace: { id: ws.id, name: ws.name, slug: ws.slug },
        paths: {
          ...wsPaths,
          projectDir: project.projectDir
            ? path.join(wsPaths.specsDir, project.projectDir)
            : null,
          specDir: project.slug
            ? path.join(wsPaths.specsDir, project.slug)
            : null,
        },
        execution: {
          taskGroups: taskGroupExecution,
          activeSessions: activeExecutionSessions,
        },
      });
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
      needsPlan: z.boolean().default(true).describe('Whether task needs a plan before implementation'),
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

      broadcastTaskChange('created', task.id, task.projectId ?? undefined);
      return mcpResult({ id: task.id });
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
      needsPlan: z.boolean().optional().describe('Whether task needs a plan before implementation'),
      blockedBy: z.array(z.number()).optional().describe('IDs of tasks that block this task'),
      milestoneRef: z.string().nullable().optional().describe('New milestone ref (e.g. "m1")'),
      taskGroupId: z.number().nullable().optional().describe('New task group ID'),
      projectId: z.number().nullable().optional().describe('New project ID'),
      specId: z.string().nullable().optional().describe('New specification ID'),
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

      broadcastTaskChange('updated', id, result.projectId ?? undefined);
      return mcpResult({ success: true });
    },
  );

  mcp.tool(
    'listTasks',
    'List tasks with combined filters (AND logic). Compact mode (default) omits descriptions.',
    {
      projectId: z.number().optional().describe('Filter by project ID'),
      milestoneRef: z.string().optional().describe('Filter by milestone ref (e.g. "m1")'),
      taskGroupId: z.number().optional().describe('Filter by task group ID'),
      status: z
        .enum(['todo', 'in_progress', 'review', 'done'])
        .optional()
        .describe('Filter by status'),
      compact: z.boolean().default(true).describe('Omit description field (default true)'),
    },
    async ({ projectId, milestoneRef, taskGroupId, status, compact }) => {
      const db = getDb();

      const conditions: SQL[] = [];
      if (projectId !== undefined) conditions.push(eq(tasks.projectId, projectId));
      if (milestoneRef !== undefined) conditions.push(eq(tasks.milestoneRef, milestoneRef));
      if (taskGroupId !== undefined) conditions.push(eq(tasks.taskGroupId, taskGroupId));
      if (status !== undefined) conditions.push(eq(tasks.status, status));

      const rows = conditions.length > 0
        ? db.select().from(tasks).where(and(...conditions)).all()
        : db.select().from(tasks).all();

      const enriched = attachSpecPaths(attachBlockedBy(rows));
      if (compact !== false) {
        return mcpResult(omitKey(enriched, 'description'));
      }
      return mcpResult(enriched);
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

      const enriched = attachSpecPaths(attachBlockedBy([task]))[0];

      let planContent: string | null = null;
      if (task.projectId) {
        const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get();
        if (project) {
          const ws = db
            .select()
            .from(workspaces)
            .where(eq(workspaces.id, project.workspaceId))
            .get();
          if (ws) {
            planContent = readTaskPlan(resolveProjectDir(ws, project), ws.slug, id);
          }
        }
      }

      return mcpResult({ ...enriched, planContent });
    },
  );

  mcp.tool(
    'deleteTask',
    'Delete a task by ID',
    { id: z.number().describe('Task ID') },
    async ({ id }) => {
      const db = getDb();
      const deleted = db.delete(tasks).where(eq(tasks.id, id)).returning().get();
      if (!deleted) return mcpError('Task not found');
      broadcastTaskChange('deleted', id, deleted.projectId ?? undefined);
      return mcpResult({ success: true });
    },
  );
}

function registerTaskGroupTools(mcp: McpServer): void {
  mcp.tool(
    'createTaskGroup',
    'Create a new task group within a milestone. Returns the new group ID.',
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
      return mcpResult({ id: group.id });
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

  mcp.tool(
    'getTaskGroup',
    'Get a task group by ID',
    { id: z.number().describe('Task group ID') },
    async ({ id }) => {
      const db = getDb();
      const group = db.select().from(taskGroups).where(eq(taskGroups.id, id)).get();
      if (!group) return mcpError('Task group not found');
      return mcpResult(group);
    },
  );

  mcp.tool(
    'updateTaskGroup',
    'Update an existing task group',
    {
      id: z.number().describe('Task group ID'),
      name: z.string().optional().describe('New name'),
      status: z.enum(['planned', 'active', 'review', 'complete']).optional().describe('New status'),
      repos: z.array(z.string()).optional().describe('New repository paths'),
    },
    async ({ id, ...updates }) => {
      const db = getDb();
      const result = db
        .update(taskGroups)
        .set({ ...updates, updatedAt: new Date().toISOString() })
        .where(eq(taskGroups.id, id))
        .returning()
        .get();
      if (!result) return mcpError('Task group not found');
      return mcpResult({ success: true });
    },
  );

  mcp.tool(
    'deleteTaskGroup',
    'Delete a task group by ID',
    { id: z.number().describe('Task group ID') },
    async ({ id }) => {
      const db = getDb();
      const deleted = db.delete(taskGroups).where(eq(taskGroups.id, id)).returning().get();
      if (!deleted) return mcpError('Task group not found');
      return mcpResult({ success: true });
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
    'List fleeting memories. Compact mode (default) omits content.',
    {
      workspaceId: z.number().optional().describe('Filter by workspace ID'),
      projectId: z.number().optional().describe('Filter by project ID'),
      compact: z.boolean().default(true).describe('Omit content field (default true)'),
    },
    async ({ workspaceId, projectId, compact }) => {
      const db = getDb();

      const conditions: SQL[] = [];
      if (workspaceId !== undefined) conditions.push(eq(fleetingMemories.workspaceId, workspaceId));
      if (projectId !== undefined) conditions.push(eq(fleetingMemories.projectId, projectId));

      const rows = conditions.length > 0
        ? db.select().from(fleetingMemories).where(and(...conditions)).all()
        : db.select().from(fleetingMemories).all();

      if (compact !== false) {
        return mcpResult(omitKey(rows, 'content'));
      }
      return mcpResult(rows);
    },
  );
}

function registerQuestionTools(mcp: McpServer): void {
  mcp.tool(
    'askQuestion',
    'Ask the user 1-4 batched questions with selectable options. Blocks the task until answered.',
    {
      sessionId: z.string().describe('Agent session ID asking the question'),
      taskId: z
        .number()
        .optional()
        .describe('Task being worked on (optional for session-scoped questions)'),
      documentPath: z
        .string()
        .optional()
        .describe('Path to spec/plan doc for context tab'),
      context: z
        .string()
        .optional()
        .describe('1 paragraph explaining why these questions matter and what you need to decide'),
      questions: z
        .array(
          z.object({
            question: z.string().describe('The question text'),
            header: z.string().max(12).describe('Short chip label for tab header'),
            multiSelect: z.boolean().optional().default(false),
            options: z.array(
              z.object({
                label: z.string(),
                description: z.string(),
                preview: z.string().optional().describe('Markdown content for visual preview'),
              }),
            ),
          }),
        )
        .min(1)
        .max(4)
        .describe('1-4 batched questions per call'),
    },
    async ({ sessionId, taskId, documentPath, context, questions: questionItems }) => {
      const db = getDb();

      const result = db.transaction((tx) => {
        const questionIds: number[] = [];

        for (const q of questionItems) {
          const row = tx
            .insert(questions)
            .values({
              sessionId,
              taskId: taskId ?? null,
              documentPath: documentPath ?? null,
              context: context ?? null,
              question: q.question,
              header: q.header,
              options: q.options,
              multiSelect: q.multiSelect,
            })
            .returning()
            .get();
          questionIds.push(row.id);
        }

        if (taskId !== undefined) {
          tx.update(tasks)
            .set({ subStatus: 'blocked', updatedAt: new Date().toISOString() })
            .where(eq(tasks.id, taskId))
            .run();
        }

        return questionIds;
      });

      broadcastQuestionChange('created', taskId, sessionId);
      return mcpResult({ status: 'blocked', questionIds: result });
    },
  );
}
