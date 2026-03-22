import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { eq, desc, and, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import type { ExecutionStartConfig } from '@engy/common';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { agentSessions, tasks, taskGroups, projects, workspaces } from '../../db/schema';
import { dispatchExecutionStart, dispatchExecutionStop, dispatchContainerUp } from '../../ws/server';
import { getWorkspaceDir } from '../../engy-dir/init';
import { buildContextBlock, buildQuickActionDirs } from '../../../lib/shell';

// ── Helpers ──────────────────────────────────────────────────────────

function resolveProjectContext(projectId: number) {
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });

  const workspace = db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, project.workspaceId))
    .get();
  if (!workspace) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });

  const repos = Array.isArray(workspace.repos) ? (workspace.repos as string[]) : [];
  const projectDir = resolveProjectDir(workspace, project);
  const dirs = buildQuickActionDirs(repos, projectDir);

  return { project, workspace, repos, projectDir, dirs };
}

function resolveTaskContext(taskId: number) {
  const db = getDb();
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: `Task ${taskId} not found` });
  if (!task.projectId)
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Task ${taskId} has no project` });

  const { project, workspace, repos, projectDir, dirs } = resolveProjectContext(task.projectId);

  return { task, project, workspace, repos, projectDir, dirs };
}

function resolveProjectDir(
  workspace: { slug: string; docsDir: string | null },
  project: { projectDir: string | null; slug: string },
): string {
  const slug = project.projectDir ?? project.slug;
  return path.join(getWorkspaceDir(workspace), 'projects', slug);
}

function buildPromptForTask(
  task: { id: number; title: string; description: string | null },
  workspace: { slug: string; id: number; implementSkill: string | null },
  project: { slug: string; id: number },
  projectDir: string,
) {
  const taskSlug = `${workspace.slug}-T${task.id}`;
  const implementSkill = workspace.implementSkill || '/engy:implement';
  const prompt = `Use ${implementSkill} for ${taskSlug}`;
  const systemPrompt = buildContextBlock({
    workspace: { id: workspace.id, slug: workspace.slug },
    project: { id: project.id, slug: project.slug, dir: projectDir },
    repos: [],
  });
  return { prompt, systemPrompt };
}

function buildPromptForMilestone(
  milestoneRef: string,
  workspace: { slug: string; id: number },
  project: { slug: string; id: number },
  projectDir: string,
) {
  const prompt = `Use /engy:implement-milestone for ${milestoneRef} in project ${project.slug}`;
  const systemPrompt = buildContextBlock({
    workspace: { id: workspace.id, slug: workspace.slug },
    project: { id: project.id, slug: project.slug, dir: projectDir },
    repos: [],
  });
  return { prompt, systemPrompt };
}

function findSessionFile(sessionId: string): string | null {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsDir)) return null;

  const filename = `${sessionId}.jsonl`;
  for (const dir of fs.readdirSync(projectsDir)) {
    const candidate = path.join(projectsDir, dir, filename);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// ── Router ───────────────────────────────────────────────────────────

export const executionRouter = router({
  startExecution: publicProcedure
    .input(
      z.object({
        scope: z.enum(['task', 'taskGroup', 'milestone']),
        id: z.union([z.number(), z.string()]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      console.log(`[execution] startExecution: scope=${input.scope} id=${input.id}`);
      const db = getDb();
      const sessionId = randomUUID();
      let prompt: string;
      let systemPrompt: string;
      let additionalDirs: string[] = [];
      let worktreePath: string | null = null;
      let taskId: number | null = null;
      let taskGroupId: number | null = null;
      let repos: string[] = [];
      let workspace: {
        slug: string;
        containerEnabled: boolean | null;
        docsDir: string | null;
        containerConfig: unknown;
      } = {
        slug: '',
        containerEnabled: null,
        docsDir: null,
        containerConfig: null,
      };

      if (input.scope === 'task') {
        const id = typeof input.id === 'string' ? parseInt(input.id, 10) : input.id;
        const resolved = resolveTaskContext(id);
        additionalDirs = resolved.dirs.additionalDirs;
        worktreePath = resolved.dirs.workingDir ?? null;
        taskId = resolved.task.id;
        taskGroupId = resolved.task.taskGroupId;
        repos = resolved.repos;
        workspace = resolved.workspace;

        const built = buildPromptForTask(
          resolved.task,
          resolved.workspace,
          resolved.project,
          resolved.projectDir,
        );
        prompt = built.prompt;
        systemPrompt = built.systemPrompt;
      } else if (input.scope === 'taskGroup') {
        const id = typeof input.id === 'string' ? parseInt(input.id, 10) : input.id;
        const group = db.select().from(taskGroups).where(eq(taskGroups.id, id)).get();
        if (!group)
          throw new TRPCError({ code: 'NOT_FOUND', message: `Task group ${id} not found` });

        const groupTasks = db.select().from(tasks).where(eq(tasks.taskGroupId, id)).all();
        const firstTask = groupTasks[0];
        if (!firstTask?.projectId)
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Task group has no tasks with a project',
          });

        const resolved = resolveProjectContext(firstTask.projectId);
        additionalDirs = resolved.dirs.additionalDirs;
        worktreePath = resolved.dirs.workingDir ?? null;
        taskGroupId = group.id;
        repos = resolved.repos;
        workspace = resolved.workspace;

        const implementSkill = resolved.workspace.implementSkill || '/engy:implement';
        prompt = `Use ${implementSkill} for task group "${group.name}"`;
        systemPrompt = buildContextBlock({
          workspace: { id: resolved.workspace.id, slug: resolved.workspace.slug },
          project: { id: resolved.project.id, slug: resolved.project.slug, dir: resolved.projectDir },
          repos: resolved.repos,
        });
      } else {
        const milestoneRef = String(input.id);
        const allTasks = db
          .select()
          .from(tasks)
          .where(eq(tasks.milestoneRef, milestoneRef))
          .all();
        const firstTask = allTasks[0];
        if (!firstTask?.projectId)
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Milestone "${milestoneRef}" has no tasks with a project`,
          });

        const resolved = resolveProjectContext(firstTask.projectId);
        additionalDirs = resolved.dirs.additionalDirs;
        worktreePath = resolved.dirs.workingDir ?? null;
        repos = resolved.repos;
        workspace = resolved.workspace;

        const built = buildPromptForMilestone(
          milestoneRef,
          resolved.workspace,
          resolved.project,
          resolved.projectDir,
        );
        prompt = built.prompt;
        systemPrompt = built.systemPrompt;
      }

      // HIGH #5: Guard against duplicate active sessions for the same scope
      const existingSession = taskId
        ? db
            .select()
            .from(agentSessions)
            .where(and(eq(agentSessions.taskId, taskId), eq(agentSessions.status, 'active')))
            .get()
        : taskGroupId
          ? db
              .select()
              .from(agentSessions)
              .where(
                and(eq(agentSessions.taskGroupId, taskGroupId), eq(agentSessions.status, 'active')),
              )
              .get()
          : undefined;

      if (existingSession) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'An execution is already active for this scope',
        });
      }

      db.insert(agentSessions)
        .values({
          sessionId,
          executionMode: input.scope === 'taskGroup' ? 'group' : input.scope,
          status: 'active',
          worktreePath,
          taskId,
          taskGroupId,
        })
        .run();

      // Move task to in_progress
      if (taskId) {
        db.update(tasks)
          .set({ status: 'in_progress', subStatus: 'implementing' })
          .where(eq(tasks.id, taskId))
          .run();
      }

      const flags: string[] = [];
      if (systemPrompt) flags.push('--append-system-prompt', systemPrompt);
      for (const dir of additionalDirs) flags.push('--add-dir', dir);

      const config: ExecutionStartConfig = {
        repoPath: repos[0] ?? '',
        containerMode: (workspace.containerEnabled as boolean) ?? false,
        containerWorkspaceFolder: workspace.containerEnabled
          ? (workspace.docsDir ?? undefined)
          : undefined,
      };

      // Start container if needed (same as terminal flow)
      if (config.containerMode && workspace.docsDir) {
        console.log(`[execution] Starting container for workspace=${workspace.slug}`);
        await dispatchContainerUp(
          ctx.state,
          workspace.docsDir,
          repos,
          (workspace.containerConfig as Record<string, unknown>) ?? undefined,
        );
        console.log(`[execution] Container ready`);
      }

      console.log(
        `[execution] Dispatching: session=${sessionId} repo=${config.repoPath} container=${config.containerMode} flags=${flags.length} prompt=${prompt.length}chars`,
      );
      await dispatchExecutionStart(ctx.state, sessionId, prompt, flags, config);

      return { sessionId };
    }),

  stopExecution: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const session = db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.sessionId, input.sessionId))
        .get();
      if (!session)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' });

      await dispatchExecutionStop(ctx.state, input.sessionId);

      db.update(agentSessions)
        .set({ status: 'stopped', updatedAt: new Date().toISOString() })
        .where(eq(agentSessions.sessionId, input.sessionId))
        .run();

      return { success: true };
    }),

  retryExecution: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const original = db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.sessionId, input.sessionId))
        .get();
      if (!original)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' });

      const newSessionId = randomUUID();

      db.insert(agentSessions)
        .values({
          sessionId: newSessionId,
          executionMode: original.executionMode,
          status: 'active',
          worktreePath: original.worktreePath,
          taskId: original.taskId,
          taskGroupId: original.taskGroupId,
        })
        .run();

      const flags: string[] = ['--resume', input.sessionId];

      await dispatchExecutionStart(ctx.state, newSessionId, '', flags);

      return { sessionId: newSessionId };
    }),

  // NOTE: This reads from the server's local filesystem (~/.claude/projects/).
  // It only works when server and daemon are co-located (same machine).
  // Acceptable for M6 (single-user, local setup) but should be addressed
  // in a future milestone for remote server deployments.
  getSessionFile: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(({ input }) => {
      const sessionFilePath = findSessionFile(input.sessionId);

      if (!sessionFilePath) {
        return { entries: [] };
      }

      const content = fs.readFileSync(sessionFilePath, 'utf-8');
      const entries = content
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => {
          try {
            return JSON.parse(line) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is Record<string, unknown> => entry !== null);

      return { entries };
    }),

  getActiveSessions: publicProcedure
    .input(z.object({ projectId: z.number().optional() }))
    .query(({ input }) => {
      const db = getDb();

      const allSessions = db.select().from(agentSessions).all();

      if (!input.projectId) {
        return allSessions;
      }

      const projectTasks = db
        .select()
        .from(tasks)
        .where(eq(tasks.projectId, input.projectId))
        .all();
      const projectTaskIds = new Set(projectTasks.map((t) => t.id));
      const projectTaskGroupIds = new Set(
        projectTasks.map((t) => t.taskGroupId).filter((id): id is number => id !== null),
      );

      return allSessions.filter(
        (s) =>
          (s.taskId !== null && projectTaskIds.has(s.taskId)) ||
          (s.taskGroupId !== null && projectTaskGroupIds.has(s.taskGroupId)),
      );
    }),

  getSessionStatus: publicProcedure
    .input(
      z.object({
        scope: z.enum(['task', 'taskGroup', 'milestone']),
        id: z.union([z.number(), z.string()]),
      }),
    )
    .query(({ input }) => {
      const db = getDb();

      if (input.scope === 'task') {
        const taskId = typeof input.id === 'string' ? parseInt(input.id, 10) : input.id;
        const session = db
          .select()
          .from(agentSessions)
          .where(and(eq(agentSessions.taskId, taskId), eq(agentSessions.executionMode, 'task')))
          .orderBy(desc(agentSessions.createdAt))
          .get();

        return session
          ? { status: session.status, sessionId: session.sessionId }
          : { status: null, sessionId: null };
      }

      if (input.scope === 'taskGroup') {
        const groupId = typeof input.id === 'string' ? parseInt(input.id, 10) : input.id;
        const session = db
          .select()
          .from(agentSessions)
          .where(
            and(eq(agentSessions.taskGroupId, groupId), eq(agentSessions.executionMode, 'group')),
          )
          .orderBy(desc(agentSessions.createdAt))
          .get();

        return session
          ? { status: session.status, sessionId: session.sessionId }
          : { status: null, sessionId: null };
      }

      // milestone scope — find tasks in the milestone, then find sessions for those tasks
      const milestoneRef = String(input.id);
      const milestoneTasks = db
        .select()
        .from(tasks)
        .where(eq(tasks.milestoneRef, milestoneRef))
        .all();
      const taskIds = milestoneTasks.map((t) => t.id);

      if (taskIds.length === 0) {
        return { status: null, sessionId: null };
      }

      const session = db
        .select()
        .from(agentSessions)
        .where(
          and(
            inArray(agentSessions.taskId, taskIds),
            eq(agentSessions.executionMode, 'milestone'),
          ),
        )
        .orderBy(desc(agentSessions.createdAt))
        .get();

      return session
        ? { status: session.status, sessionId: session.sessionId }
        : { status: null, sessionId: null };
    }),

  getWorktreeSessions: publicProcedure
    .input(z.object({ workspaceSlug: z.string().optional() }))
    .query(() => {
      const db = getDb();

      const activeSessions = db
        .select({
          id: agentSessions.id,
          sessionId: agentSessions.sessionId,
          worktreePath: agentSessions.worktreePath,
        })
        .from(agentSessions)
        .where(eq(agentSessions.status, 'active'))
        .all();

      const sessions = activeSessions
        .filter((s) => s.worktreePath !== null)
        .map((s) => ({
          id: s.id,
          sessionId: s.sessionId,
          worktreePath: s.worktreePath!,
        }));

      return { sessions };
    }),
});
