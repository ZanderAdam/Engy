import path from 'node:path';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { workspaces, projects } from '../../db/schema';
import { generateSlug, uniqueWorkspaceSlug } from '../utils';
import {
  isAgentTypeId,
  isAgentModeId,
  DEFAULT_PLAN_SKILL,
  DEFAULT_IMPLEMENT_SKILL,
  type AgentTypeId,
  type WorkspaceAgentSettings,
} from '@/lib/agent-types';
import {
  initWorkspaceDir,
  removeWorkspaceDir,
  renameWorkspaceDir,
  writeWorkspaceYaml,
  getWorkspaceDir,
} from '../../engy-dir/init';
import { ensureGitRepo } from '../../engy-dir/git';
import { initProjectDir } from '../../project/service';
import {
  dispatchValidation,
  dispatchDevcontainerGenerate,
  dispatchCreateDir,
} from '../../ws/server';
import type { AppState } from '../context';

const containerConfigSchema = z
  .object({
    allowedDomains: z.array(z.string()).optional(),
    extraPackages: z.array(z.string()).optional(),
    envVars: z.record(z.string(), z.string()).optional(),
    idleTimeout: z.number().min(1).optional(),
  })
  .optional();

const executionBackendSchema = z.enum(['devcontainer', 'coder']).optional();

const coderConfigSchema = z
  .object({
    workspace: z.string().min(1),
    repoBasePath: z.string().min(1),
  })
  .optional();

const autoAgentCompletionSchema = z.enum(['pr', 'merge']).optional();

// Validated against the agent-types registry rather than a fixed enum, so a new
// agent CLI needs only a registry entry — no schema/router change here.
const defaultAgentTypeSchema = z
  .string()
  .refine(isAgentTypeId, { message: 'Unknown agent type' });

const agentSettingsSchema = z.record(
  z.string().refine(isAgentTypeId, { message: 'Unknown agent type' }),
  z.object({
    active: z.boolean().optional(),
    mode: z.string().optional(),
    // min(1): an empty string would be stored but treated as "not set" by
    // resolveAgentSkills — reject it instead (clear with null/omission).
    planSkill: z.string().min(1).nullable().optional(),
    implementSkill: z.string().min(1).nullable().optional(),
  }),
);

function assertValidAgentSettings(
  settings: WorkspaceAgentSettings,
  defaultAgentType: string | null,
): void {
  for (const [agentId, entry] of Object.entries(settings)) {
    if (entry?.mode && !isAgentModeId(agentId as AgentTypeId, entry.mode)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Unknown mode "${entry.mode}" for agent "${agentId}".`,
      });
    }
  }
  const effectiveDefault = defaultAgentType ?? 'claude';
  if (settings[effectiveDefault]?.active === false) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `The default agent ("${effectiveDefault}") cannot be deactivated — pick a different default agent first.`,
    });
  }
}

async function validatePathsOrCreateMissing(
  paths: string[],
  createMissingDirs: boolean | undefined,
  state: AppState,
): Promise<void> {
  if (paths.length === 0) return;

  try {
    const results = await dispatchValidation(paths, state);
    const missing = [...new Set(results.filter((r) => !r.exists).map((r) => r.path))];
    if (missing.length > 0) {
      if (!createMissingDirs) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Invalid paths: ${missing.join(', ')}`,
          cause: { invalidPaths: missing },
        });
      }
      const created = await dispatchCreateDir(missing, state);
      const failed = created.results.filter((r) => !r.success);
      if (failed.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Failed to create: ${failed.map((r) => `${r.path} (${r.error})`).join(', ')}`,
        });
      }
    }
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: `Path validation failed: ${(err as Error).message}`,
    });
  }
}

function broadcastWorkspacesSync(state: AppState): void {
  if (!state.daemon || state.daemon.readyState !== 1) return;

  const db = getDb();
  const allWorkspaces = db.select().from(workspaces).all();
  const syncPayload = allWorkspaces.map((w) => ({
    slug: w.slug,
    repos: (w.repos as string[]) ?? [],
    docsDir: w.docsDir,
  }));

  state.daemon.send(
    JSON.stringify({
      type: 'WORKSPACES_SYNC',
      payload: { workspaces: syncPayload },
    }),
  );
}

/**
 * Combined worktrees (one project view across all worktrees) is only safe when
 * the docs directory is NOT inside a repo — otherwise content is itself
 * worktree-dependent (see `effectiveDocsDirForBranch`) and must stay split.
 */
function isDocsDirInsideRepo(docsDir: string | null, repos: string[]): boolean {
  if (!docsDir) return false;
  const normalizedDocs = path.resolve(docsDir);
  return repos.some((repoPath) => {
    const normalizedRepo = path.resolve(repoPath);
    return (
      normalizedDocs === normalizedRepo ||
      normalizedDocs.startsWith(normalizedRepo + path.sep)
    );
  });
}

function deriveCombinedWorktrees(workspace: {
  splitWorktrees: boolean | null;
  docsDir: string | null;
  repos: unknown;
}): boolean {
  if (workspace.splitWorktrees) return false;
  const repos = (workspace.repos as string[] | null | undefined) ?? [];
  return !isDocsDirInsideRepo(workspace.docsDir, repos);
}

const nameSchema = z
  .string()
  .min(1, 'Name is required')
  .refine((v) => !/[/\\]/.test(v), 'Name must not contain path separators (/ or \\)');

const slugSchema = z
  .string()
  .min(1)
  .regex(
    /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/,
    'Slug must contain only lowercase letters, numbers, and hyphens (e.g., "my-workspace")',
  );

export const workspaceRouter = router({
  create: publicProcedure
    .input(
      z.object({
        name: nameSchema,
        repos: z.array(z.string()).default([]),
        docsDir: z.string().optional(),
        planSkill: z.string().optional(),
        implementSkill: z.string().optional(),
        defaultAgentType: defaultAgentTypeSchema.optional(),
        earsBdd: z.boolean().optional(),
        splitWorktrees: z.boolean().optional(),
        containerEnabled: z.boolean().optional(),
        containerConfig: containerConfigSchema,
        executionBackend: executionBackendSchema,
        coderConfig: coderConfigSchema,
        maxConcurrency: z.number().min(1).optional(),
        autoAgentCompletion: autoAgentCompletionSchema,
        autoStart: z.boolean().optional(),
        createMissingDirs: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const slug = await uniqueWorkspaceSlug(input.name);

      const pathsToValidate = [...input.repos, ...(input.docsDir ? [input.docsDir] : [])];
      await validatePathsOrCreateMissing(pathsToValidate, input.createMissingDirs, ctx.state);

      const workspace = db
        .insert(workspaces)
        .values({
          name: input.name,
          slug,
          repos: input.repos,
          docsDir: input.docsDir ?? null,
          planSkill: input.planSkill || DEFAULT_PLAN_SKILL,
          implementSkill: input.implementSkill || DEFAULT_IMPLEMENT_SKILL,
          defaultAgentType: input.defaultAgentType ?? 'claude',
          earsBdd: input.earsBdd ?? false,
          splitWorktrees: input.splitWorktrees ?? false,
          containerEnabled: input.containerEnabled,
          containerConfig: input.containerConfig,
          executionBackend: input.executionBackend,
          coderConfig: input.coderConfig,
          maxConcurrency: input.maxConcurrency,
          autoAgentCompletion: input.autoAgentCompletion,
          autoStart: input.autoStart,
        })
        .returning()
        .get();

      try {
        initWorkspaceDir(input.name, slug, input.repos, input.docsDir, {
          planSkill: workspace.planSkill,
          implementSkill: workspace.implementSkill,
          earsBdd: workspace.earsBdd ?? false,
        });
      } catch (err) {
        db.delete(workspaces).where(eq(workspaces.id, workspace.id)).run();
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to initialize workspace directory: ${(err as Error).message}`,
        });
      }

      try {
        db.insert(projects)
          .values({
            workspaceId: workspace.id,
            name: 'Default',
            slug: 'default',
            projectDir: 'default',
            isDefault: true,
          })
          .run();
        initProjectDir({ slug: workspace.slug, docsDir: input.docsDir ?? null }, 'default');
      } catch (err) {
        removeWorkspaceDir(slug, input.docsDir);
        db.delete(workspaces).where(eq(workspaces.id, workspace.id)).run();
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create default project: ${(err as Error).message}`,
        });
      }

      try {
        const wsDir = getWorkspaceDir(workspace);
        await ensureGitRepo(wsDir);
      } catch (err) {
        console.warn(`[workspace] Git init failed for ${slug}:`, err);
      }

      broadcastWorkspacesSync(ctx.state);

      return workspace;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number(),
        name: nameSchema.optional(),
        slug: slugSchema.optional(),
        repos: z.array(z.string()).optional(),
        docsDir: z.string().nullable().optional(),
        planSkill: z.string().nullable().optional(),
        implementSkill: z.string().nullable().optional(),
        defaultAgentType: defaultAgentTypeSchema.optional(),
        agentSettings: agentSettingsSchema.nullable().optional(),
        earsBdd: z.boolean().optional(),
        splitWorktrees: z.boolean().optional(),
        containerEnabled: z.boolean().nullable().optional(),
        containerConfig: containerConfigSchema.nullable().optional(),
        executionBackend: executionBackendSchema.nullable().optional(),
        coderConfig: coderConfigSchema.nullable().optional(),
        maxConcurrency: z.number().min(1).nullable().optional(),
        autoAgentCompletion: autoAgentCompletionSchema.nullable().optional(),
        remoteEnabled: z.boolean().nullable().optional(),
        autoStart: z.boolean().nullable().optional(),
        createMissingDirs: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const existing = db.select().from(workspaces).where(eq(workspaces.id, input.id)).get();
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
      }

      const newRepos = input.repos ?? (existing.repos as string[]) ?? [];
      const newDocsDir = input.docsDir !== undefined ? input.docsDir : existing.docsDir;
      const newPlanSkill = input.planSkill !== undefined ? input.planSkill : existing.planSkill;
      const newImplementSkill =
        input.implementSkill !== undefined ? input.implementSkill : existing.implementSkill;
      const newDefaultAgentType =
        input.defaultAgentType !== undefined ? input.defaultAgentType : existing.defaultAgentType;
      const newAgentSettings =
        input.agentSettings !== undefined ? input.agentSettings : existing.agentSettings;
      if (newAgentSettings) {
        assertValidAgentSettings(newAgentSettings, newDefaultAgentType);
      }
      const newEarsBdd = input.earsBdd !== undefined ? input.earsBdd : existing.earsBdd;
      const newSplitWorktrees =
        input.splitWorktrees !== undefined ? input.splitWorktrees : existing.splitWorktrees;
      const newContainerEnabled =
        input.containerEnabled !== undefined ? input.containerEnabled : existing.containerEnabled;
      const newContainerConfig =
        input.containerConfig !== undefined ? input.containerConfig : existing.containerConfig;
      const newMaxConcurrency =
        input.maxConcurrency !== undefined ? input.maxConcurrency : existing.maxConcurrency;
      const newAutoAgentCompletion =
        input.autoAgentCompletion !== undefined
          ? input.autoAgentCompletion
          : existing.autoAgentCompletion;
      const newRemoteEnabled =
        input.remoteEnabled !== undefined ? input.remoteEnabled : existing.remoteEnabled;
      const newAutoStart = input.autoStart !== undefined ? input.autoStart : existing.autoStart;
      const newExecutionBackend =
        input.executionBackend !== undefined ? input.executionBackend : existing.executionBackend;
      const newCoderConfig =
        input.coderConfig !== undefined ? input.coderConfig : existing.coderConfig;
      const newName = input.name ?? existing.name;
      const newSlug = input.slug ?? existing.slug;

      if (input.slug !== undefined && input.slug !== existing.slug) {
        if (generateSlug(input.slug) !== input.slug) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Invalid slug format. Use lowercase alphanumeric characters and hyphens (e.g., "${generateSlug(input.slug)}").`,
          });
        }
        const conflict = db.select().from(workspaces).where(eq(workspaces.slug, input.slug)).get();
        if (conflict) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Slug "${input.slug}" is already in use.`,
          });
        }
      }

      const pathsToValidate: string[] = [];
      if (input.repos !== undefined) pathsToValidate.push(...input.repos);
      if (input.docsDir && input.docsDir !== existing.docsDir) {
        pathsToValidate.push(input.docsDir);
      }

      await validatePathsOrCreateMissing(pathsToValidate, input.createMissingDirs, ctx.state);

      const updated = db
        .update(workspaces)
        .set({
          name: newName,
          slug: newSlug,
          repos: newRepos,
          docsDir: newDocsDir,
          planSkill: newPlanSkill,
          implementSkill: newImplementSkill,
          defaultAgentType: newDefaultAgentType,
          agentSettings: newAgentSettings,
          earsBdd: newEarsBdd,
          splitWorktrees: newSplitWorktrees,
          containerEnabled: newContainerEnabled,
          containerConfig: newContainerConfig,
          executionBackend: newExecutionBackend,
          coderConfig: newCoderConfig,
          maxConcurrency: newMaxConcurrency,
          autoAgentCompletion: newAutoAgentCompletion,
          remoteEnabled: newRemoteEnabled,
          autoStart: newAutoStart,
        })
        .where(eq(workspaces.id, input.id))
        .returning()
        .get();

      const slugChanged = input.slug !== undefined && input.slug !== existing.slug;
      if (slugChanged && !updated.docsDir) {
        try {
          renameWorkspaceDir(existing.slug, updated.slug);
        } catch (err) {
          // Restore all fields that were written — not just slug
          db.update(workspaces)
            .set({
              name: existing.name,
              slug: existing.slug,
              repos: existing.repos,
              docsDir: existing.docsDir,
              planSkill: existing.planSkill,
              implementSkill: existing.implementSkill,
              defaultAgentType: existing.defaultAgentType,
              agentSettings: existing.agentSettings,
              earsBdd: existing.earsBdd,
              splitWorktrees: existing.splitWorktrees,
              containerEnabled: existing.containerEnabled,
              containerConfig: existing.containerConfig,
              executionBackend: existing.executionBackend,
              coderConfig: existing.coderConfig,
              maxConcurrency: existing.maxConcurrency,
              autoAgentCompletion: existing.autoAgentCompletion,
              remoteEnabled: existing.remoteEnabled,
              autoStart: existing.autoStart,
            })
            .where(eq(workspaces.id, input.id))
            .run();
          // Re-sync yaml and daemon with restored state so they stay consistent
          const restoredDir = getWorkspaceDir(existing);
          try {
            writeWorkspaceYaml(
              restoredDir,
              existing.name,
              existing.slug,
              (existing.repos as string[]) ?? [],
              existing.docsDir,
              {
                planSkill: existing.planSkill,
                implementSkill: existing.implementSkill,
                earsBdd: existing.earsBdd ?? false,
              },
            );
          } catch {
            // Best-effort — don't mask the rename error
          }
          broadcastWorkspacesSync(ctx.state);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Failed to rename workspace directory: ${(err as Error).message}`,
          });
        }
      }

      const dir = getWorkspaceDir(updated);
      writeWorkspaceYaml(dir, updated.name, updated.slug, newRepos, updated.docsDir, {
        planSkill: updated.planSkill,
        implementSkill: updated.implementSkill,
        earsBdd: updated.earsBdd ?? false,
      });

      const backend = updated.executionBackend ?? 'devcontainer';
      const { docsDir } = updated;
      const enablingDevcontainer =
        updated.containerEnabled === true &&
        existing.containerEnabled !== true &&
        backend === 'devcontainer' &&
        !!docsDir;

      if (enablingDevcontainer && docsDir) {
        // Fire-and-forget: don't block the Save response on a daemon roundtrip.
        // On failure, a later terminal spawn still materializes the files via
        // the existing CONTAINER_UP_REQUEST flow in maybeStartContainer.
        dispatchDevcontainerGenerate(
          ctx.state,
          docsDir,
          Array.isArray(updated.repos) ? updated.repos : [],
          updated.containerConfig ?? undefined,
        ).catch((err) => {
          console.warn(
            '[workspace.update] devcontainer config generate failed',
            err instanceof Error ? err.message : err,
          );
        });
      }

      broadcastWorkspacesSync(ctx.state);

      return updated;
    }),

  list: publicProcedure.query(() => {
    const db = getDb();
    return db.select().from(workspaces).all();
  }),

  get: publicProcedure.input(z.object({ slug: z.string() })).query(({ input }) => {
    const db = getDb();
    const workspace = db.select().from(workspaces).where(eq(workspaces.slug, input.slug)).get();
    if (!workspace) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `Workspace "${input.slug}" not found` });
    }
    return {
      ...workspace,
      resolvedDir: getWorkspaceDir(workspace),
      combinedWorktrees: deriveCombinedWorktrees(workspace),
    };
  }),

  delete: publicProcedure.input(z.object({ id: z.number() })).mutation(({ input, ctx }) => {
    const db = getDb();
    const workspace = db.select().from(workspaces).where(eq(workspaces.id, input.id)).get();
    if (!workspace) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
    }

    db.delete(workspaces).where(eq(workspaces.id, input.id)).run();

    try {
      removeWorkspaceDir(workspace.slug, workspace.docsDir);
    } catch (err) {
      console.warn(`[workspace] Failed to remove directory for ${workspace.slug}:`, err);
    }

    broadcastWorkspacesSync(ctx.state);

    return { success: true };
  }),
});
