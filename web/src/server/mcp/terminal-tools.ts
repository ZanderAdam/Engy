import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getAppState } from '../trpc/context';
import {
  AGENT_SPAWN_LIMIT,
  countAgentSpawnedSessions,
  createDispatch,
  getWorkerOutputTail,
  listWorkers,
  resolveDispatchReply,
  resolveWorkerReply,
  spawnAgentTerminal,
  waitForDispatchReply,
} from '../terminal-dispatch';
import { getDb } from '../db/client';
import { workspaces } from '../db/schema';
import { isAgentTypeId, listAgentTypes } from '@/lib/agent-types';
import { mcpResult, mcpError } from './result';

// Cross-terminal dispatch tools. These are agent-only (no tRPC counterparts by
// design — browsers manage the worker set via terminal.connectWorker /
// disconnectWorker; agents are the only callers of dispatch/reply/collect).
//
// The only gate is the connected-worker set: with nothing connected,
// terminal_list_workers returns [] and terminal_dispatch refuses every id.

const OUTPUT_TAIL_RESPONSE_CHARS = 2_000;

const terminalDispatchInput = {
  workerSessionId: z.string().describe('Target worker terminal session id (from terminal_list_workers)'),
  message: z.string().describe('Prompt to send to the worker agent'),
  mode: z
    .enum(['async', 'sync'])
    .default('async')
    .describe("async: return a correlationId immediately (collect later). sync: wait for the worker's reply"),
  timeoutSeconds: z
    .number()
    .min(1)
    .max(600)
    .default(120)
    .describe('sync mode: seconds to wait before returning a pending status'),
};

const terminalReplyInput = {
  result: z.string().describe('Outcome of the dispatched request (also report failures)'),
  correlationId: z
    .string()
    .optional()
    .describe(
      'Only needed when your request carried an [engy-dispatch <id>] marker with an id — otherwise the server matches the reply to your open dispatch automatically',
    ),
};

const terminalCollectInput = {
  correlationId: z.string().describe('Correlation id returned by terminal_dispatch'),
};

const terminalStatusInput = {
  workerSessionId: z.string().describe('Worker terminal session id'),
};

const terminalSpawnInput = {
  agentType: z
    .string()
    .describe(
      "Agent CLI to spawn ('claude' | 'codex'). Must DIFFER from your own type — same-type work belongs to your built-in subagents. The server already knows your type; a same-type attempt is refused with a hint",
    ),
  cwd: z
    .string()
    .describe('Absolute working directory — must be inside a workspace repo (worktrees included)'),
  description: z
    .string()
    .min(1)
    .max(200)
    .describe('Worker description shown in terminal_list_workers (e.g. "codex reviewing auth PR")'),
  prompt: z
    .string()
    .optional()
    .describe('Optional initial prompt the spawned agent starts working on immediately'),
};

/**
 * The spawned agent must reach the same server the caller reaches. The caller's
 * spawn command carries its own resolved MCP URL — reuse that origin. Fallback
 * (caller command without an MCP URL) is this server's local port.
 */
const MCP_URL_ORIGIN_RE = /(https?:\/\/[^/\s'"]+)\/mcp\//;

function deriveMcpOrigin(callerCommand: string | undefined): string {
  const match = callerCommand ? MCP_URL_ORIGIN_RE.exec(callerCommand) : null;
  return match ? match[1] : `http://localhost:${process.env.PORT ?? '3000'}`;
}

function listAllWorkspaceRepos(): string[] {
  const rows = getDb().select({ repos: workspaces.repos }).from(workspaces).all();
  return rows.flatMap((row) => (Array.isArray(row.repos) ? row.repos : []));
}

// Resolve symlinks so a symlinked repo root and its real path compare equal.
// Falls back to the resolved path when it does not exist on this host (the
// server may run remotely; the daemon still validates at spawn).
function safeRealpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function isInsideAnyRepo(cwd: string, repos: string[]): boolean {
  const resolved = safeRealpath(path.resolve(cwd));
  return repos.some((repo) => {
    const root = safeRealpath(path.resolve(repo));
    return resolved === root || resolved.startsWith(root + path.sep);
  });
}

function dispatchSummary(entry: {
  correlationId: string;
  workerSessionId: string;
  status: string;
  result?: string;
  error?: string;
}) {
  return {
    correlationId: entry.correlationId,
    workerSessionId: entry.workerSessionId,
    status: entry.status,
    result: entry.result,
    error: entry.error,
  };
}

// `callerTerminalSessionId` is the path token from the caller's `/mcp/<id>`
// endpoint (undefined for anonymous plain-/mcp callers). It identifies which
// terminal — and therefore which agent type — is making the call.
export function registerTerminalTools(mcp: McpServer, callerTerminalSessionId?: string): void {
  mcp.tool(
    'terminal_whoami',
    "Identify the calling agent: its Engy terminal session id and agent type (claude/codex/…). Purely informational — every terminal tool already knows the caller from its per-session MCP endpoint. Returns identified:false for agents Engy didn't register.",
    {},
    async () => {
      if (!callerTerminalSessionId) {
        return mcpResult({
          identified: false,
          hint: 'This MCP connection has no Engy terminal identity (registered at plain /mcp, not /mcp/<session>).',
        });
      }
      const meta = getAppState().terminalSessionMeta.get(callerTerminalSessionId);
      return mcpResult({
        identified: true,
        // false = the token has no live terminal session behind it (session
        // ended, server restarted, or a fabricated token).
        live: meta !== undefined,
        terminalSessionId: callerTerminalSessionId,
        agentType: meta?.agentType ?? null,
        scopeLabel: meta?.scopeLabel ?? null,
        workingDir: meta?.workingDir ?? null,
      });
    },
  );

  mcp.tool(
    'terminal_spawn',
    'Spawn a new agent terminal of a DIFFERENT agent type (cross-agent delegation; same-type work belongs to your built-in subagents). The spawned terminal auto-connects as a dispatch worker — send it work via terminal_dispatch',
    terminalSpawnInput,
    async ({ agentType, cwd, description, prompt }) => {
      const state = getAppState();
      if (!callerTerminalSessionId) {
        return mcpError(
          'terminal_spawn requires an identified caller, but this MCP connection is anonymous (plain /mcp). Only agent terminals Engy spawned (endpoint /mcp/<session>) can spawn others.',
        );
      }
      const callerMeta = state.terminalSessionMeta.get(callerTerminalSessionId);
      if (!callerMeta) {
        return mcpError('Caller terminal session is not live — cannot attribute the spawn.');
      }
      const callerType = callerMeta.agentType;
      if (!callerType || !isAgentTypeId(callerType)) {
        return mcpError(
          'Caller agent type is unknown — cannot enforce the different-type rule, spawn refused.',
        );
      }
      const knownTypes = listAgentTypes().map((t) => t.id);
      if (!isAgentTypeId(agentType)) {
        return mcpError(`Unknown agentType '${agentType}'. Available: ${knownTypes.join(', ')}.`);
      }
      if (agentType === callerType) {
        const otherTypes = knownTypes.filter((id) => id !== callerType);
        return mcpError(
          `Same-type spawn refused: you are already a ${callerType} agent — use your own subagent mechanism for ${callerType} work. terminal_spawn is for cross-agent delegation (available: ${otherTypes.join(', ')}).`,
        );
      }
      const liveSpawned = countAgentSpawnedSessions(state);
      if (liveSpawned >= AGENT_SPAWN_LIMIT) {
        return mcpError(
          `Agent-spawned terminal limit reached (${AGENT_SPAWN_LIMIT} live). Reuse an existing worker via terminal_dispatch, or ask the user to close one.`,
        );
      }
      const repos = listAllWorkspaceRepos();
      if (!isInsideAnyRepo(cwd, repos)) {
        return mcpError(
          `cwd must be inside a workspace repo (worktrees under a repo count). Registered repos: ${repos.join(', ') || '(none)'}.`,
        );
      }

      const spawned = spawnAgentTerminal(state, {
        agentType,
        workingDir: cwd,
        description,
        prompt,
        spawnedBy: callerTerminalSessionId,
        callerMeta,
        mcpOrigin: deriveMcpOrigin(callerMeta.command),
      });
      if (!spawned) {
        return mcpError('No terminal daemon connected — cannot spawn.');
      }
      return mcpResult({
        sessionId: spawned.sessionId,
        agentType,
        description,
        hint: prompt
          ? 'Worker is booting and will start on the initial prompt. You can terminal_dispatch follow-ups immediately — they queue and deliver when the worker is ready.'
          : 'Worker is booting. terminal_dispatch work to it immediately — messages queue and deliver as soon as the CLI is ready.',
      });
    },
  );

  mcp.tool(
    'terminal_list_workers',
    'List terminal sessions connected as dispatch workers — other live agent sessions that accept dispatched prompts',
    {},
    async () => {
      const workers = listWorkers(getAppState());
      if (workers.length === 0) {
        return mcpResult({
          workers: [],
          hint: 'No worker terminals are connected. The user connects a terminal as a worker from the Engy terminal panel.',
        });
      }
      return mcpResult({ workers });
    },
  );

  mcp.tool(
    'terminal_dispatch',
    "Send a prompt to a connected worker terminal (any agent CLI). The worker replies via terminal_reply; in async mode the settled result is pushed into your terminal when ready (no polling needed if you're an Engy-spawned agent)",
    terminalDispatchInput,
    async ({ workerSessionId, message, mode, timeoutSeconds }) => {
      const state = getAppState();
      if (!state.dispatchWorkers.has(workerSessionId)) {
        return mcpError(
          'Unknown worker session. Call terminal_list_workers for connected workers; the user connects them from the terminal panel.',
        );
      }
      if (!state.terminalSessionMeta.has(workerSessionId)) {
        return mcpError('Worker terminal is no longer alive.');
      }
      if (!state.terminalDaemon || state.terminalDaemon.readyState !== state.terminalDaemon.OPEN) {
        return mcpError('No terminal daemon connected — cannot deliver input.');
      }

      // Identified callers get the settled result pushed into their terminal —
      // in async mode always, in sync mode only if the wait times out below.
      const canNotify =
        callerTerminalSessionId != null && state.terminalSessionMeta.has(callerTerminalSessionId);
      const entry = createDispatch(state, workerSessionId, message, {
        originSessionId: canNotify ? callerTerminalSessionId : undefined,
        notifyOnReply: canNotify && mode === 'async',
      });
      if (mode === 'sync') {
        const settled = await waitForDispatchReply(
          state,
          entry.correlationId,
          timeoutSeconds * 1000,
        );
        const summary = dispatchSummary(settled);
        if (settled.status !== 'replied' && settled.status !== 'failed') {
          if (canNotify) entry.notifyOnReply = true;
          return mcpResult({
            ...summary,
            hint: canNotify
              ? `No reply within ${timeoutSeconds}s — the dispatch is still ${settled.status}. The result will be pushed into your terminal when the worker replies; terminal_collect also works.`
              : `No reply within ${timeoutSeconds}s — the dispatch is still ${settled.status}. Poll terminal_collect with this correlationId, or check terminal_status.`,
          });
        }
        return mcpResult(summary);
      }
      return mcpResult({
        ...dispatchSummary(entry),
        hint: canNotify
          ? "The worker's reply will be pushed into your terminal when ready — no need to poll terminal_collect."
          : 'Poll terminal_collect with this correlationId for the reply.',
      });
    },
  );

  mcp.tool(
    'terminal_collect',
    'Fetch the current state (and reply, once available) of a dispatch by correlationId',
    terminalCollectInput,
    async ({ correlationId }) => {
      const entry = getAppState().dispatches.get(correlationId);
      if (!entry) return mcpError(`Unknown correlationId: ${correlationId}`);
      return mcpResult(dispatchSummary(entry));
    },
  );

  mcp.tool(
    'terminal_reply',
    'Report the outcome of a request that arrived with an [engy-dispatch] marker. The server matches the reply to your open dispatch; pass correlationId only when the marker included an id',
    terminalReplyInput,
    async ({ correlationId, result }) => {
      const state = getAppState();
      if (correlationId) {
        const ok = resolveDispatchReply(state, correlationId, result);
        if (!ok) {
          return mcpError(
            'Unknown or already-settled correlationId. Only reply once, with the exact id from the [engy-dispatch <id>] marker.',
          );
        }
        return mcpResult({ ok: true, correlationId });
      }
      if (!callerTerminalSessionId) {
        return mcpError(
          'Cannot match this reply: your MCP connection is anonymous (plain /mcp), so a correlationId is required — use the id from the [engy-dispatch <id>] marker.',
        );
      }
      const settled = resolveWorkerReply(state, callerTerminalSessionId, result);
      if (!settled) {
        return mcpError(
          'No open dispatch found for your terminal session — it may already be settled. Nothing to reply to.',
        );
      }
      return mcpResult({ ok: true, correlationId: settled.correlationId });
    },
  );

  mcp.tool(
    'terminal_status',
    "Inspect a connected worker: description, agent type, activity state, and a recent tail of the worker's terminal output",
    terminalStatusInput,
    async ({ workerSessionId }) => {
      const state = getAppState();
      const worker = listWorkers(state).find((w) => w.sessionId === workerSessionId);
      if (!worker) {
        return mcpError('Unknown worker session. Call terminal_list_workers for connected workers.');
      }
      const tail = getWorkerOutputTail(state, workerSessionId);
      return mcpResult({
        ...worker,
        outputTail: tail.slice(-OUTPUT_TAIL_RESPONSE_CHARS),
      });
    },
  );
}
