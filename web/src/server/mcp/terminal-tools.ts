import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getAppState } from '../trpc/context';
import {
  createDispatch,
  getWorkerOutputTail,
  listWorkers,
  resolveDispatchReply,
  waitForDispatchReply,
} from '../terminal-dispatch';
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
  correlationId: z.string().describe('Correlation id from the [engy-dispatch <id>] marker in the request'),
  result: z.string().describe('Outcome of the dispatched request (also report failures)'),
};

const terminalCollectInput = {
  correlationId: z.string().describe('Correlation id returned by terminal_dispatch'),
};

const terminalStatusInput = {
  workerSessionId: z.string().describe('Worker terminal session id'),
};

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

export function registerTerminalTools(mcp: McpServer): void {
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
    'Send a prompt to a connected worker terminal (any agent CLI). The worker replies via terminal_reply; async returns a correlationId for terminal_collect',
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

      const entry = createDispatch(state, workerSessionId, message);
      if (mode === 'sync') {
        const settled = await waitForDispatchReply(
          state,
          entry.correlationId,
          timeoutSeconds * 1000,
        );
        const summary = dispatchSummary(settled);
        if (settled.status !== 'replied' && settled.status !== 'failed') {
          return mcpResult({
            ...summary,
            hint: `No reply within ${timeoutSeconds}s — the dispatch is still ${settled.status}. Poll terminal_collect with this correlationId, or check terminal_status.`,
          });
        }
        return mcpResult(summary);
      }
      return mcpResult(dispatchSummary(entry));
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
    'Report the outcome of a dispatched request. Call this with the correlationId from the [engy-dispatch <id>] marker that arrived with the request',
    terminalReplyInput,
    async ({ correlationId, result }) => {
      const ok = resolveDispatchReply(getAppState(), correlationId, result);
      if (!ok) {
        return mcpError(
          'Unknown or already-settled correlationId. Only reply once, with the exact id from the [engy-dispatch <id>] marker.',
        );
      }
      return mcpResult({ ok: true, correlationId });
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
