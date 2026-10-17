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
  listWorkers,
} from '../../terminal-dispatch';
import { listSessionHistory } from '../../ws/terminal-session-history';
import { broadcastTerminalWorkersChange } from '../../ws/broadcast';

const PASTE_DIR = '.engy/paste';
const MAX_BASE64_LENGTH = Math.ceil(TERMINAL_IMAGE_MAX_BYTES / 3) * 4;

// Mirrors the spawn path in ws/terminal-server.ts: a session is isolated unless
// it was opened in host mode, and only a coder backend runs off this machine.
function coderWorkspaceForSession(meta: TerminalSessionMeta): string | undefined {
  if (meta.containerMode === 'host' || !meta.workspaceSlug) return undefined;
  const workspace = getDb()
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, meta.workspaceSlug))
    .get();
  if (!workspace?.containerEnabled || !workspace.docsDir) return undefined;
  if (workspace.executionBackend !== 'coder') return undefined;
  return (workspace.coderConfig as { workspace: string } | null)?.workspace;
}

// Browser-side management of the cross-terminal dispatch worker set. Agents
// consume the set via the terminal_* MCP tools (see mcp/terminal-tools.ts);
// browsers connect/disconnect sessions and render the connected badge.

export const terminalRouter = router({
  listWorkers: publicProcedure.query(() => listWorkers(getAppState())),

  // Recent agent sessions available for `--resume`, narrowed to one project
  // when the caller is on a project route. Live sessions are excluded by their
  // agent-CLI session id (`resumedFrom` for resumed terminals), so an open
  // terminal never shows as resumable.
  listSessionHistory: publicProcedure
    .input(z.object({ workspaceSlug: z.string(), projectSlug: z.string().optional() }))
    .query(({ input }) => {
      const state = getAppState();
      const liveKeys = new Set<string>();
      for (const [sessionId, meta] of state.terminalSessionMeta) {
        liveKeys.add(meta.resumedFrom ?? sessionId);
      }
      return listSessionHistory(input.workspaceSlug, liveKeys, input.projectSlug);
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
      disconnectWorker(getAppState(), input.sessionId);
      broadcastTerminalWorkersChange(input.sessionId, false);
      return { ok: true };
    }),
});
