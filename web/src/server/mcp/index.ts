import type { Server as HttpServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { eq, and, desc, inArray, like, or, sql as drizzleSql, type SQL } from 'drizzle-orm';
import path from 'node:path';
import { getDb } from '../db/client';
import { jsonObjectArrayContains } from '../db/json';
import {
  tasks,
  taskDependencies,
  taskGroups,
  fleetingMemories,
  permanentMemories,
  workspaces,
  projects,
  agentSessions,
  questions,
  frontmatter,
} from '../db/schema';
import { validateDependencies, attachBlockedBy } from '../tasks/validation';
import { getWorkspaceDir, resolveProjectDir } from '../engy-dir/init';
import { readTaskPlan } from '../plan/service';
import { broadcastTaskChange, broadcastQuestionChange } from '../ws/broadcast';
import { taskStatusSchema } from '@/lib/task-status';
import { writePermanentMemory, rewritePermanentMemory } from '../lib/memory-files';
import { update as indexerUpdate, forceFullReindex, updateAndEmbed } from '../search/indexer';
import { autoLink } from '../search/auto-linker';
import { validateWorkspace as runValidateWorkspace } from '../search/validate';
import { getStore } from '../search/qmd-store';
import { runQmdSearch, type QmdSearchMode } from '../search/qmd-search';
import { applySubtypeAffinity } from '../search/subtype-affinity';
import { projectCompletionService } from '../services/project-completion';
import { getSupersededMemoryPaths } from '../search/memory-queries';

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

export function getMcpServer(): McpServer {
  const mcp = new McpServer(
    { name: 'engy', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  registerWorkspaceTools(mcp);
  registerTaskTools(mcp);
  registerTaskGroupTools(mcp);
  registerMemoryTools(mcp);
  registerQuestionTools(mcp);
  registerIndexTools(mcp);
  registerSearchTools(mcp);

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

  mcp.tool(
    'startProjectCompletion',
    'Begin project completion flow — sets status to `completing` and returns ranked candidate fleeting memories for distillation review.',
    {
      projectId: z.number().describe('Project ID'),
    },
    async ({ projectId }) => {
      try {
        return mcpResult(projectCompletionService.startCompletion(projectId));
      } catch (err) {
        return mcpError((err as Error).message);
      }
    },
  );

  mcp.tool(
    'archiveProject',
    'Archive a project — marks status `archived` and removes associated agent sessions. Plan, tasks, and promoted memories are preserved.',
    {
      projectId: z.number().describe('Project ID'),
    },
    async ({ projectId }) => {
      try {
        return mcpResult(projectCompletionService.archive(projectId));
      } catch (err) {
        return mcpError((err as Error).message);
      }
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
    'Update an existing task. Optionally pass memories[] to capture learnings from the task implementation as fleeting memories scoped to the task\'s workspace.',
    {
      id: z.number().describe('Task ID'),
      title: z.string().optional().describe('New title'),
      description: z.string().optional().describe('New description'),
      status: taskStatusSchema.optional().describe('New status'),
      type: z.enum(['ai', 'human']).optional().describe('New type'),
      importance: z.enum(['important', 'not_important']).optional().describe('New importance'),
      urgency: z.enum(['urgent', 'not_urgent']).optional().describe('New urgency'),
      needsPlan: z.boolean().optional().describe('Whether task needs a plan before implementation'),
      blockedBy: z.array(z.number()).optional().describe('IDs of tasks that block this task'),
      milestoneRef: z.string().nullable().optional().describe('New milestone ref (e.g. "m1")'),
      taskGroupId: z.number().nullable().optional().describe('New task group ID'),
      projectId: z.number().nullable().optional().describe('New project ID'),
      specId: z.string().nullable().optional().describe('New specification ID'),
      memories: z
        .array(
          z.object({
            content: z.string().describe('Memory content'),
            type: z
              .enum(['capture', 'question', 'blocker', 'idea', 'reference'])
              .optional()
              .describe('Memory type (default: capture)'),
          }),
        )
        .optional()
        .describe('Learnings captured during task implementation — stored as fleeting memories on the workspace'),
    },
    async ({ id, blockedBy, memories, ...updates }) => {
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

        const updated = tx
          .update(tasks)
          .set({ ...updates, updatedAt: new Date().toISOString() })
          .where(eq(tasks.id, id))
          .returning()
          .get();

        if (!updated) return null;

        if (memories && memories.length > 0 && updated.projectId != null) {
          const project = tx
            .select()
            .from(projects)
            .where(eq(projects.id, updated.projectId))
            .get();
          if (project) {
            for (const mem of memories) {
              tx
                .insert(fleetingMemories)
                .values({
                  workspaceId: project.workspaceId,
                  content: mem.content,
                  type: mem.type ?? 'capture',
                  source: 'agent',
                  tags: [],
                })
                .run();
            }
          }
        }

        return updated;
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
      status: taskStatusSchema.optional().describe('Filter by status'),
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
      projectId: z.number().optional().describe('Project ID'),
      milestoneRef: z.string().describe('Milestone ref (e.g. "m1")'),
      name: z.string().describe('Task group name'),
      repos: z.array(z.string()).optional().describe('Repository paths'),
    },
    async ({ projectId, milestoneRef, name, repos }) => {
      const db = getDb();
      const group = db
        .insert(taskGroups)
        .values({ projectId, milestoneRef, name, repos })
        .returning()
        .get();
      return mcpResult({ id: group.id });
    },
  );

  mcp.tool(
    'listTaskGroups',
    'List task groups with combined filters (AND logic)',
    {
      projectId: z.number().optional().describe('Filter by project ID'),
      milestoneRef: z.string().optional().describe('Filter by milestone ref (e.g. "m1")'),
    },
    async ({ projectId, milestoneRef }) => {
      const db = getDb();
      const conditions: SQL[] = [];
      if (projectId !== undefined) conditions.push(eq(taskGroups.projectId, projectId));
      if (milestoneRef !== undefined) conditions.push(eq(taskGroups.milestoneRef, milestoneRef));

      const rows = conditions.length > 0
        ? db.select().from(taskGroups).where(and(...conditions)).all()
        : db.select().from(taskGroups).all();
      return mcpResult(rows);
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
    'Create a fleeting memory note for quick capture. Pass sources[] with paths under memory/sources/ or memory/references/ that triggered this note.',
    {
      workspaceId: z.number().describe('Workspace ID'),
      content: z.string().describe('Memory content'),
      type: z
        .enum(['capture', 'question', 'blocker', 'idea', 'reference'])
        .default('capture')
        .describe('Memory type'),
      source: z.enum(['agent', 'user', 'system']).default('agent').describe('Memory source'),
      tags: z.array(z.string()).default([]).describe('Tags for organization'),
      sources: z
        .array(z.string())
        .optional()
        .describe('Paths under memory/sources/ or memory/references/ that triggered this note'),
    },
    async ({ sources, ...rest }) => {
      const db = getDb();
      const memory = db
        .insert(fleetingMemories)
        .values({ ...rest, sources: sources ?? [] })
        .returning()
        .get();
      return mcpResult(memory);
    },
  );

  mcp.tool(
    'listMemories',
    'List fleeting memories for a workspace. Compact mode (default) omits content.',
    {
      workspaceId: z.number().optional().describe('Filter by workspace ID'),
      compact: z.boolean().default(true).describe('Omit content field (default true)'),
    },
    async ({ workspaceId, compact }) => {
      const db = getDb();

      const rows = workspaceId !== undefined
        ? db.select().from(fleetingMemories).where(eq(fleetingMemories.workspaceId, workspaceId)).all()
        : db.select().from(fleetingMemories).all();

      if (compact !== false) {
        return mcpResult(omitKey(rows, 'content'));
      }
      return mcpResult(rows);
    },
  );

  mcp.tool(
    'createPermanentMemory',
    'Create a permanent memory with full metadata — writes a DB row and a markdown file in the workspace memory directory',
    {
      workspaceId: z.number().describe('Workspace ID'),
      subtype: z
        .enum(['decision', 'pattern', 'fact', 'convention', 'insight'])
        .describe('Memory subtype'),
      title: z.string().describe('Memory title'),
      content: z.string().describe('Memory body content (markdown)'),
      repo: z.string().optional().describe('Optional repo provenance (e.g. "api-server")'),
      confidence: z.number().min(0).max(1).optional().describe('Confidence score 0–1'),
      keywords: z.array(z.string()).optional().describe('Low-level retrieval terms'),
      themes: z.array(z.string()).optional().describe('High-level conceptual themes'),
      tags: z.array(z.string()).optional().describe('Organizational tags'),
      scenarioIds: z.array(z.string()).optional().describe('FR/scenario ID anchors'),
      sources: z
        .array(z.string())
        .optional()
        .describe('Paths to memory/sources/ or memory/references/ records that triggered this note'),
      linkedMemories: z
        .array(z.string())
        .optional()
        .describe('Paths to related permanent memory files (memory/{subtype}/...)'),
    },
    async ({ workspaceId, subtype, title, content, ...metadata }) => {
      const db = getDb();
      const ws = db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
      if (!ws) return mcpError('Workspace not found');

      const workspaceDir = getWorkspaceDir(ws);

      let filePath: string;
      try {
        filePath = await writePermanentMemory(workspaceDir, { subtype, title, ...metadata }, content);
      } catch (err) {
        return mcpError(`Failed to write memory file: ${(err as Error).message}`);
      }

      const memory = db
        .insert(permanentMemories)
        .values({
          workspaceId,
          subtype,
          title,
          content,
          repo: metadata.repo,
          confidence: metadata.confidence,
          keywords: metadata.keywords ?? [],
          themes: metadata.themes ?? [],
          tags: metadata.tags ?? [],
          scenarioIds: metadata.scenarioIds ?? [],
          sources: metadata.sources ?? [],
          linkedMemories: metadata.linkedMemories ?? [],
          filePath,
        })
        .returning()
        .get();

      autoLink(memory.id, ws.slug).catch((err) =>
        console.error('[autoLink] createPermanentMemory failed:', err),
      );

      return mcpResult({ id: memory.id, filePath });
    },
  );

  mcp.tool(
    'updatePermanentMemory',
    'Update a permanent memory by ID — syncs both the DB record and the markdown file',
    {
      id: z.number().describe('Permanent memory ID'),
      title: z.string().optional().describe('New title'),
      content: z.string().optional().describe('New body content (markdown)'),
      repo: z.string().nullable().optional().describe('New repo provenance'),
      confidence: z.number().min(0).max(1).nullable().optional().describe('New confidence score'),
      keywords: z.array(z.string()).optional().describe('New keywords'),
      themes: z.array(z.string()).optional().describe('New themes'),
      tags: z.array(z.string()).optional().describe('New tags'),
      scenarioIds: z.array(z.string()).optional().describe('New scenario ID anchors'),
      sources: z.array(z.string()).optional().describe('New source paths'),
      linkedMemories: z.array(z.string()).optional().describe('New linked memory paths'),
    },
    async ({ id, ...updates }) => {
      const db = getDb();
      const existing = db
        .select()
        .from(permanentMemories)
        .where(eq(permanentMemories.id, id))
        .get();
      if (!existing) return mcpError('Permanent memory not found');

      const ws = db.select().from(workspaces).where(eq(workspaces.id, existing.workspaceId)).get();
      if (!ws) return mcpError('Workspace not found');

      const workspaceDir = getWorkspaceDir(ws);

      if (!existing.filePath) {
        return mcpError('Memory has no file path — cannot update in place');
      }

      const resolvedTitle = updates.title ?? existing.title;
      const resolvedContent = updates.content ?? existing.content;
      const resolvedSubtype = existing.subtype;

      const fm = {
        subtype: resolvedSubtype,
        title: resolvedTitle,
        repo: 'repo' in updates ? (updates.repo ?? undefined) : (existing.repo ?? undefined),
        confidence:
          'confidence' in updates
            ? (updates.confidence ?? undefined)
            : (existing.confidence ?? undefined),
        keywords: updates.keywords ?? existing.keywords ?? [],
        themes: updates.themes ?? existing.themes ?? [],
        tags: updates.tags ?? existing.tags ?? [],
        scenarioIds: updates.scenarioIds ?? existing.scenarioIds ?? [],
        sources: updates.sources ?? existing.sources ?? [],
        linkedMemories: updates.linkedMemories ?? existing.linkedMemories ?? [],
      };

      let filePath: string;
      try {
        filePath = await rewritePermanentMemory(workspaceDir, existing.filePath, fm, resolvedContent);
      } catch (err) {
        return mcpError(`Failed to rewrite memory file: ${(err as Error).message}`);
      }

      db.update(permanentMemories)
        .set({ ...updates, filePath, updatedAt: new Date().toISOString() })
        .where(eq(permanentMemories.id, id))
        .run();

      // Fire-and-forget incremental reindex so next search returns fresh content.
      // Edit feedback is fast; the local change is already reflected in the DB/file.
      indexerUpdate(ws.slug, 'memory').catch((err) =>
        console.error('[updatePermanentMemory] reindex error:', err),
      );

      return mcpResult({ success: true, filePath });
    },
  );

  mcp.tool(
    'promoteMemory',
    'Promote a fleeting memory to a permanent memory — creates the permanent record and file, then marks the fleeting as promoted',
    {
      fleetingMemoryId: z.number().describe('Fleeting memory ID to promote'),
      subtype: z
        .enum(['decision', 'pattern', 'fact', 'convention', 'insight'])
        .describe('Permanent memory subtype'),
      title: z.string().describe('Title for the permanent memory'),
      repo: z.string().optional().describe('Optional repo provenance'),
      confidence: z.number().min(0).max(1).optional().describe('Confidence score 0–1'),
      keywords: z.array(z.string()).optional().describe('Low-level retrieval terms'),
      themes: z.array(z.string()).optional().describe('High-level conceptual themes'),
      tags: z.array(z.string()).optional().describe('Organizational tags'),
      scenarioIds: z.array(z.string()).optional().describe('FR/scenario ID anchors'),
      sources: z.array(z.string()).optional().describe('Source paths'),
      linkedMemories: z.array(z.string()).optional().describe('Linked memory paths'),
    },
    async ({ fleetingMemoryId, subtype, title, ...metadata }) => {
      const db = getDb();
      const fleeting = db
        .select()
        .from(fleetingMemories)
        .where(eq(fleetingMemories.id, fleetingMemoryId))
        .get();
      if (!fleeting) return mcpError('Fleeting memory not found');
      if (fleeting.promoted) return mcpError('Fleeting memory is already promoted');

      const ws = db.select().from(workspaces).where(eq(workspaces.id, fleeting.workspaceId)).get();
      if (!ws) return mcpError('Workspace not found');

      const workspaceDir = getWorkspaceDir(ws);

      let filePath: string;
      try {
        filePath = await writePermanentMemory(
          workspaceDir,
          { subtype, title, ...metadata },
          fleeting.content,
        );
      } catch (err) {
        return mcpError(`Failed to write memory file: ${(err as Error).message}`);
      }

      const result = db.transaction((tx) => {
        const permanent = tx
          .insert(permanentMemories)
          .values({
            workspaceId: fleeting.workspaceId,
            subtype,
            title,
            content: fleeting.content,
            repo: metadata.repo,
            confidence: metadata.confidence,
            keywords: metadata.keywords ?? [],
            themes: metadata.themes ?? [],
            tags: metadata.tags ?? [],
            scenarioIds: metadata.scenarioIds ?? [],
            sources: metadata.sources ?? [],
            linkedMemories: metadata.linkedMemories ?? [],
            filePath,
          })
          .returning()
          .get();

        tx.update(fleetingMemories)
          .set({
            promoted: true,
            promotedFromId: permanent.id,
            promotedAt: new Date().toISOString(),
          })
          .where(eq(fleetingMemories.id, fleetingMemoryId))
          .run();

        return permanent;
      });

      try {
        await autoLink(result.id, ws.slug);
      } catch (err) {
        console.error('[autoLink] promoteMemory failed:', err);
      }

      // Re-read the row so linkedMemories reflects whatever autoLink wrote.
      const promoted = db
        .select()
        .from(permanentMemories)
        .where(eq(permanentMemories.id, result.id))
        .get();
      const linkedMemories = (promoted?.linkedMemories as string[]) ?? [];

      return mcpResult({ permanentMemoryId: result.id, filePath, linkedMemories });
    },
  );
}

function registerIndexTools(mcp: McpServer): void {
  mcp.tool(
    'reindex',
    'Re-index workspace content into the qmd hybrid search store. Returns per-collection counts.',
    {
      workspaceId: z.number().describe('Workspace ID'),
      collection: z
        .enum(['system', 'docs', 'projects', 'memory'])
        .optional()
        .describe('Limit to one collection (default: all four)'),
      full: z
        .boolean()
        .default(false)
        .describe('Force full rebuild — clears and re-adds every collection from scratch'),
    },
    async ({ workspaceId, collection, full }) => {
      const db = getDb();
      const ws = db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
      if (!ws) return mcpError('Workspace not found');

      const started = Date.now();
      let results;
      try {
        if (full) {
          results = await forceFullReindex(ws.slug);
          // Trigger embed pass after full rebuild; errors are non-fatal
          getStore(ws.slug)
            .then((store) => store.embed())
            .catch((err) => console.error('[reindex] embed error after full reindex:', err));
        } else {
          results = await updateAndEmbed(ws.slug, collection);
        }
      } catch (err) {
        return mcpError(`Reindex failed: ${(err as Error).message}`);
      }

      return mcpResult({
        durationMs: Date.now() - started,
        collections: results,
      });
    },
  );

  mcp.tool(
    'indexStatus',
    'Report per-collection index status without modifying content. unchanged === fileCount means up-to-date.',
    {
      workspaceId: z.number().describe('Workspace ID'),
    },
    async ({ workspaceId }) => {
      const db = getDb();
      const ws = db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
      if (!ws) return mcpError('Workspace not found');

      const started = Date.now();
      let results;
      try {
        results = await indexerUpdate(ws.slug);
      } catch (err) {
        return mcpError(`Status check failed: ${(err as Error).message}`);
      }

      const totalNeedsEmbedding = results.reduce((sum, r) => sum + r.needsEmbedding, 0);
      return mcpResult({
        durationMs: Date.now() - started,
        upToDate: totalNeedsEmbedding === 0,
        needsEmbedding: totalNeedsEmbedding,
        collections: results,
      });
    },
  );

  mcp.tool(
    'validateWorkspace',
    'Run integrity checks on workspace knowledge files and report findings grouped by severity.',
    {
      workspaceId: z.number().describe('Workspace ID'),
    },
    async ({ workspaceId }) => {
      const db = getDb();
      const ws = db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
      if (!ws) return mcpError('Workspace not found');

      try {
        const report = await runValidateWorkspace(ws);
        return mcpResult(report);
      } catch (err) {
        return mcpError(`Validation failed: ${(err as Error).message}`);
      }
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

// ── Search helpers (shared with registerSearchTools) ──────────────────

interface SearchResult {
  path: string;
  title: string;
  snippet?: string;
  score?: number;
}

interface SearchResultGroup {
  collection: string;
  results: SearchResult[];
}

function collectionFromVirtualPath(virtualPath: string): string {
  const match = /^qmd:\/\/([^/]+)/.exec(virtualPath);
  return match ? match[1] : 'docs';
}

function titleFromPath(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  return base.replace(/\.md$/, '').replace(/[-_]/g, ' ');
}

function extractTitle(dataJson: string, filePath: string): string {
  try {
    const data = JSON.parse(dataJson) as Record<string, unknown>;
    if (typeof data.title === 'string' && data.title) return data.title;
  } catch {
    // ignore
  }
  return titleFromPath(filePath);
}

function buildFrontmatterWhereCondition(
  workspaceId: number,
  filters: Record<string, unknown>,
  collection?: string,
) {
  const conditions: ReturnType<typeof eq>[] = [
    eq(frontmatter.workspaceId, workspaceId) as ReturnType<typeof eq>,
  ];

  if (collection && collection !== 'tasks') {
    conditions.push(
      eq(frontmatter.collection, collection as 'system' | 'docs' | 'projects' | 'memory') as ReturnType<typeof eq>,
    );
  }

  for (const scalar of ['type', 'subtype', 'repo'] as const) {
    const val = filters[scalar];
    if (typeof val === 'string' && val) {
      conditions.push(
        drizzleSql`json_extract(${frontmatter.data}, '$.' || ${scalar}) = ${val}` as ReturnType<typeof eq>,
      );
    }
  }

  for (const field of ['tags', 'themes', 'scenarioIds', 'sources', 'linkedMemories'] as const) {
    const values = filters[field];
    if (Array.isArray(values) && values.length > 0) {
      for (const value of values as string[]) {
        conditions.push(jsonObjectArrayContains(frontmatter.data, field, value));
      }
    }
  }

  return and(...conditions)!;
}

function groupFrontmatterRows(
  rows: Array<{ collection: string; path: string; data: string }>,
): SearchResultGroup[] {
  const byCollection = new Map<string, SearchResult[]>();
  for (const row of rows) {
    const group = byCollection.get(row.collection) ?? [];
    group.push({ path: row.path, title: extractTitle(row.data, row.path) });
    byCollection.set(row.collection, group);
  }
  return Array.from(byCollection.entries()).map(([col, results]) => ({ collection: col, results }));
}

function searchTasksByQuery(workspaceId: number, query: string, limit: number): SearchResult[] {
  const db = getDb();
  const pattern = `%${query}%`;
  const rows = db
    .select({ id: tasks.id, title: tasks.title, description: tasks.description })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(eq(projects.workspaceId, workspaceId), or(like(tasks.title, pattern), like(tasks.description, pattern))!))
    .limit(limit)
    .all();
  return rows.map((t) => ({
    path: `task:${t.id}`,
    title: t.title,
    snippet: t.description ? t.description.slice(0, 150) : undefined,
  }));
}

function filterTasksByStatus(workspaceId: number, status: string, limit: number): SearchResult[] {
  const db = getDb();
  const rows = db
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(eq(projects.workspaceId, workspaceId), eq(tasks.status, status as (typeof tasks.status)['_']['data'])))
    .limit(limit)
    .all();
  return rows.map((t) => ({ path: `task:${t.id}`, title: t.title }));
}

const searchFiltersSchema = z.object({
  type: z.string().optional(),
  subtype: z.string().optional(),
  repo: z.string().optional(),
  promoted: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  themes: z.array(z.string()).optional(),
  scenarioIds: z.array(z.string()).optional(),
  sources: z.array(z.string()).optional(),
  linkedMemories: z.array(z.string()).optional(),
  status: z.string().optional(),
});

function registerSearchTools(mcp: McpServer): void {
  mcp.tool(
    'search',
    'Unified search across all workspace collections. Supports semantic query, structured filters, or both. Replaces listMemories for discovery use cases.',
    {
      workspaceId: z.number().describe('Workspace ID'),
      query: z.string().optional().describe('Semantic search query (hybrid BM25 + vector + rerank)'),
      collection: z
        .enum(['system', 'docs', 'projects', 'memory', 'tasks'])
        .optional()
        .describe('Scope to a single collection'),
      filters: searchFiltersSchema
        .optional()
        .describe(
          'Structured filters on frontmatter: tags, themes, scenarioIds, sources, linkedMemories (array membership), type/subtype/repo (scalar), status (tasks only)',
        ),
      limit: z.number().min(1).max(500).default(50).describe('Max results per collection'),
      mode: z
        .enum(['hybrid', 'lex', 'vector'])
        .optional()
        .describe("Search mode (default 'hybrid'). 'lex' = BM25 only, 'vector' = embedding only."),
      intent: z
        .string()
        .optional()
        .describe(
          "Intent token for qmd reranker — see engy:research playbook for the question-shape table.",
        ),
    },
    async ({ workspaceId, query, collection, filters, limit, mode, intent }) => {
      const db = getDb();
      const ws = db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
      if (!ws) return mcpError('Workspace not found');

      const hasQuery = typeof query === 'string' && query.trim().length > 0;
      const hasFilters =
        filters !== undefined && Object.values(filters).some((v) => v !== undefined);

      if (!hasQuery && !hasFilters) {
        return mcpError('Provide at least one of: query or filters');
      }

      try {
        const groups = await runMcpSearch(
          ws.id,
          ws.slug,
          query,
          collection,
          filters,
          limit,
          mode ?? 'hybrid',
          intent,
        );
        return mcpResult(groups);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('download') || message.includes('model')) {
          return mcpError(
            'Embedding model not yet available. Run `reindex` to initialise the search index.',
          );
        }
        return mcpError(`Search failed: ${message}`);
      }
    },
  );
}

async function runMcpSearch(
  workspaceId: number,
  workspaceSlug: string,
  query: string | undefined,
  collection: string | undefined,
  filters: Record<string, unknown> | undefined,
  limit: number,
  mode: QmdSearchMode,
  intent: string | undefined,
): Promise<SearchResultGroup[]> {
  const hasQuery = typeof query === 'string' && query.trim().length > 0;
  const hasFilters = filters !== undefined && Object.values(filters).some((v) => v !== undefined);

  if (hasQuery && !hasFilters) {
    return mcpQueryOnly(workspaceId, workspaceSlug, query!, collection, limit, mode, intent);
  }
  if (!hasQuery && hasFilters) {
    return mcpFiltersOnly(workspaceId, filters!, collection, limit);
  }
  return mcpQueryWithFilters(
    workspaceId,
    workspaceSlug,
    query!,
    filters!,
    collection,
    limit,
    mode,
    intent,
  );
}

async function mcpQueryOnly(
  workspaceId: number,
  workspaceSlug: string,
  query: string,
  collection: string | undefined,
  limit: number,
  mode: QmdSearchMode,
  intent: string | undefined,
): Promise<SearchResultGroup[]> {
  const groups: SearchResultGroup[] = [];

  if (!collection || collection === 'tasks') {
    const taskResults = searchTasksByQuery(workspaceId, query, limit);
    if (taskResults.length > 0) groups.push({ collection: 'tasks', results: taskResults });
  }

  if (process.env.QMD_SKIP === '1') return groups;

  const rawHits = await runQmdSearch(workspaceSlug, query, collection, limit, mode, intent);
  const qmdResults = applySubtypeAffinity(rawHits, query, workspaceId);
  const supersededPaths = getSupersededMemoryPaths(workspaceId);
  const byCollection = new Map<string, SearchResult[]>();
  for (const hit of qmdResults) {
    if (supersededPaths.has(hit.displayPath)) continue;
    const col = collectionFromVirtualPath(hit.file);
    const group = byCollection.get(col) ?? [];
    group.push({
      path: hit.displayPath,
      title: hit.title || titleFromPath(hit.displayPath),
      snippet: hit.snippet,
      score: hit.score,
    });
    byCollection.set(col, group);
  }
  for (const [col, results] of byCollection.entries()) {
    groups.push({ collection: col, results });
  }
  return groups;
}

async function mcpFiltersOnly(
  workspaceId: number,
  filters: Record<string, unknown>,
  collection: string | undefined,
  limit: number,
): Promise<SearchResultGroup[]> {
  const db = getDb();
  const groups: SearchResultGroup[] = [];

  if (!collection || collection !== 'tasks') {
    const condition = buildFrontmatterWhereCondition(workspaceId, filters, collection);
    const rows = db
      .select({ collection: frontmatter.collection, path: frontmatter.path, data: frontmatter.data })
      .from(frontmatter)
      .where(condition)
      .limit(limit)
      .all();
    const supersededPaths = getSupersededMemoryPaths(workspaceId);
    groups.push(...groupFrontmatterRows(rows.filter((r) => !supersededPaths.has(r.path))));
  }

  const statusVal = filters.status;
  if (typeof statusVal === 'string' && statusVal && (!collection || collection === 'tasks')) {
    const taskResults = filterTasksByStatus(workspaceId, statusVal, limit);
    if (taskResults.length > 0) groups.push({ collection: 'tasks', results: taskResults });
  }

  return groups;
}

async function mcpQueryWithFilters(
  workspaceId: number,
  workspaceSlug: string,
  query: string,
  filters: Record<string, unknown>,
  collection: string | undefined,
  limit: number,
  mode: QmdSearchMode,
  intent: string | undefined,
): Promise<SearchResultGroup[]> {
  const db = getDb();
  const groups: SearchResultGroup[] = [];

  const statusVal = filters.status;
  if (typeof statusVal === 'string' && statusVal && (!collection || collection === 'tasks')) {
    const taskResults = filterTasksByStatus(workspaceId, statusVal, limit);
    if (taskResults.length > 0) groups.push({ collection: 'tasks', results: taskResults });
  }

  if (process.env.QMD_SKIP === '1') return groups;

  const subtypeFilter = typeof filters.subtype === 'string' && filters.subtype ? filters.subtype : null;
  // With a subtype filter the relevant subset is small; go wide so qmd scores cover it.
  const candidateLimit = subtypeFilter ? Math.min(500, limit * 8) : limit * 2;
  const rawHits = await runQmdSearch(workspaceSlug, query, collection, candidateLimit, mode, intent);
  const qmdResults = applySubtypeAffinity(rawHits, query, workspaceId);
  const supersededPaths = getSupersededMemoryPaths(workspaceId);

  const scoreByPath = new Map<string, number>();
  for (const hit of qmdResults) {
    if (supersededPaths.has(hit.displayPath)) continue;
    scoreByPath.set(hit.displayPath, hit.score);
  }

  // Anchor on the filter: every filter-matching row is returned, with qmd score
  // where available and fallback ordering otherwise. Without this, any
  // filter-matching doc qmd missed in its top-N would silently disappear.
  const condition = buildFrontmatterWhereCondition(workspaceId, filters, collection);
  const filteredRows = db
    .select({ collection: frontmatter.collection, path: frontmatter.path, data: frontmatter.data })
    .from(frontmatter)
    .where(condition)
    .all()
    .filter((r) => !supersededPaths.has(r.path));

  const byCollection = new Map<string, SearchResult[]>();
  for (const row of filteredRows) {
    const group = byCollection.get(row.collection) ?? [];
    group.push({
      path: row.path,
      title: extractTitle(row.data, row.path),
      score: scoreByPath.get(row.path),
    });
    byCollection.set(row.collection, group);
  }

  for (const [col, results] of byCollection.entries()) {
    groups.push({
      collection: col,
      results: results
        .sort((a, b) => {
          const aScored = typeof a.score === 'number';
          const bScored = typeof b.score === 'number';
          if (aScored && bScored) return (b.score ?? 0) - (a.score ?? 0);
          if (aScored) return -1;
          if (bScored) return 1;
          return a.path.localeCompare(b.path);
        })
        .slice(0, limit),
    });
  }

  return groups;
}
