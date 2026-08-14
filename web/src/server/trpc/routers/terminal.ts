import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getAppState } from '../context';
import {
  connectWorker,
  destroyTerminalSession,
  disconnectWorker,
  listWorkers,
} from '../../terminal-dispatch';
import { listSessionHistory } from '../../ws/terminal-session-history';
import { broadcastTerminalWorkersChange } from '../../ws/broadcast';

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
