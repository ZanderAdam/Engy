import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { router, publicProcedure } from '../trpc';
import { getAppState, type TerminalSessionMeta } from '../context';
import { getDb } from '../../db/client';
import { workspaces } from '../../db/schema';
import { dispatchFileWrite } from '../../ws/server';
import {
  TERMINAL_IMAGE_EXTENSIONS,
  TERMINAL_IMAGE_MAX_BYTES,
  terminalImageError,
} from '@/lib/terminal-image';
import {
  connectWorker,
  destroyTerminalSession,
  disconnectWorker,
  failQueuedDispatches,
  listWorkers,
  parkTerminalSession,
  setDispatchOptOut,
  setOrchestrator,
  spawnAgentTerminal,
} from '../../terminal-dispatch';
import { coderWorkspaceForSession } from '../../terminal-coder-workspace';
import { findProject, spawnScope, workspaceRepos } from '../../terminal-spawn-scope';
import { getWorkspaceDir } from '../../engy-dir/init';
import { readParkBrief } from '../../hooks/brief';
import { deriveMcpOrigin } from '../../terminal-link';
import { isAgentActive, isAgentTypeId } from '@/lib/agent-types';
import {
  listSessionHistory,
  liveHistoryKeys,
  terminalSessionKey,
} from '../../ws/terminal-session-history';
import { listSessionTaskIds } from '../../tasks/sessions';
import { resolveTerminalLinkTarget } from '../../ws/terminal-link-target';
import { broadcastTerminalWorkersChange } from '../../ws/broadcast';

const PASTE_DIR = '.engy/paste';
const MAX_BASE64_LENGTH = Math.ceil(TERMINAL_IMAGE_MAX_BYTES / 3) * 4;

// Browser-side management of the cross-terminal dispatch worker set. Agents
// consume the set via the terminal_* MCP tools (see mcp/terminal-tools.ts);
// browsers connect/disconnect sessions and render the connected badge.

function requireLiveAgentSession(sessionId: string): TerminalSessionMeta {
  const meta = getAppState().terminalSessionMeta.get(sessionId);
  if (!meta || meta.dormant) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Terminal session not found or not live' });
  }
  if (!meta.agentType) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Only agent terminals can take part in dispatch',
    });
  }
  return meta;
}

const ORCHESTRATOR_PROMPT =
  'You are the Engy orchestrator for this project. Call terminal_list_workers to see the live agent terminals of this project; you can reach no others. ' +
  'Hand independent units of work to them with terminal_dispatch, then end your turn: results arrive as [engy-notice] messages. ' +
  'Treat a reply as a claim, not proof: read its evidence, and a "stopped" state means the worker ended without reporting. ' +
  'Do not dispatch to a terminal the user did not expect, and ask the user before spawning many agents.';

export const terminalRouter = router({
  listWorkers: publicProcedure.query(() => listWorkers(getAppState())),

  setOrchestrator: publicProcedure
    .input(z.object({ sessionId: z.string(), enabled: z.boolean() }))
    .mutation(({ input }) => {
      requireLiveAgentSession(input.sessionId);
      setOrchestrator(getAppState(), input.sessionId, input.enabled);
      return { ok: true };
    }),

  setDispatchOptOut: publicProcedure
    .input(z.object({ sessionId: z.string(), optOut: z.boolean() }))
    .mutation(({ input }) => {
      requireLiveAgentSession(input.sessionId);
      setDispatchOptOut(getAppState(), input.sessionId, input.optOut);
      return { ok: true };
    }),

  startOrchestrator: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        projectSlug: z.string().optional(),
        worktreeBranch: z.string().optional(),
        workingDir: z.string().optional(),
        agentType: z.string().default('claude'),
      }),
    )
    .mutation(({ input }) => {
      const state = getAppState();
      const workspace = getDb()
        .select()
        .from(workspaces)
        .where(eq(workspaces.slug, input.workspaceSlug))
        .get();
      if (!workspace) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
      if (!isAgentTypeId(input.agentType)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown agent '${input.agentType}'` });
      }
      if (!isAgentActive(workspace.agentSettings, input.agentType)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Agent '${input.agentType}' is deactivated in this workspace`,
        });
      }
      const project = input.projectSlug ? findProject(workspace, input.projectSlug) : undefined;
      if (input.projectSlug && !project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }
      const spawned = spawnAgentTerminal(state, {
        agentType: input.agentType,
        workingDir: input.workingDir ?? workspaceRepos(workspace)[0] ?? getWorkspaceDir(workspace),
        description: 'Orchestrator',
        prompt: ORCHESTRATOR_PROMPT,
        scope: spawnScope(workspace, project, input.worktreeBranch),
        mcpOrigin: deriveMcpOrigin(undefined),
        agentSettings: workspace.agentSettings,
      });
      if (!spawned) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'No terminal daemon connected — cannot start the orchestrator',
        });
      }
      setOrchestrator(state, spawned.sessionId, true);
      return { sessionId: spawned.sessionId };
    }),

  resolveLink: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => resolveTerminalLinkTarget(getAppState(), input.sessionId)),

  // Recent agent sessions available for `--resume`, narrowed to one project
  // when the caller is on a project route. Live sessions are excluded by their
  // agent-CLI session id (`resumedFrom` for resumed terminals), so an open
  // terminal never shows as resumable.
  listSessionHistory: publicProcedure
    .input(z.object({ workspaceSlug: z.string(), projectSlug: z.string().optional() }))
    .query(({ input }) => {
      const liveKeys = liveHistoryKeys(getAppState());
      return listSessionHistory(input.workspaceSlug, liveKeys, input.projectSlug);
    }),

  // Keyed by the conversation, so a resumed terminal still shows the tasks of its earlier runs.
  linkedTasks: publicProcedure.input(z.object({ sessionId: z.string() })).query(({ input }) => {
    const meta = getAppState().terminalSessionMeta.get(input.sessionId);
    return listSessionTaskIds(terminalSessionKey(input.sessionId, meta));
  }),

  // Closing a dormant tab cannot go through the usual `{ t: 'kill' }` on the
  // terminal socket — a dormant session has neither a PTY nor a socket — so the
  // browser drops the session here. Its history row is stamped closed, which
  // puts the conversation back in the resume dropdown.
  discardDormantSession: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => {
      const state = getAppState();
      const meta = state.terminalSessionMeta.get(input.sessionId);
      if (!meta) return { ok: true };
      if (!meta.dormant) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Session is live — close it over its terminal socket instead',
        });
      }
      destroyTerminalSession(state, input.sessionId);
      return { ok: true };
    }),

  // A dormant Claude session restores with `--resume`, so parking only has to
  // stop the PTY. Other agents have no id to resume, and an agent-spawned
  // terminal belongs to its caller.
  parkSession: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input }) => {
      const state = getAppState();
      const meta = state.terminalSessionMeta.get(input.sessionId);
      if (!meta) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Terminal session not found' });
      }
      if (meta.dormant) return { ok: true };
      if (meta.agentType !== 'claude' || meta.spawnedBy) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Only a Claude terminal you opened yourself can be parked',
        });
      }
      const { transcriptPath } = meta;
      if (!transcriptPath) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Nothing to park yet: wait for the first agent reply, then park',
        });
      }
      const brief = await readParkBrief(
        transcriptPath,
        meta,
        state,
        coderWorkspaceForSession(meta),
      );
      // A second park, a close or a restore can land during the read.
      const current = state.terminalSessionMeta.get(input.sessionId);
      if (current !== meta || meta.dormant) return { ok: true };
      if (!parkTerminalSession(state, input.sessionId, meta, brief)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'No daemon connected, so the session cannot stop. Start the daemon and retry.',
        });
      }
      return { ok: true };
    }),

  uploadImage: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        mimeType: z.string(),
        base64: z.string().min(1).max(MAX_BASE64_LENGTH, 'The image is over the 5 MB limit.'),
      }),
    )
    .mutation(async ({ input }) => {
      const state = getAppState();
      const meta = state.terminalSessionMeta.get(input.sessionId);
      if (!meta) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Terminal session not found' });
      }
      const error = terminalImageError(input.mimeType, Buffer.byteLength(input.base64, 'base64'));
      if (error) throw new TRPCError({ code: 'BAD_REQUEST', message: error });

      const coderWorkspace = coderWorkspaceForSession(meta);
      const extension = TERMINAL_IMAGE_EXTENSIONS[input.mimeType];
      const filePath = `${PASTE_DIR}/${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`;
      await dispatchFileWrite(
        meta.workingDir,
        `${PASTE_DIR}/.gitignore`,
        '*\n',
        state,
        coderWorkspace,
      );
      await dispatchFileWrite(
        meta.workingDir,
        filePath,
        input.base64,
        state,
        coderWorkspace,
        'base64',
      );
      return { path: posix.join(meta.workingDir, filePath) };
    }),

  connectWorker: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        description: z.string().trim().min(1, 'Description is required'),
      }),
    )
    .mutation(({ input }) => {
      const state = getAppState();
      if (!state.terminalSessionMeta.has(input.sessionId)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Terminal session not found' });
      }
      connectWorker(state, input.sessionId, input.description);
      broadcastTerminalWorkersChange(input.sessionId, true);
      return { ok: true };
    }),

  disconnectWorker: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => {
      const state = getAppState();
      disconnectWorker(state, input.sessionId);
      failQueuedDispatches(state, input.sessionId, 'The user disconnected that worker.');
      broadcastTerminalWorkersChange(input.sessionId, false);
      return { ok: true };
    }),
});
