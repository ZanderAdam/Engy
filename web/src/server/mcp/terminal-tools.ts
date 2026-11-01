import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getAppState, type AppState, type DispatchEntry } from '../trpc/context';
import type { StoredEvidence } from '../db/schema';
import {
  SPAWN_WARN_ABOVE,
  checkSpawnLimits,
  closeAgentTerminal,
  countAgentSpawnedSessions,
  createDispatch,
  dispatchRefusal,
  getWorkerOutputTail,
  listWorkers,
  orchestratorMeta,
  resolveDispatchReply,
  resolveWorkerReply,
  sameProject,
  spawnAgentTerminal,
  waitForDispatchReply,
} from '../terminal-dispatch';
import { SETTLED_STATUSES, getDispatch, saveDispatch } from '../terminal-dispatch-store';
import { resolveSpawnTarget, listAllWorkspaceRepos } from '../terminal-spawn-scope';
import { getDb } from '../db/client';
import { workspaces } from '../db/schema';
import { dispatchGitShow } from '../ws/server';
import { coderWorkspaceForSession } from '../terminal-coder-workspace';
import { isAgentTypeId, isAgentActive, listAgentTypes } from '@/lib/agent-types';
import { listTerminalSessions } from '../ws/terminal-session-list';
import { listSessionHistory, liveHistoryKeys } from '../ws/terminal-session-history';
import { deriveMcpOrigin, terminalLink } from '../terminal-link';
import { mcpResult, mcpError } from './result';

// Cross-terminal dispatch tools. These are agent-only (no tRPC counterparts by
// design — browsers manage the worker set via terminal.connectWorker /
// disconnectWorker and the orchestrator role via terminal.setOrchestrator;
// agents are the only callers of dispatch/reply/collect).

const DEFAULT_STATUS_LINES = 50;
const CLOSED_SESSIONS_PER_WORKSPACE = 10;

const terminalDispatchInput = {
  workerSessionId: z
    .string()
    .describe('Target worker terminal session id (from terminal_list_workers)'),
  message: z.string().describe('Prompt to send to the worker agent'),
  mode: z
    .enum(['async', 'sync'])
    .default('async')
    .describe(
      "async: return a correlationId immediately (collect later). sync: wait for the worker's reply",
    ),
  timeoutSeconds: z
    .number()
    .min(1)
    .max(600)
    .default(120)
    .describe('sync mode: seconds to wait before returning a pending status'),
};

const evidenceSchema = z
  .object({
    commit: z
      .string()
      .regex(/^[0-9a-f]{7,40}$/i)
      .optional()
      .describe('Commit hash of the work, if you committed. The server checks it against the repo'),
    commands: z
      .array(z.object({ command: z.string(), exitCode: z.number().int() }))
      .max(30)
      .optional()
      .describe('Commands you ran to check the work (tests, build, lint) with their exit codes'),
    filesChanged: z.array(z.string()).max(200).optional().describe('Paths you changed'),
    notVerified: z
      .array(z.string())
      .max(50)
      .optional()
      .describe('Things you did NOT verify or could not run. Say so instead of claiming done'),
  })
  .optional();

const terminalReplyInput = {
  result: z
    .string()
    .describe(
      'The answer/deliverable itself — this exact text is what the requesting agent receives (your terminal output does not reach it). Not a status note about having answered. On failure, describe what went wrong',
    ),
  correlationId: z
    .string()
    .optional()
    .describe(
      'Only needed when your request carried an [engy-dispatch <id>] marker with an id — otherwise the server matches the reply to your open dispatch automatically',
    ),
  evidence: evidenceSchema.describe(
    'Optional proof for the claim in `result`: commit hash, commands with exit codes, files changed, and what you did not verify',
  ),
};

const terminalCollectInput = {
  correlationId: z.string().describe('Correlation id returned by terminal_dispatch'),
};

const terminalStatusInput = {
  workerSessionId: z.string().describe('Agent terminal session id'),
  lines: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(DEFAULT_STATUS_LINES)
    .describe('How many trailing output lines to return. For debugging only — not a status signal'),
};

const terminalCloseInput = {
  sessionId: z.string().describe('Session id of a terminal you spawned via terminal_spawn'),
};

const terminalSpawnInput = {
  agentType: z
    .string()
    .describe(
      "Agent CLI to spawn ('claude' | 'codex'). Any registered type is allowed, including your own",
    ),
  cwd: z
    .string()
    .describe(
      'Absolute working directory — must be inside a workspace repo (worktrees included). The workspace and project that own it decide the terminal scope and agent settings',
    ),
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

function dispatchSummary(entry: DispatchEntry) {
  return {
    correlationId: entry.correlationId,
    workerSessionId: entry.workerSessionId,
    status: entry.status,
    result: entry.result,
    error: entry.error,
    stopReason: entry.stopReason,
    lastOutput: entry.lastOutput,
    evidence: entry.evidence,
  };
}

const GIT_AMBIGUOUS_SHORT_HASH_RE = /short object ID \S+ is ambiguous/i;
const GIT_MISSING_COMMIT_RE =
  /bad object|bad revision|unknown revision|not a valid object name|ambiguous argument/i;

async function verifyCommit(
  state: AppState,
  repoDir: string | undefined,
  commit: string,
  coderWorkspace: string | undefined,
): Promise<NonNullable<StoredEvidence['commitVerified']>> {
  if (!repoDir) return 'unverified';
  try {
    await dispatchGitShow(repoDir, commit, state, coderWorkspace);
    return 'verified';
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (GIT_AMBIGUOUS_SHORT_HASH_RE.test(message)) return 'unverified';
    return GIT_MISSING_COMMIT_RE.test(message) ? 'not_found' : 'unverified';
  }
}

// `callerTerminalSessionId` is the path token from the caller's `/mcp/<id>`
// endpoint (undefined for anonymous plain-/mcp callers). It identifies which
// terminal — and therefore which agent type — is making the call.
export function registerTerminalTools(mcp: McpServer, callerTerminalSessionId?: string): void {
  function callerOrigin(state: AppState): string {
    const command = callerTerminalSessionId
      ? state.terminalSessionMeta.get(callerTerminalSessionId)?.command
      : undefined;
    return deriveMcpOrigin(command);
  }

  async function withVerifiedCommit(
    state: AppState,
    evidence: z.infer<typeof evidenceSchema>,
    repoSessionId: string | undefined,
  ): Promise<StoredEvidence | undefined> {
    if (!evidence) return undefined;
    if (!evidence.commit) return evidence;
    const meta = repoSessionId ? state.terminalSessionMeta.get(repoSessionId) : undefined;
    const commitVerified = await verifyCommit(
      state,
      meta?.agentCwd ?? meta?.workingDir,
      evidence.commit,
      meta ? coderWorkspaceForSession(meta) : undefined,
    );
    return { ...evidence, commitVerified };
  }

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
        orchestrator: meta?.orchestrator === true,
        link: terminalLink(callerOrigin(getAppState()), callerTerminalSessionId),
      });
    },
  );

  mcp.tool(
    'terminal_spawn',
    'Spawn a new agent terminal of any registered agent type, including your own. The spawned terminal auto-connects as a dispatch worker — send it work via terminal_dispatch. An orchestrator spawns only in its own project',
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
      if (!callerMeta.agentType || !isAgentTypeId(callerMeta.agentType)) {
        return mcpError(
          'Caller agent type is unknown — only registered agent terminals can spawn, spawn refused.',
        );
      }
      const knownTypes = listAgentTypes().map((t) => t.id);
      if (!isAgentTypeId(agentType)) {
        return mcpError(`Unknown agentType '${agentType}'. Available: ${knownTypes.join(', ')}.`);
      }
      if (!path.isAbsolute(cwd)) {
        return mcpError(`cwd must be an absolute path, got '${cwd}'. Pass the full repo path.`);
      }
      const orchestrator = orchestratorMeta(state, callerTerminalSessionId);
      const target = await resolveSpawnTarget(cwd, state, orchestrator);
      if (!target) {
        const repos = listAllWorkspaceRepos();
        return mcpError(
          `cwd must be inside a workspace repo (worktrees under a repo count). Registered repos: ${repos.join(', ') || '(none)'}.`,
        );
      }
      if (orchestrator && !sameProject(orchestrator, target.scope)) {
        return mcpError(
          `cwd is outside your project — an orchestrator spawns only in the project it runs in (${orchestrator.scopeLabel}).`,
        );
      }
      if (!isAgentActive(target.workspace.agentSettings, agentType)) {
        return mcpError(
          `Agent type '${agentType}' is deactivated in workspace '${target.workspace.slug}' settings — spawn refused.`,
        );
      }
      const refusal = checkSpawnLimits(state, callerTerminalSessionId, callerMeta);
      if (refusal) return mcpError(refusal);

      const spawned = spawnAgentTerminal(state, {
        agentType,
        workingDir: cwd,
        description,
        prompt,
        spawnedBy: callerTerminalSessionId,
        spawnDepth: (callerMeta.spawnDepth ?? 0) + 1,
        scope: target.scope,
        mcpOrigin: deriveMcpOrigin(callerMeta.command),
        agentSettings: target.workspace.agentSettings,
      });
      if (!spawned) {
        return mcpError('No terminal daemon connected — cannot spawn.');
      }
      const activeSpawned = countAgentSpawnedSessions(state);
      return mcpResult({
        sessionId: spawned.sessionId,
        agentType,
        description,
        hint: prompt
          ? 'Worker is booting and will start on the initial prompt. You can terminal_dispatch follow-ups immediately — they queue and deliver when the worker is ready.'
          : 'Worker is booting. terminal_dispatch work to it immediately — messages queue and deliver as soon as the CLI is ready.',
        ...(activeSpawned > SPAWN_WARN_ABOVE
          ? {
              warning: `${activeSpawned} agent-spawned terminals are active (warning above ${SPAWN_WARN_ABOVE}). Use parallel workers only for independent tasks; overlapping edits do worse than one agent.`,
            }
          : {}),
      });
    },
  );

  mcp.tool(
    'terminal_close',
    'Close a terminal you spawned via terminal_spawn (kills its PTY and frees a spawn slot). Only your own spawned terminals — user-opened terminals cannot be closed',
    terminalCloseInput,
    async ({ sessionId }) => {
      const state = getAppState();
      if (!callerTerminalSessionId) {
        return mcpError(
          'terminal_close requires an identified caller, but this MCP connection is anonymous (plain /mcp).',
        );
      }
      const meta = state.terminalSessionMeta.get(sessionId);
      if (!meta) {
        return mcpError('Unknown or already-closed terminal session.');
      }
      if (meta.spawnedBy !== callerTerminalSessionId) {
        return mcpError(
          meta.spawnedBy
            ? 'That terminal was spawned by a different agent — only its spawner can close it.'
            : 'That terminal was opened by the user — agents can only close terminals they spawned via terminal_spawn.',
        );
      }
      if (!closeAgentTerminal(state, sessionId)) {
        return mcpError('No terminal daemon connected — cannot kill the PTY, close refused.');
      }
      return mcpResult({ ok: true, sessionId, closed: meta.scopeLabel });
    },
  );

  mcp.tool(
    'terminal_list_workers',
    'List every live agent terminal across all workspaces (plain shells excluded). An orchestrator sees only the terminals of its own project, and may dispatch to any of them. `connected` is true when the user connected it as a dispatch worker; other callers may dispatch only to connected ones',
    {},
    async () => {
      const state = getAppState();
      const origin = callerOrigin(state);
      const orchestrator = orchestratorMeta(state, callerTerminalSessionId);
      const workers = listWorkers(state)
        .filter((worker) => !orchestrator || sameProject(orchestrator, worker))
        .map((worker) => ({
          ...worker,
          link: terminalLink(origin, worker.sessionId),
        }));
      if (workers.length === 0) {
        return mcpResult({
          workers: [],
          hint: 'No live agent terminals. Open an agent terminal in the Engy UI first.',
        });
      }
      return mcpResult({ workers });
    },
  );

  mcp.tool(
    'terminal_sessions',
    'List every agent session across all workspaces, read-only: live and dormant terminals plus recent closed sessions (resumable history). Plain shells are excluded. Each row has state (live | dormant | closed), activityState, workspace/project/branch/task identity, lastFailure, activeSubagents, and a `link` that opens it (closed sessions offer Resume when history allows). Task identity is on live and dormant rows only.',
    {},
    async () => {
      const state = getAppState();
      const origin = callerOrigin(state);

      const open = listTerminalSessions(state, {
        all: true,
        groupKey: null,
        scopeType: '',
        scopeLabel: '',
      })
        .filter((session) => session.agentType !== undefined)
        .map((session) => ({
          sessionId: session.sessionId,
          state: session.dormant ? 'dormant' : 'live',
          activityState: session.activityState,
          agentType: session.agentType,
          scopeLabel: session.renamedLabel ?? session.scopeLabel,
          lastTitle: session.lastTitle,
          workspaceSlug: session.workspaceSlug,
          projectSlug: session.projectSlug,
          worktreeBranch: session.worktreeBranch,
          taskId: session.taskId,
          lastFailure: session.lastFailure,
          activeSubagents: session.activeSubagents,
          link: terminalLink(origin, session.sessionId),
        }));

      const liveKeys = liveHistoryKeys(state);
      const slugs = getDb().select({ slug: workspaces.slug }).from(workspaces).all();
      const closed = slugs.flatMap(({ slug }) =>
        listSessionHistory(slug, liveKeys)
          .slice(0, CLOSED_SESSIONS_PER_WORKSPACE)
          .map((row) => ({
            sessionId: row.sessionId,
            state: 'closed',
            agentType: row.agentType,
            scopeLabel: row.scopeLabel,
            summary: row.summary,
            workspaceSlug: row.workspaceSlug,
            projectSlug: row.projectSlug,
            worktreeBranch: row.worktreeBranch,
            closedAt: row.closedAt,
            link: terminalLink(origin, row.sessionId),
          })),
      );

      return mcpResult({ sessions: [...open, ...closed] });
    },
  );

  mcp.tool(
    'terminal_dispatch',
    "Send a prompt to an agent terminal. Allowed for terminals the user connected as workers; when you hold the orchestrator role, allowed for every live agent terminal of your project and no other. The worker replies via terminal_reply; in async mode the settled result is pushed into your terminal when ready (no polling needed if you're an Engy-spawned agent)",
    terminalDispatchInput,
    async ({ workerSessionId, message, mode, timeoutSeconds }) => {
      const state = getAppState();
      const refusal = dispatchRefusal(state, callerTerminalSessionId, workerSessionId);
      if (refusal) return mcpError(refusal);
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
        if (!SETTLED_STATUSES.includes(settled.status)) {
          if (canNotify) {
            settled.notifyOnReply = true;
            saveDispatch(settled);
          }
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
    'Fetch the current state (and reply, once available) of a dispatch by correlationId. Status: queued, written (sent to the terminal), delivered (worker turn started), replied, stopped (turn ended with no reply — see stopReason and lastOutput), failed',
    terminalCollectInput,
    async ({ correlationId }) => {
      const entry = getDispatch(correlationId);
      if (!entry) return mcpError(`Unknown correlationId: ${correlationId}`);
      return mcpResult(dispatchSummary(entry));
    },
  );

  mcp.tool(
    'terminal_reply',
    'Report the outcome of a request that arrived with an [engy-dispatch] marker. The server matches the reply to your open dispatch; pass correlationId only when the marker included an id. Attach `evidence` (commit, commands with exit codes, files changed, not-verified items) so the requester does not have to trust the text alone',
    terminalReplyInput,
    async ({ correlationId, result, evidence }) => {
      const state = getAppState();
      if (correlationId) {
        const repoSessionId =
          callerTerminalSessionId ?? getDispatch(correlationId)?.workerSessionId;
        const stored = await withVerifiedCommit(state, evidence, repoSessionId);
        const ok = resolveDispatchReply(state, correlationId, result, stored);
        if (!ok) {
          return mcpError(
            'Unknown or already-settled correlationId. Only reply once, with the exact id from the [engy-dispatch <id>] marker.',
          );
        }
        return mcpResult({ ok: true, correlationId, evidence: stored });
      }
      if (!callerTerminalSessionId) {
        return mcpError(
          'Cannot match this reply: your MCP connection is anonymous (plain /mcp), so a correlationId is required — use the id from the [engy-dispatch <id>] marker.',
        );
      }
      const stored = await withVerifiedCommit(state, evidence, callerTerminalSessionId);
      const settled = resolveWorkerReply(state, callerTerminalSessionId, result, stored);
      if (!settled) {
        return mcpError(
          'Cannot match this reply to exactly one open dispatch for your terminal (none open, already settled, or several in flight). Pass correlationId with the id from the [engy-dispatch <id>] marker.',
        );
      }
      return mcpResult({ ok: true, correlationId: settled.correlationId, evidence: stored });
    },
  );

  mcp.tool(
    'terminal_status',
    'Inspect a live agent terminal: description, agent type, activity state, and the last `lines` lines (default 50) of its terminal output. Output is returned for connected workers; an orchestrator gets it for the terminals of its own project only. The output is for debugging only — it never feeds status',
    terminalStatusInput,
    async ({ workerSessionId, lines }) => {
      const state = getAppState();
      const worker = listWorkers(state).find((w) => w.sessionId === workerSessionId);
      if (!worker) {
        return mcpError(
          'Unknown agent terminal. Call terminal_list_workers for live agent terminals.',
        );
      }
      const meta = state.terminalSessionMeta.get(workerSessionId);
      const orchestrator = orchestratorMeta(state, callerTerminalSessionId);
      const mayReadOutput = orchestrator ? sameProject(orchestrator, worker) : worker.connected;
      return mcpResult({
        ...worker,
        link: terminalLink(callerOrigin(state), workerSessionId),
        activeSubagents: meta?.activeSubagents ?? 0,
        lastFailure: meta?.lastFailure,
        outputTail: mayReadOutput ? getWorkerOutputTail(state, workerSessionId, lines) : undefined,
      });
    },
  );
}
