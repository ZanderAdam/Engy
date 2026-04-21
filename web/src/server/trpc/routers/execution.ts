import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const execFileAsync = promisify(execFile);
import { eq, desc, and, inArray, sql, gt, isNotNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import type { ExecutionStartConfig } from '@engy/common';
import type { AppState } from '../context';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { agentSessions, tasks, taskGroups, projects, workspaces } from '../../db/schema';
import { taskPlanSlug, readPlanFile, readTaskPlan } from '../../plan/service';
import {
  dispatchExecutionStart,
  dispatchExecutionStop,
  dispatchContainerUp,
  dispatchRemoteFilePush,
} from '../../ws/server';
import { broadcastTaskChange } from '../../ws/broadcast';
import { getWorkspaceDir, resolveProjectDir } from '../../engy-dir/init';
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

function buildLocalExecutionConfig(
  workspace: {
    containerEnabled: boolean | null;
    docsDir: string | null;
    executionBackend: string | null;
    coderConfig: unknown;
  },
  repos: string[],
): ExecutionStartConfig {
  const isCoder = workspace.executionBackend === 'coder';
  const coderCfg = workspace.coderConfig as { workspace: string; repoBasePath: string } | null;
  return {
    repoPath: repos[0] ?? '',
    containerMode: (workspace.containerEnabled as boolean) ?? false,
    containerWorkspaceFolder:
      !isCoder && workspace.containerEnabled ? (workspace.docsDir ?? undefined) : undefined,
    executionBackend: isCoder ? 'coder' : 'devcontainer',
    coderWorkspace: isCoder ? coderCfg?.workspace : undefined,
    coderRepoBasePath: isCoder ? coderCfg?.repoBasePath : undefined,
  };
}

// Reuses the same resolution that startExecution uses, plus carries the
// original worktree so `claude --resume` runs from the cwd it was created in
// (otherwise it errors with "No conversation found with session ID").
function buildResumeConfig(
  taskId: number,
  worktreePath: string | null,
): ExecutionStartConfig {
  const { workspace, repos } = resolveTaskContext(taskId);
  return {
    ...buildLocalExecutionConfig(workspace, repos),
    existingWorktreePath: worktreePath ?? undefined,
  };
}

// Rebuilds the `--append-system-prompt` and `--add-dir` flags that
// startExecution passes, so the resumed agent has the same context block and
// structured-output instructions as the original run.
function buildResumeFlags(taskId: number): string[] {
  const { workspace, project, projectDir, repos, dirs } = resolveTaskContext(taskId);
  const systemPrompt = buildContextBlock({
    workspace: { id: workspace.id, slug: workspace.slug },
    project: { id: project.id, slug: project.slug, dir: projectDir },
    repos,
    autoAgentCompletion: workspace.autoAgentCompletion as 'pr' | 'merge' | undefined,
  });
  const flags: string[] = [];
  if (systemPrompt) flags.push('--append-system-prompt', systemPrompt);
  for (const dir of dirs.additionalDirs) flags.push('--add-dir', dir);
  return flags;
}

function buildPromptForTask(
  task: { id: number; title: string; description: string | null },
  workspace: { slug: string; id: number; implementSkill: string | null; autoAgentCompletion: string | null },
  project: { slug: string; id: number },
  projectDir: string,
  repos: string[],
) {
  const taskSlug = taskPlanSlug(workspace.slug, task.id);
  const implementSkill = workspace.implementSkill || '/engy:implement';
  const prompt = `Use ${implementSkill} for ${taskSlug}`;
  const systemPrompt = buildContextBlock({
    workspace: { id: workspace.id, slug: workspace.slug },
    project: { id: project.id, slug: project.slug, dir: projectDir },
    repos,
    autoAgentCompletion: workspace.autoAgentCompletion as 'pr' | 'merge' | undefined,
  });
  return { prompt, systemPrompt };
}

function buildPromptForPlan(
  task: { id: number; title: string; description: string | null },
  workspace: { slug: string; id: number; planSkill: string | null; autoAgentCompletion: string | null },
  project: { slug: string; id: number },
  projectDir: string,
  repos: string[],
) {
  const taskSlug = taskPlanSlug(workspace.slug, task.id);
  const planSkill = workspace.planSkill || '/engy:plan';
  const prompt = `Use ${planSkill} for ${taskSlug}`;
  const systemPrompt = buildContextBlock({
    workspace: { id: workspace.id, slug: workspace.slug },
    project: { id: project.id, slug: project.slug, dir: projectDir },
    repos,
    autoAgentCompletion: workspace.autoAgentCompletion as 'pr' | 'merge' | undefined,
  });
  return { prompt, systemPrompt };
}

function buildPromptForMilestone(
  milestoneRef: string,
  workspace: { slug: string; id: number },
  project: { slug: string; id: number },
  projectDir: string,
  repos: string[],
) {
  const prompt = `Use /engy:implement-milestone for ${milestoneRef} in project ${project.slug}`;
  const systemPrompt = buildContextBlock({
    workspace: { id: workspace.id, slug: workspace.slug },
    project: { id: project.id, slug: project.slug, dir: projectDir },
    repos,
  });
  return { prompt, systemPrompt };
}

async function findSessionFile(sessionId: string): Promise<string | null> {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  try {
    const dirs = await fs.promises.readdir(projectsDir);
    const filename = `${sessionId}.jsonl`;
    for (const dir of dirs) {
      const candidate = path.join(projectsDir, dir, filename);
      try {
        await fs.promises.access(candidate);
        return candidate;
      } catch {
        // file doesn't exist, continue
      }
    }
  } catch {
    // projectsDir doesn't exist
  }
  return null;
}

async function findSessionFileViaCoder(
  sessionId: string,
  coderWorkspace: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('coder', [
      'ssh', coderWorkspace, '--',
      'bash', '-c', `find ~/.claude/projects -name '${sessionId}.jsonl' -print -quit`,
    ]);
    const filePath = stdout.trim();
    return filePath || null;
  } catch {
    return null;
  }
}

async function readSessionFileViaCoder(
  filePath: string,
  coderWorkspace: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('coder', [
      'ssh', coderWorkspace, '--', 'cat', filePath,
    ]);
    return stdout;
  } catch {
    return null;
  }
}

function resolveCoderWorkspaceForSession(sessionId: string): string | null {
  const db = getDb();
  const session = db.select().from(agentSessions).where(eq(agentSessions.sessionId, sessionId)).get();
  if (!session?.taskId) return null;

  const task = db.select().from(tasks).where(eq(tasks.id, session.taskId)).get();
  if (!task?.projectId) return null;

  const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get();
  if (!project) return null;

  const workspace = db.select().from(workspaces).where(eq(workspaces.id, project.workspaceId)).get();
  if (workspace?.executionBackend !== 'coder') return null;

  const coderCfg = workspace.coderConfig as { workspace: string } | null;
  return coderCfg?.workspace ?? null;
}

function buildRemotePrompt(
  task: { id: number; title: string; description: string | null },
  workspace: { slug: string; id: number; docsDir: string | null },
  project: { slug: string; id: number; projectDir: string | null },
): string {
  const parts: string[] = [];

  // Context
  parts.push(`Workspace: ${workspace.slug}`);
  parts.push(`Project: ${project.slug}`);
  parts.push('');

  // Task info
  const slug = taskPlanSlug(workspace.slug, task.id);
  parts.push(`Task: ${slug} — ${task.title}`);
  if (task.description) {
    parts.push(task.description);
  }
  parts.push('');

  // Plan content (if exists)
  const wsDir = getWorkspaceDir(workspace);
  const specsDir = path.join(wsDir, 'projects');
  const specSlug = project.projectDir ?? project.slug;
  const planFilename = `plans/${slug}.plan.md`;
  const planContent = readPlanFile(specsDir, specSlug, planFilename);
  if (planContent) {
    parts.push('## Implementation Plan');
    parts.push(planContent);
  }

  return parts.join('\n');
}

// ── Auto-Start ──────────────────────────────────────────────────────

interface TrpcCaller {
  execution: {
    startExecution: (input: {
      scope: 'task' | 'taskGroup' | 'milestone' | 'planning';
      id: number | string;
      remote?: boolean;
    }) => Promise<{ sessionId: string }>;
  };
}

export async function triggerAutoStart(
  caller: TrpcCaller,
  taskId: number,
  state: AppState,
): Promise<void> {
  try {
    // Fail fast if no daemon — same check dispatchExecutionStart does
    if (!state.daemon || state.daemon.readyState !== 1) {
      console.log(`[auto-start] Skipped task ${taskId}: no daemon connected`);
      return;
    }

    const db = getDb();

    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!task?.projectId) return;
    if (task.taskGroupId || task.milestoneRef) return;

    const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get();
    if (!project) return;

    const workspace = db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, project.workspaceId))
      .get();
    if (!workspace?.autoStart) return;

    // Check concurrency — exclude sessions not updated in 24h (orphaned)
    const maxConcurrency = workspace.maxConcurrency ?? 1;
    const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const activeCountResult = db
      .select({ count: sql<number>`count(*)` })
      .from(agentSessions)
      .innerJoin(tasks, eq(agentSessions.taskId, tasks.id))
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(
          eq(projects.workspaceId, workspace.id),
          eq(agentSessions.status, 'active'),
          gt(agentSessions.updatedAt, staleThreshold),
          isNotNull(agentSessions.worktreePath),
        ),
      )
      .get();
    const activeCount = activeCountResult?.count ?? 0;
    if (activeCount >= maxConcurrency) {
      console.log(`[auto-start] Skipped task ${taskId}: concurrency ${activeCount}/${maxConcurrency}`);
      return;
    }

    // If a plan file already exists on disk, skip planning even if the flag
    // hasn't been cleared yet (handles tasks created before the auto-clear fix).
    const projDir = resolveProjectDir(workspace, project);
    const hasPlanFile = !!readTaskPlan(projDir, workspace.slug, task.id);
    if (task.needsPlan && hasPlanFile) {
      db.update(tasks)
        .set({ needsPlan: false, updatedAt: new Date().toISOString() })
        .where(eq(tasks.id, task.id))
        .run();
    }
    const scope = task.needsPlan && !hasPlanFile ? 'planning' : 'task';
    console.log(`[auto-start] Dispatching task ${taskId}: scope=${scope}`);
    await caller.execution.startExecution({ scope, id: taskId });
    console.log(`[auto-start] Started task ${taskId}`);
  } catch (err) {
    console.error(`[auto-start] Failed for task ${taskId}:`, err);
    try {
      const db = getDb();
      db.update(tasks)
        .set({
          subStatus: 'failed' as typeof tasks.$inferInsert.subStatus,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(tasks.id, taskId))
        .run();
    } catch (updateErr) {
      console.error(`[auto-start] Failed to set subStatus for task ${taskId}:`, updateErr);
    }
  }
}

// ── Router ───────────────────────────────────────────────────────────

export const executionRouter = router({
  startExecution: publicProcedure
    .input(
      z.object({
        scope: z.enum(['task', 'taskGroup', 'milestone', 'planning']),
        id: z.union([z.number(), z.string()]),
        remote: z.boolean().optional(),
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
      let previousTaskStatus: string | null = null;
      let taskGroupId: number | null = null;
      let repos: string[] = [];
      let workspace: {
        slug: string;
        containerEnabled: boolean | null;
        docsDir: string | null;
        containerConfig: unknown;
        executionBackend: string | null;
        coderConfig: unknown;
      } = {
        slug: '',
        containerEnabled: null,
        docsDir: null,
        containerConfig: null,
        executionBackend: null,
        coderConfig: null,
      };

      if (input.scope === 'task') {
        const id = typeof input.id === 'string' ? parseInt(input.id, 10) : input.id;
        const resolved = resolveTaskContext(id);
        additionalDirs = resolved.dirs.additionalDirs;
        worktreePath = resolved.dirs.workingDir ?? null;
        taskId = resolved.task.id;
        previousTaskStatus = resolved.task.status;
        taskGroupId = resolved.task.taskGroupId;
        repos = resolved.repos;
        workspace = resolved.workspace;

        if (input.remote) {
          prompt = buildRemotePrompt(resolved.task, resolved.workspace, resolved.project);
          systemPrompt = '';
        } else {
          const built = buildPromptForTask(
            resolved.task,
            resolved.workspace,
            resolved.project,
            resolved.projectDir,
            resolved.repos,
          );
          prompt = built.prompt;
          systemPrompt = built.systemPrompt;
        }
      } else if (input.scope === 'planning') {
        const id = typeof input.id === 'string' ? parseInt(input.id, 10) : input.id;
        const resolved = resolveTaskContext(id);
        additionalDirs = resolved.dirs.additionalDirs;
        worktreePath = resolved.dirs.workingDir ?? null;
        taskId = resolved.task.id;
        previousTaskStatus = resolved.task.status;
        taskGroupId = resolved.task.taskGroupId;
        repos = resolved.repos;
        workspace = resolved.workspace;

        const built = buildPromptForPlan(
          resolved.task,
          resolved.workspace,
          resolved.project,
          resolved.projectDir,
          resolved.repos,
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

        taskId = firstTask.id;

        const built = buildPromptForMilestone(
          milestoneRef,
          resolved.workspace,
          resolved.project,
          resolved.projectDir,
          resolved.repos,
        );
        prompt = built.prompt;
        systemPrompt = built.systemPrompt;
      }

      // Guard against duplicate active/submitted sessions for the same scope
      // Exclude sessions not updated in 24h — likely orphaned from crashed processes
      const inFlightStatuses = ['active', 'submitted'] as const;
      const sessionStaleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const execMode = input.scope === 'taskGroup' ? 'group' : input.scope;
      const existingSession = taskId
        ? db
            .select()
            .from(agentSessions)
            .where(
              and(
                eq(agentSessions.taskId, taskId),
                eq(agentSessions.executionMode, execMode),
                inArray(agentSessions.status, [...inFlightStatuses]),
                gt(agentSessions.updatedAt, sessionStaleThreshold),
              ),
            )
            .get()
        : taskGroupId
          ? db
              .select()
              .from(agentSessions)
              .where(
                and(
                  eq(agentSessions.taskGroupId, taskGroupId),
                  eq(agentSessions.executionMode, execMode),
                  inArray(agentSessions.status, [...inFlightStatuses]),
                  gt(agentSessions.updatedAt, sessionStaleThreshold),
                ),
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

      // Move task to in_progress (skip for milestone scope — agent handles all tasks)
      if (taskId && input.scope === 'task') {
        const updated = db.update(tasks)
          .set({ status: 'in_progress', subStatus: 'implementing' })
          .where(eq(tasks.id, taskId))
          .returning()
          .get();
        if (updated) broadcastTaskChange('updated', taskId, updated.projectId ?? undefined);
      } else if (taskId && input.scope === 'planning') {
        const updated = db.update(tasks)
          .set({ status: 'in_progress', subStatus: 'planning' })
          .where(eq(tasks.id, taskId))
          .returning()
          .get();
        if (updated) broadcastTaskChange('updated', taskId, updated.projectId ?? undefined);
      }

      const flags: string[] = [];
      if (!input.remote) {
        if (systemPrompt) flags.push('--append-system-prompt', systemPrompt);
        for (const dir of additionalDirs) flags.push('--add-dir', dir);
      }

      if (input.remote && !repos[0]) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Remote execution requires at least one repository configured in the workspace',
        });
      }

      const isCoder = workspace.executionBackend === 'coder';
      const coderCfg = workspace.coderConfig as { workspace: string; repoBasePath: string } | null;

      const config: ExecutionStartConfig = input.remote
        ? { repoPath: repos[0]!, containerMode: false, remote: true }
        : buildLocalExecutionConfig(workspace, repos);

      try {
        // Start container/workspace if needed (skip for remote)
        if (!input.remote && config.containerMode && workspace.docsDir) {
          console.log(`[execution] Starting ${isCoder ? 'Coder workspace' : 'container'} for workspace=${workspace.slug}`);
          await dispatchContainerUp(
            ctx.state,
            workspace.docsDir,
            repos,
            (workspace.containerConfig as Record<string, unknown>) ?? undefined,
            isCoder ? 'coder' : 'devcontainer',
            coderCfg?.workspace,
          );
          console.log(`[execution] ${isCoder ? 'Workspace' : 'Container'} ready`);
        }

        // Mark remote sessions as submitted before dispatching to avoid race with complete event
        if (input.remote) {
          db.update(agentSessions)
            .set({ status: 'submitted', updatedAt: new Date().toISOString() })
            .where(eq(agentSessions.sessionId, sessionId))
            .run();
        }

        console.log(
          `[execution] Dispatching: session=${sessionId} remote=${!!input.remote} repo=${config.repoPath} container=${config.containerMode} flags=${flags.length} prompt=${prompt.length}chars`,
        );
        await dispatchExecutionStart(ctx.state, sessionId, prompt, flags, config);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const now = new Date().toISOString();
        db.update(agentSessions)
          .set({ status: 'stopped', completionSummary: errorMessage, updatedAt: now })
          .where(eq(agentSessions.sessionId, sessionId))
          .run();
        if (taskId && (input.scope === 'task' || input.scope === 'planning')) {
          db.update(tasks)
            .set({
              status: (previousTaskStatus ?? 'todo') as typeof tasks.$inferInsert.status,
              subStatus: 'failed' as typeof tasks.$inferInsert.subStatus,
              updatedAt: now,
            })
            .where(eq(tasks.id, taskId))
            .run();
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to start execution: ${errorMessage}`,
        });
      }

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
      if (original.status === 'submitted')
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot retry a remote session. Use claude.ai/code to follow up.',
        });

      // claude --resume appends to the original JSONL, so reuse the same
      // session row. A new row would leave the UI polling an empty file.
      db.update(agentSessions)
        .set({
          status: 'active',
          completionSummary: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(agentSessions.sessionId, input.sessionId))
        .run();

      const baseFlags = original.taskId ? buildResumeFlags(original.taskId) : [];
      const flags: string[] = [...baseFlags, '--resume', input.sessionId];
      const resumeConfig = original.taskId
        ? buildResumeConfig(original.taskId, original.worktreePath)
        : undefined;

      try {
        await dispatchExecutionStart(ctx.state, input.sessionId, '', flags, resumeConfig);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const now = new Date().toISOString();
        db.update(agentSessions)
          .set({ status: 'stopped', completionSummary: errorMessage, updatedAt: now })
          .where(eq(agentSessions.sessionId, input.sessionId))
          .run();
        if (original.taskId) {
          db.update(tasks)
            .set({
              subStatus: 'failed' as typeof tasks.$inferInsert.subStatus,
              updatedAt: now,
            })
            .where(eq(tasks.id, original.taskId))
            .run();
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to retry execution: ${errorMessage}`,
        });
      }

      return { sessionId: input.sessionId };
    }),

  sendFeedback: publicProcedure
    .input(z.object({ sessionId: z.string().min(1), feedback: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const session = db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.sessionId, input.sessionId))
        .get();
      if (!session)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' });
      if (session.status === 'submitted')
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot send feedback to a remote session. Use claude.ai/code to follow up.',
        });

      if (!session.taskId)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Session has no associated task',
        });

      const now = new Date().toISOString();

      // Write feedback to task record
      db.update(tasks)
        .set({ feedback: input.feedback, updatedAt: now })
        .where(eq(tasks.id, session.taskId))
        .run();

      // Build resume prompt with feedback
      const resumePrompt = [
        'Developer feedback on your changes:',
        input.feedback,
        'Address the feedback and continue.',
      ].join('\n');

      // claude --resume appends to the original JSONL, so reuse the same
      // session row. A new row would leave the UI polling an empty file.
      db.update(agentSessions)
        .set({
          status: 'active',
          completionSummary: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(agentSessions.sessionId, input.sessionId))
        .run();

      try {
        await dispatchExecutionStart(
          ctx.state,
          input.sessionId,
          resumePrompt,
          [...buildResumeFlags(session.taskId), '--resume', input.sessionId],
          buildResumeConfig(session.taskId, session.worktreePath),
        );
      } catch (err) {
        db.update(agentSessions)
          .set({ status: 'stopped', updatedAt: new Date().toISOString() })
          .where(eq(agentSessions.sessionId, input.sessionId))
          .run();
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to dispatch feedback: ${(err as Error).message}`,
        });
      }

      // Clear feedback and set subStatus back to implementing
      db.update(tasks)
        .set({
          feedback: null,
          subStatus: 'implementing' as typeof tasks.$inferInsert.subStatus,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(tasks.id, session.taskId))
        .run();

      return { sessionId: input.sessionId };
    }),

  // Reads from local filesystem first, falls back to Coder SSH for remote sessions.
  getSessionFile: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(async ({ input }) => {
      const parseEntries = (content: string) =>
        content
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

      // Try local first
      const sessionFilePath = await findSessionFile(input.sessionId);
      if (sessionFilePath) {
        const content = await fs.promises.readFile(sessionFilePath, 'utf-8');
        return { entries: parseEntries(content) };
      }

      // Fallback: try Coder SSH if session is linked to a Coder workspace
      const coderWorkspace = resolveCoderWorkspaceForSession(input.sessionId);
      if (coderWorkspace) {
        const remotePath = await findSessionFileViaCoder(input.sessionId, coderWorkspace);
        if (remotePath) {
          const content = await readSessionFileViaCoder(remotePath, coderWorkspace);
          if (content) return { entries: parseEntries(content) };
        }
      }

      return { entries: [] };
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
        scope: z.enum(['task', 'taskGroup', 'milestone', 'planning']),
        id: z.union([z.number(), z.string()]),
      }),
    )
    .query(({ input }) => {
      const db = getDb();

      if (input.scope === 'task') {
        const taskId = typeof input.id === 'string' ? parseInt(input.id, 10) : input.id;
        // Find most recent session for this task — could be 'task' or 'planning' mode
        const session = db
          .select()
          .from(agentSessions)
          .where(
            and(
              eq(agentSessions.taskId, taskId),
              inArray(agentSessions.executionMode, ['task', 'planning']),
            ),
          )
          .orderBy(desc(agentSessions.createdAt))
          .get();

        return session
          ? { status: session.status, sessionId: session.sessionId, completionSummary: session.completionSummary ?? null }
          : { status: null, sessionId: null, completionSummary: null };
      }

      if (input.scope === 'planning') {
        const taskId = typeof input.id === 'string' ? parseInt(input.id, 10) : input.id;
        const session = db
          .select()
          .from(agentSessions)
          .where(
            and(eq(agentSessions.taskId, taskId), eq(agentSessions.executionMode, 'planning')),
          )
          .orderBy(desc(agentSessions.createdAt))
          .get();

        return session
          ? { status: session.status, sessionId: session.sessionId, completionSummary: session.completionSummary ?? null }
          : { status: null, sessionId: null, completionSummary: null };
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
          ? { status: session.status, sessionId: session.sessionId, completionSummary: session.completionSummary ?? null }
          : { status: null, sessionId: null, completionSummary: null };
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
        return { status: null, sessionId: null, completionSummary: null };
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
        ? { status: session.status, sessionId: session.sessionId, completionSummary: session.completionSummary ?? null }
        : { status: null, sessionId: null, completionSummary: null };
    }),

  startBatchExecution: publicProcedure
    .input(
      z.object({
        taskIds: z.array(z.number()).min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const sessionId = randomUUID();

      // Resolve all tasks and capture original statuses for rollback
      const batchTasks = input.taskIds.map((id) => {
        const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
        if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: `Task ${id} not found` });
        if (!task.projectId)
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Task ${id} has no project` });
        return task;
      });

      // All tasks must belong to the same project
      const projectIds = new Set(batchTasks.map((t) => t.projectId));
      if (projectIds.size > 1) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'All tasks in a batch must belong to the same project',
        });
      }

      const previousStatuses = new Map(batchTasks.map((t) => [t.id, t.status]));

      // Guard against duplicate active sessions
      const inFlightStatuses = ['active', 'submitted'] as const;
      for (const task of batchTasks) {
        const existing = db
          .select()
          .from(agentSessions)
          .where(
            and(
              eq(agentSessions.taskId, task.id),
              inArray(agentSessions.status, [...inFlightStatuses]),
            ),
          )
          .get();
        if (existing) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Task ${task.id} already has an active session`,
          });
        }
      }

      // Resolve project context from first task
      const firstTask = batchTasks[0];
      const { project, workspace, repos, projectDir, dirs } = resolveProjectContext(
        firstTask.projectId!,
      );

      // Build prompt with all task slugs
      const taskSlugs = batchTasks.map((t) => taskPlanSlug(workspace.slug, t.id));
      const implementSkill = workspace.implementSkill || '/engy:implement';
      const prompt = `Use ${implementSkill} for tasks: ${taskSlugs.join(', ')}`;
      const systemPrompt = buildContextBlock({
        workspace: { id: workspace.id, slug: workspace.slug },
        project: { id: project.id, slug: project.slug, dir: projectDir },
        repos,
      });

      // Create session linked to first task
      db.insert(agentSessions)
        .values({
          sessionId,
          executionMode: 'task',
          status: 'active',
          worktreePath: dirs.workingDir ?? null,
          taskId: firstTask.id,
        })
        .run();

      // Mark all tasks as in_progress/implementing
      for (const task of batchTasks) {
        db.update(tasks)
          .set({ status: 'in_progress', subStatus: 'implementing' })
          .where(eq(tasks.id, task.id))
          .run();
      }

      const flags: string[] = [];
      if (systemPrompt) flags.push('--append-system-prompt', systemPrompt);
      for (const dir of dirs.additionalDirs) flags.push('--add-dir', dir);

      const config = {
        repoPath: repos[0] ?? '',
        containerMode: (workspace.containerEnabled as boolean) ?? false,
        containerWorkspaceFolder:
          workspace.containerEnabled && workspace.executionBackend !== 'coder'
            ? (workspace.docsDir ?? undefined)
            : undefined,
      };

      try {
        await dispatchExecutionStart(ctx.state, sessionId, prompt, flags, config);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const now = new Date().toISOString();
        db.update(agentSessions)
          .set({ status: 'stopped', completionSummary: errorMessage, updatedAt: now })
          .where(eq(agentSessions.sessionId, sessionId))
          .run();
        for (const task of batchTasks) {
          db.update(tasks)
            .set({
              status: (previousStatuses.get(task.id) ?? 'todo') as typeof tasks.$inferInsert.status,
              subStatus: 'failed' as typeof tasks.$inferInsert.subStatus,
              updatedAt: now,
            })
            .where(eq(tasks.id, task.id))
            .run();
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to start batch execution: ${errorMessage}`,
        });
      }

      return { sessionId };
    }),

  pushRemoteFile: publicProcedure
    .input(
      z.object({
        taskId: z.number().int().positive(),
        content: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const { workspace } = resolveTaskContext(input.taskId);

      const clearNeedsPlan = () =>
        db
          .update(tasks)
          .set({ needsPlan: false, updatedAt: new Date().toISOString() })
          .where(eq(tasks.id, input.taskId))
          .run();

      // Only push for Coder workspaces; non-Coder is a silent no-op.
      // Clear needsPlan either way — "Approve & Implement" means the plan is
      // finalized regardless of execution backend.
      if (workspace.executionBackend !== 'coder') {
        clearNeedsPlan();
        return { pushed: false };
      }

      const coderCfg = workspace.coderConfig as { workspace: string } | null;
      if (!coderCfg?.workspace) {
        clearNeedsPlan();
        return { pushed: false };
      }

      // Plan path is computed server-side from task metadata — no user input
      const planSlug = taskPlanSlug(workspace.slug, input.taskId);
      const planFilePath = `plans/${planSlug}.plan.md`;

      await dispatchRemoteFilePush(
        ctx.state,
        coderCfg.workspace,
        planFilePath,
        input.content,
      );
      // Clear after successful push so the flag stays true if push fails
      clearNeedsPlan();
      return { pushed: true };
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
