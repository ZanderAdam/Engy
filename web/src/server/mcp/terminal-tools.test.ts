import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type WebSocket from 'ws';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTerminalTools } from './terminal-tools';
import { getAppState, resetAppState, type AppState } from '../trpc/context';
import {
  AGENT_SPAWN_LIMIT,
  connectWorker,
  resolveDispatchReply,
} from '../terminal-dispatch';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { workspaces } from '../db/schema';

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

function makeMcp(callerTerminalSessionId?: string): McpServer {
  const mcp = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerTerminalTools(mcp, callerTerminalSessionId);
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

  describe('terminal_whoami', () => {
    it('[FR-MCP-150] should return the caller identity resolved from the path token', async () => {
      state.terminalSessionMeta.set('sess-me', {
        scopeType: 'project',
        scopeLabel: 'project: default',
        workingDir: '/repo',
        agentType: 'codex',
        cols: 80,
        rows: 24,
      });
      const { data, isError } = await callTool(makeMcp('sess-me'), 'terminal_whoami')();
      expect(isError).toBe(false);
      expect(data).toMatchObject({
        identified: true,
        live: true,
        terminalSessionId: 'sess-me',
        agentType: 'codex',
        scopeLabel: 'project: default',
      });
    });

    it('[FR-MCP-150] should report unidentified for anonymous (plain /mcp) callers', async () => {
      const { data } = await callTool(makeMcp(undefined), 'terminal_whoami')();
      expect(data.identified).toBe(false);
    });

    it('[FR-MCP-150] should identify by token but report live:false when the session meta is absent', async () => {
      const { data } = await callTool(makeMcp('ghost-token'), 'terminal_whoami')();
      expect(data).toMatchObject({
        identified: true,
        live: false,
        terminalSessionId: 'ghost-token',
        agentType: null,
      });
    });
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

  describe('terminal_spawn', () => {
    let ctx: TestContext;

    function addCallerSession(sessionId: string, agentType?: string): void {
      state.terminalSessionMeta.set(sessionId, {
        scopeType: 'project',
        scopeLabel: 'project: default',
        workingDir: '/repo',
        command: agentType
          ? `${agentType} --mcp-config '{"mcpServers":{"Engy":{"type":"http","url":"http://localhost:5555/mcp/${sessionId}"}}}'`
          : undefined,
        agentType,
        groupKey: 'group-1',
        workspaceSlug: 'ws',
        cols: 80,
        rows: 24,
      });
    }

    beforeEach(() => {
      // setupTestDb resets AppState — rewire the harness state/daemon to the fresh one.
      ctx = setupTestDb();
      state = ctx.state;
      sent = [];
      state.terminalDaemon = fakeDaemon(sent);
      ctx.db.insert(workspaces).values({ name: 'WS', slug: 'ws', repos: ['/repo'] }).run();
    });

    afterEach(() => {
      ctx.cleanup();
    });

    it('[FR-MCP-160] should refuse anonymous callers', async () => {
      const { isError, data } = await callTool(makeMcp(undefined), 'terminal_spawn')({
        agentType: 'codex',
        cwd: '/repo',
        description: 'worker',
      });
      expect(isError).toBe(true);
      expect(String(data.error)).toContain('anonymous');
    });

    it('[FR-MCP-160] should refuse callers whose terminal session is not live', async () => {
      const { isError, data } = await callTool(makeMcp('gone'), 'terminal_spawn')({
        agentType: 'codex',
        cwd: '/repo',
        description: 'worker',
      });
      expect(isError).toBe(true);
      expect(String(data.error)).toContain('not live');
    });

    it('[FR-MCP-160] should refuse callers with an unknown agent type', async () => {
      addCallerSession('sess-shell', undefined);
      const { isError, data } = await callTool(makeMcp('sess-shell'), 'terminal_spawn')({
        agentType: 'codex',
        cwd: '/repo',
        description: 'worker',
      });
      expect(isError).toBe(true);
      expect(String(data.error)).toContain('unknown');
    });

    it('[FR-MCP-160] should refuse an unknown requested agentType', async () => {
      addCallerSession('sess-claude', 'claude');
      const { isError, data } = await callTool(makeMcp('sess-claude'), 'terminal_spawn')({
        agentType: 'gemini',
        cwd: '/repo',
        description: 'worker',
      });
      expect(isError).toBe(true);
      expect(String(data.error)).toContain("Unknown agentType 'gemini'");
    });

    it('[FR-MCP-160] should refuse same-type spawns', async () => {
      addCallerSession('sess-claude', 'claude');
      const { isError, data } = await callTool(makeMcp('sess-claude'), 'terminal_spawn')({
        agentType: 'claude',
        cwd: '/repo',
        description: 'worker',
      });
      expect(isError).toBe(true);
      expect(String(data.error)).toContain('Same-type spawn refused');
      expect(String(data.error)).toContain('subagent');
    });

    it('[FR-MCP-160] should refuse when the live agent-spawned session limit is reached', async () => {
      addCallerSession('sess-claude', 'claude');
      for (let i = 0; i < AGENT_SPAWN_LIMIT; i++) {
        state.terminalSessionMeta.set(`spawned-${i}`, {
          scopeType: 'project',
          scopeLabel: `spawned ${i}`,
          workingDir: '/repo',
          spawnedBy: 'sess-claude',
          cols: 80,
          rows: 24,
        });
      }
      const { isError, data } = await callTool(makeMcp('sess-claude'), 'terminal_spawn')({
        agentType: 'codex',
        cwd: '/repo',
        description: 'one too many',
      });
      expect(isError).toBe(true);
      expect(String(data.error)).toContain(`limit reached (${AGENT_SPAWN_LIMIT}`);
    });

    it('[FR-MCP-160] should refuse a cwd outside every workspace repo', async () => {
      addCallerSession('sess-claude', 'claude');
      const { isError, data } = await callTool(makeMcp('sess-claude'), 'terminal_spawn')({
        agentType: 'codex',
        cwd: '/elsewhere',
        description: 'worker',
      });
      expect(isError).toBe(true);
      expect(String(data.error)).toContain('cwd must be inside a workspace repo');
    });

    it('[FR-MCP-160] should error when no terminal daemon is connected', async () => {
      addCallerSession('sess-claude', 'claude');
      state.terminalDaemon = null;
      const { isError, data } = await callTool(makeMcp('sess-claude'), 'terminal_spawn')({
        agentType: 'codex',
        cwd: '/repo',
        description: 'worker',
      });
      expect(isError).toBe(true);
      expect(String(data.error)).toContain('daemon');
    });

    it('[FR-MCP-170] should spawn a cross-type worker wired to its own /mcp/<sessionId> endpoint', async () => {
      addCallerSession('sess-claude', 'claude');
      const { data, isError } = await callTool(makeMcp('sess-claude'), 'terminal_spawn')({
        agentType: 'codex',
        cwd: '/repo/.claude/worktrees/feature',
        description: 'codex on feature',
        prompt: 'review the diff',
      });
      expect(isError).toBe(false);
      const sessionId = data.sessionId as string;
      expect(sessionId).toBeTruthy();

      // Spawn command went to the daemon with the resolved per-session MCP URL
      const spawnFrame = JSON.parse(sent.find((f) => f.includes('"t":"spawn"'))!) as {
        sessionId: string;
        workingDir: string;
        command: string;
        scopeLabel: string;
      };
      expect(spawnFrame.sessionId).toBe(sessionId);
      expect(spawnFrame.workingDir).toBe('/repo/.claude/worktrees/feature');
      expect(spawnFrame.command).toContain('codex');
      expect(spawnFrame.command).toContain(`http://localhost:5555/mcp/${sessionId}`);
      expect(spawnFrame.command).toContain('review the diff');
      expect(spawnFrame.scopeLabel).toBe('codex on feature');

      // Session meta records origin + inherits the caller's UI scope
      const meta = state.terminalSessionMeta.get(sessionId);
      expect(meta).toMatchObject({
        agentType: 'codex',
        spawnedBy: 'sess-claude',
        groupKey: 'group-1',
        workspaceSlug: 'ws',
      });

      // Auto-connected as a dispatch worker
      expect(state.dispatchWorkers.get(sessionId)?.description).toBe('codex on feature');
    });

    it('[FR-MCP-170] should derive the MCP origin from a codex caller command (TOML shape)', async () => {
      state.terminalSessionMeta.set('sess-codex', {
        scopeType: 'project',
        scopeLabel: 'codex terminal',
        workingDir: '/repo',
        command: `codex -c 'mcp_servers.Engy.url="http://127.0.0.1:7777/mcp/sess-codex"' --sandbox workspace-write`,
        agentType: 'codex',
        cols: 80,
        rows: 24,
      });
      const { data, isError } = await callTool(makeMcp('sess-codex'), 'terminal_spawn')({
        agentType: 'claude',
        cwd: '/repo',
        description: 'claude worker',
      });
      expect(isError).toBe(false);
      const spawnFrame = JSON.parse(sent.find((f) => f.includes('"t":"spawn"'))!) as {
        command: string;
      };
      expect(spawnFrame.command).toContain(`http://127.0.0.1:7777/mcp/${data.sessionId as string}`);
    });

    it('[FR-MCP-170] should fall back to the local server port when the caller command has no MCP URL', async () => {
      const priorPort = process.env.PORT;
      process.env.PORT = '4242';
      try {
        state.terminalSessionMeta.set('sess-bare', {
          scopeType: 'project',
          scopeLabel: 'bare claude',
          workingDir: '/repo',
          command: 'claude --permission-mode acceptEdits',
          agentType: 'claude',
          cols: 80,
          rows: 24,
        });
        const { data, isError } = await callTool(makeMcp('sess-bare'), 'terminal_spawn')({
          agentType: 'codex',
          cwd: '/repo',
          description: 'codex worker',
        });
        expect(isError).toBe(false);
        const spawnFrame = JSON.parse(sent.find((f) => f.includes('"t":"spawn"'))!) as {
          command: string;
        };
        expect(spawnFrame.command).toContain(
          `http://localhost:4242/mcp/${data.sessionId as string}`,
        );
      } finally {
        if (priorPort === undefined) delete process.env.PORT;
        else process.env.PORT = priorPort;
      }
    });

    it('[FR-MCP-170] should allow the spawned worker to spawn back cross-type within the cap', async () => {
      addCallerSession('sess-claude', 'claude');
      const first = await callTool(makeMcp('sess-claude'), 'terminal_spawn')({
        agentType: 'codex',
        cwd: '/repo',
        description: 'codex worker',
      });
      const codexSessionId = first.data.sessionId as string;

      // The spawned codex can spawn a claude (cross-type), but not another codex
      const backSpawn = await callTool(makeMcp(codexSessionId), 'terminal_spawn')({
        agentType: 'claude',
        cwd: '/repo',
        description: 'claude sub-worker',
      });
      expect(backSpawn.isError).toBe(false);

      const sameType = await callTool(makeMcp(codexSessionId), 'terminal_spawn')({
        agentType: 'codex',
        cwd: '/repo',
        description: 'codex clone',
      });
      expect(sameType.isError).toBe(true);
      expect(String(sameType.data.error)).toContain('Same-type spawn refused');
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
