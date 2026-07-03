import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type WebSocket from 'ws';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTerminalTools } from './terminal-tools';
import { getAppState, resetAppState, type AppState } from '../trpc/context';
import { connectWorker, resolveDispatchReply } from '../terminal-dispatch';

// Mirrors index.test.ts's harness: invoke a registered tool handler directly,
// applying the tool's zod schema (defaults included) like the SDK would.
function callTool(mcp: McpServer, name: string) {
  const tools = (mcp as unknown as { _registeredTools: Record<string, { inputSchema?: { safeParse?: (p: unknown) => { success: boolean; data: unknown } }; handler: (args: unknown, extra: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }> }> })._registeredTools;
  return async (params: Record<string, unknown> = {}) => {
    const tool = tools[name];
    const parsed = tool.inputSchema?.safeParse?.(params);
    const args = parsed?.success ? parsed.data : params;
    const result = await tool.handler(args, {});
    return {
      data: JSON.parse(result.content[0].text) as Record<string, unknown>,
      isError: result.isError === true,
    };
  };
}

function makeMcp(): McpServer {
  const mcp = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerTerminalTools(mcp);
  return mcp;
}

function fakeDaemon(sent: string[]): WebSocket {
  return { readyState: 1, OPEN: 1, send: (d: string) => sent.push(d) } as unknown as WebSocket;
}

function addWorkerSession(state: AppState, sessionId: string, description: string): void {
  state.terminalSessionMeta.set(sessionId, {
    scopeType: 'project',
    scopeLabel: `label-${sessionId}`,
    workingDir: '/tmp',
    activityState: 'idle',
    agentType: 'codex',
    cols: 80,
    rows: 24,
  });
  connectWorker(state, sessionId, description);
}

describe('MCP terminal tools', () => {
  let state: AppState;
  let sent: string[];

  beforeEach(() => {
    resetAppState();
    state = getAppState();
    sent = [];
    state.terminalDaemon = fakeDaemon(sent);
  });

  afterEach(() => {
    resetAppState();
    vi.useRealTimers();
  });

  describe('terminal_list_workers', () => {
    it('[FR-MCP-130] should return an empty list with a hint when nothing is connected', async () => {
      const call = callTool(makeMcp(), 'terminal_list_workers');
      const { data, isError } = await call();
      expect(isError).toBe(false);
      expect(data.workers).toEqual([]);
      expect(String(data.hint)).toContain('connects');
    });

    it('[FR-MCP-130] should list connected workers with description, agent type, and activity', async () => {
      addWorkerSession(state, 'w1', 'codex on frontend');
      const { data } = await callTool(makeMcp(), 'terminal_list_workers')();
      const workers = data.workers as Array<Record<string, unknown>>;
      expect(workers).toHaveLength(1);
      expect(workers[0]).toMatchObject({
        sessionId: 'w1',
        description: 'codex on frontend',
        agentType: 'codex',
        activityState: 'idle',
      });
    });
  });

  describe('terminal_dispatch', () => {
    it('[FR-MCP-110] should refuse unknown worker sessions', async () => {
      const { data, isError } = await callTool(makeMcp(), 'terminal_dispatch')({
        workerSessionId: 'ghost',
        message: 'hi',
      });
      expect(isError).toBe(true);
      expect(String(data.error)).toContain('Unknown worker');
    });

    it('[FR-MCP-110] should refuse when the worker session is no longer alive', async () => {
      connectWorker(state, 'w1', 'stale');
      const { isError, data } = await callTool(makeMcp(), 'terminal_dispatch')({
        workerSessionId: 'w1',
        message: 'hi',
      });
      expect(isError).toBe(true);
      expect(String(data.error)).toContain('no longer alive');
    });

    it('[FR-MCP-110] should error when no terminal daemon is connected', async () => {
      addWorkerSession(state, 'w1', 'worker');
      state.terminalDaemon = null;
      const { isError, data } = await callTool(makeMcp(), 'terminal_dispatch')({
        workerSessionId: 'w1',
        message: 'hi',
      });
      expect(isError).toBe(true);
      expect(String(data.error)).toContain('daemon');
    });

    it('[FR-MCP-110] should return a correlationId immediately in async mode', async () => {
      addWorkerSession(state, 'w1', 'worker');
      const { data, isError } = await callTool(makeMcp(), 'terminal_dispatch')({
        workerSessionId: 'w1',
        message: 'do the thing',
      });
      expect(isError).toBe(false);
      expect(data.status).toBe('delivered');
      expect(typeof data.correlationId).toBe('string');
      expect(sent.length).toBeGreaterThan(0);
    });

    it('[FR-MCP-110] should wait for the reply in sync mode', async () => {
      addWorkerSession(state, 'w1', 'worker');
      const call = callTool(makeMcp(), 'terminal_dispatch')({
        workerSessionId: 'w1',
        message: 'do the thing',
        mode: 'sync',
        timeoutSeconds: 30,
      });
      // Reply as soon as the dispatch shows up in state.
      await vi.waitFor(() => {
        expect(state.dispatches.size).toBe(1);
      });
      const correlationId = [...state.dispatches.keys()][0];
      resolveDispatchReply(state, correlationId, 'all done');

      const { data } = await call;
      expect(data.status).toBe('replied');
      expect(data.result).toBe('all done');
    });

    it('[FR-MCP-110] should return a pending hint when sync mode times out', async () => {
      vi.useFakeTimers();
      addWorkerSession(state, 'w1', 'worker');
      const call = callTool(makeMcp(), 'terminal_dispatch')({
        workerSessionId: 'w1',
        message: 'slow thing',
        mode: 'sync',
        timeoutSeconds: 1,
      });
      await vi.advanceTimersByTimeAsync(1_000);
      const { data, isError } = await call;
      expect(isError).toBe(false);
      expect(data.status).toBe('delivered');
      expect(String(data.hint)).toContain('terminal_collect');
    });
  });

  describe('terminal_reply / terminal_collect', () => {
    it('[FR-MCP-120] should settle the dispatch once and expose it via terminal_collect', async () => {
      addWorkerSession(state, 'w1', 'worker');
      const mcp = makeMcp();
      const { data: dispatched } = await callTool(mcp, 'terminal_dispatch')({
        workerSessionId: 'w1',
        message: 'task',
      });
      const correlationId = dispatched.correlationId as string;

      const { data: replied, isError } = await callTool(mcp, 'terminal_reply')({
        correlationId,
        result: 'finished',
      });
      expect(isError).toBe(false);
      expect(replied.ok).toBe(true);

      const { data: collected } = await callTool(mcp, 'terminal_collect')({ correlationId });
      expect(collected.status).toBe('replied');
      expect(collected.result).toBe('finished');

      const second = await callTool(mcp, 'terminal_reply')({ correlationId, result: 'again' });
      expect(second.isError).toBe(true);
    });

    it('[FR-MCP-120] should reject replies with unknown correlation ids', async () => {
      const { isError } = await callTool(makeMcp(), 'terminal_reply')({
        correlationId: 'ghost',
        result: 'x',
      });
      expect(isError).toBe(true);
    });

    it('should error on collect with an unknown correlation id', async () => {
      const { isError, data } = await callTool(makeMcp(), 'terminal_collect')({
        correlationId: 'ghost',
      });
      expect(isError).toBe(true);
      expect(String(data.error)).toContain('Unknown correlationId');
    });
  });

  describe('terminal_status', () => {
    it('[FR-MCP-140] should return worker info with an ANSI-stripped output tail', async () => {
      addWorkerSession(state, 'w1', 'worker');
      state.terminalOutputTails.set('w1', '\x1b[31mred\x1b[0m output');
      const { data } = await callTool(makeMcp(), 'terminal_status')({ workerSessionId: 'w1' });
      expect(data).toMatchObject({
        sessionId: 'w1',
        description: 'worker',
        outputTail: 'red output',
      });
    });

    it('should refuse unknown workers', async () => {
      const { isError } = await callTool(makeMcp(), 'terminal_status')({ workerSessionId: 'x' });
      expect(isError).toBe(true);
    });
  });
});
