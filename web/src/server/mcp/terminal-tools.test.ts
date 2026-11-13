import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type WebSocket from 'ws';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTerminalTools } from './terminal-tools';
import type { AppState } from '../trpc/context';
import { getDispatch } from '../terminal-dispatch-store';
import { dispatchGitShow } from '../ws/server';
import {
  SPAWN_COUNT_LIMIT,
  connectWorker,
  countAgentSpawnedSessions,
  flushDispatchInbox,
  settleDispatch,
  resolveDispatchReply,
} from '../terminal-dispatch';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { dispatches, terminalSessionHistory, workspaces } from '../db/schema';
import type { TerminalSessionMeta } from '../trpc/context';

vi.mock('../ws/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ws/server')>()),
  dispatchGitShow: vi.fn(),
}));

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
  let ctx: TestContext;
  let state: AppState;
  let sent: string[];

  beforeEach(() => {
    ctx = setupTestDb();
    state = ctx.state;
    sent = [];
    state.terminalDaemon = fakeDaemon(sent);
    ctx.db.insert(workspaces).values({ name: 'WS', slug: 'ws', repos: ['/repo'] }).run();
  });

  afterEach(() => {
    ctx.cleanup();
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

    it('[FR-MCP-150] should return a link to the caller terminal on its MCP origin', async () => {
      state.terminalSessionMeta.set('sess-me', {
        scopeType: 'project',
        scopeLabel: 'project: default',
        workingDir: '/repo',
        command: `claude --mcp-config '{"url":"https://engy.example.com/mcp/sess-me"}'`,
        cols: 80,
        rows: 24,
      });
      const { data } = await callTool(makeMcp('sess-me'), 'terminal_whoami')();
      expect(data.link).toBe('https://engy.example.com/t/sess-me');
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
    it('[FR-MCP-130] should return an empty list with a hint when no agent terminal is live', async () => {
      const call = callTool(makeMcp(), 'terminal_list_workers');
      const { data, isError } = await call();
      expect(isError).toBe(false);
      expect(data.workers).toEqual([]);
      expect(String(data.hint)).toContain('No live agent terminals');
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

    it('[FR-MCP-130] should give each worker a link on the caller MCP origin', async () => {
      state.terminalSessionMeta.set('sess-me', {
        scopeType: 'project',
        scopeLabel: 'project: default',
        workingDir: '/repo',
        command: `claude --mcp-config '{"url":"https://engy.example.com/mcp/sess-me"}'`,
        cols: 80,
        rows: 24,
      });
      addWorkerSession(state, 'w1', 'codex on frontend');
      const { data } = await callTool(makeMcp('sess-me'), 'terminal_list_workers')();
      const workers = data.workers as Array<Record<string, unknown>>;
      expect(workers[0].link).toBe('https://engy.example.com/t/w1');
    });
  });

  describe('terminal_dispatch', () => {
    it('[FR-MCP-110] should refuse unknown worker sessions', async () => {
      const { data, isError } = await callTool(makeMcp(), 'terminal_dispatch')({
        workerSessionId: 'ghost',
        message: 'hi',
      });
      expect(isError).toBe(true);
      expect(String(data.error)).toContain('no longer alive');
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
      expect(data.status).toBe('written');
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
        expect(ctx.db.select().from(dispatches).all()).toHaveLength(1);
      });
      const correlationId = ctx.db.select().from(dispatches).all()[0].correlationId;
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
      expect(data.status).toBe('written');
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

    it('[FR-MCP-120] should match an id-less reply from an identified worker to its open dispatch', async () => {
      addWorkerSession(state, 'w1', 'worker');
      const { data: dispatched } = await callTool(makeMcp(), 'terminal_dispatch')({
        workerSessionId: 'w1',
        message: 'task',
      });

      // The worker replies through its own /mcp/<sessionId> connection, no id needed.
      const { data, isError } = await callTool(makeMcp('w1'), 'terminal_reply')({
        result: 'did it',
      });
      expect(isError).toBe(false);
      expect(data.correlationId).toBe(dispatched.correlationId);
      expect(getDispatch(dispatched.correlationId as string)?.status).toBe('replied');
    });

    it('[FR-MCP-120] should require a correlationId from anonymous callers', async () => {
      const { isError, data } = await callTool(makeMcp(undefined), 'terminal_reply')({
        result: 'orphan',
      });
      expect(isError).toBe(true);
      expect(String(data.error)).toContain('correlationId is required');
    });

    it('[FR-MCP-120] should error on an id-less reply with no open dispatch', async () => {
      addWorkerSession(state, 'w1', 'worker');
      const { isError, data } = await callTool(makeMcp('w1'), 'terminal_reply')({
        result: 'nothing pending',
      });
      expect(isError).toBe(true);
      expect(String(data.error)).toContain('Cannot match this reply');
    });

    it('[FR-TERMINAL-270] should deliver an id-less contract to workers with a per-session endpoint', async () => {
      addWorkerSession(state, 'w1', 'worker');
      state.terminalSessionMeta.get('w1')!.command =
        `codex -c 'mcp_servers.Engy.url="http://localhost:5555/mcp/w1"' --sandbox workspace-write`;
      const { data } = await callTool(makeMcp(), 'terminal_dispatch')({
        workerSessionId: 'w1',
        message: 'task',
      });
      const paste = sent.map((s) => JSON.parse(s) as { d?: string }).find((f) => f.d?.includes('task'));
      expect(paste?.d).toContain(`[engy-dispatch ${data.correlationId as string}]`);
      expect(paste?.d).not.toContain('with correlationId');
    });

    it('[FR-MCP-180] should mark identified async dispatches for reply push and say so in the hint', async () => {
      addWorkerSession(state, 'w1', 'worker');
      state.terminalSessionMeta.set('orig', {
        scopeType: 'project',
        scopeLabel: 'orchestrator',
        workingDir: '/repo',
        agentType: 'claude',
        cols: 80,
        rows: 24,
      });
      const { data } = await callTool(makeMcp('orig'), 'terminal_dispatch')({
        workerSessionId: 'w1',
        message: 'task',
      });
      expect(String(data.hint)).toContain('pushed into your terminal');
      const entry = getDispatch(data.correlationId as string)!;
      expect(entry.originSessionId).toBe('orig');
      expect(entry.notifyOnReply).toBe(true);
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

    it('[FR-MCP-160] should refuse anonymous callers', async () => {
      const { isError, data } = await callTool(makeMcp(undefined), 'terminal_spawn')({
        agentType: 'codex',
        cwd: '/repo',
        description: 'worker',
      });
      expect(isError).toBe(true);
      expect(String(data.error)).toContain('anonymous');
    });

    it('[FR-MCP-160] should refuse a relative cwd with a clear message', async () => {
      addCallerSession('sess-rel', 'claude');
      const { isError, data } = await callTool(makeMcp('sess-rel'), 'terminal_spawn')({
        agentType: 'codex',
        cwd: 'repo/sub',
        description: 'worker',
      });
      expect(isError).toBe(true);
      expect(String(data.error)).toContain('absolute path');
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

    it('[FR-MCP-170] should allow same-type spawns', async () => {
      addCallerSession('sess-claude', 'claude');
      const { isError, data } = await callTool(makeMcp('sess-claude'), 'terminal_spawn')({
        agentType: 'claude',
        cwd: '/repo',
        description: 'worker',
      });
      expect(isError).toBe(false);
      expect(data.agentType).toBe('claude');
    });

    it('[FR-MCP-160] should refuse when the live agent-spawned session limit is reached', async () => {
      addCallerSession('sess-claude', 'claude');
      for (let i = 0; i < SPAWN_COUNT_LIMIT; i++) {
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
      expect(String(data.error)).toContain(`limit reached (${SPAWN_COUNT_LIMIT}`);
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

    it('[FR-MCP-170] should take scope and agent settings from the target cwd, not from the caller', async () => {
      ctx.db
        .insert(workspaces)
        .values({
          name: 'Other',
          slug: 'other',
          repos: ['/other-repo'],
          agentSettings: { codex: { mode: 'full-auto' } },
        })
        .run();
      state.terminalSessionMeta.set('sess-nows', {
        scopeType: 'project',
        scopeLabel: 'no workspace',
        workingDir: '/repo',
        agentType: 'claude',
        groupKey: 'project:ws:elsewhere',
        workspaceSlug: 'ws',
        cols: 80,
        rows: 24,
      });

      const { data, isError } = await callTool(makeMcp('sess-nows'), 'terminal_spawn')({
        agentType: 'codex',
        cwd: '/other-repo',
        description: 'worker',
      });

      expect(isError).toBe(false);
      expect(state.terminalSessionMeta.get(data.sessionId as string)).toMatchObject({
        groupKey: 'workspace:other',
        workspaceSlug: 'other',
        scopeType: 'workspace',
      });
      const spawn = sent.map((s) => JSON.parse(s) as { t?: string; command?: string }).find((f) => f.t === 'spawn');
      expect(spawn?.command).toContain('--sandbox workspace-write --ask-for-approval never');
    });

    it('[FR-MCP-160] should refuse past the spawn depth limit of 2', async () => {
      addCallerSession('sess-deep', 'claude');
      state.terminalSessionMeta.get('sess-deep')!.spawnDepth = 2;
      const { isError, data } = await callTool(makeMcp('sess-deep'), 'terminal_spawn')({
        agentType: 'codex',
        cwd: '/repo',
        description: 'too deep',
      });
      expect(isError).toBe(true);
      expect(String(data.error)).toContain('depth limit');
    });

    it('[FR-MCP-160] should warn above three active spawned terminals but still spawn', async () => {
      addCallerSession('sess-claude', 'claude');
      const mcp = makeMcp('sess-claude');
      const results = [];
      for (let i = 0; i < 4; i++) {
        results.push(
          await callTool(mcp, 'terminal_spawn')({
            agentType: 'codex',
            cwd: '/repo',
            description: `worker ${i}`,
          }),
        );
      }
      expect(results.every((r) => !r.isError)).toBe(true);
      expect(results[2].data.warning).toBeUndefined();
      expect(String(results[3].data.warning)).toContain('4 agent-spawned terminals are active');
    });

    it('[FR-MCP-160] should refuse a new spawn once the rate limit is hit, even after closing slots', async () => {
      addCallerSession('sess-claude', 'claude');
      const mcp = makeMcp('sess-claude');
      for (let i = 0; i < 10; i++) {
        const spawned = await callTool(mcp, 'terminal_spawn')({
          agentType: 'codex',
          cwd: '/repo',
          description: `loop ${i}`,
        });
        expect(spawned.isError).toBe(false);
        await callTool(mcp, 'terminal_close')({ sessionId: spawned.data.sessionId as string });
      }
      const blocked = await callTool(mcp, 'terminal_spawn')({
        agentType: 'codex',
        cwd: '/repo',
        description: 'eleventh',
      });
      expect(blocked.isError).toBe(true);
      expect(String(blocked.data.error)).toContain('rate limit');
    });

    it('[FR-MCP-160] should refuse an agentType deactivated in the workspace settings', async () => {
      addCallerSession('sess-claude', 'claude');
      ctx.db
        .update(workspaces)
        .set({ agentSettings: { codex: { active: false } } })
        .run();
      const { isError, data } = await callTool(makeMcp('sess-claude'), 'terminal_spawn')({
        agentType: 'codex',
        cwd: '/repo',
        description: 'worker',
      });
      expect(isError).toBe(true);
      expect(String(data.error)).toContain('deactivated');
    });

    it('[FR-WORKSPACE-150] should spawn with the workspace-configured mode for the target agent', async () => {
      addCallerSession('sess-claude', 'claude');
      ctx.db
        .update(workspaces)
        .set({ agentSettings: { codex: { mode: 'full-auto' } } })
        .run();
      const { isError } = await callTool(makeMcp('sess-claude'), 'terminal_spawn')({
        agentType: 'codex',
        cwd: '/repo',
        description: 'worker',
      });
      expect(isError).toBe(false);
      const spawn = sent.map((s) => JSON.parse(s) as { t?: string; command?: string }).find((f) => f.t === 'spawn');
      expect(spawn?.command).toContain('--sandbox workspace-write --ask-for-approval never');
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

      // Session meta records origin and the target workspace scope; starts
      // 'active' (booting) so immediate dispatches queue instead of pasting
      // into a half-booted TUI.
      const meta = state.terminalSessionMeta.get(sessionId);
      expect(meta).toMatchObject({
        agentType: 'codex',
        spawnedBy: 'sess-claude',
        groupKey: 'workspace:ws',
        spawnDepth: 1,
        workspaceSlug: 'ws',
        activityState: 'active',
      });

      // Auto-connected as a dispatch worker
      expect(state.dispatchWorkers.get(sessionId)?.description).toBe('codex on feature');
    });

    it('[FR-MCP-170] should queue an immediate dispatch and deliver it when the spawned CLI settles', async () => {
      addCallerSession('sess-claude', 'claude');
      const mcp = makeMcp('sess-claude');
      const { data: spawned } = await callTool(mcp, 'terminal_spawn')({
        agentType: 'codex',
        cwd: '/repo',
        description: 'worker',
      });
      const workerId = spawned.sessionId as string;
      sent.length = 0;

      // Dispatch immediately, while the worker is still booting ('active')
      const { data: dispatched, isError } = await callTool(mcp, 'terminal_dispatch')({
        workerSessionId: workerId,
        message: 'first job',
      });
      expect(isError).toBe(false);
      expect(dispatched.status).toBe('queued');
      expect(sent).toHaveLength(0);

      // The CLI finishes booting: daemon settles the session, inbox flushes
      state.terminalSessionMeta.get(workerId)!.activityState = 'done';
      flushDispatchInbox(state, workerId);
      const paste = sent.map((s) => JSON.parse(s) as { sessionId: string; d?: string })
        .find((f) => f.sessionId === workerId && f.d?.includes('first job'));
      expect(paste).toBeDefined();
      expect(getDispatch(dispatched.correlationId as string)?.status).toBe('written');
    });

    it('[FR-MCP-170] should derive the MCP origin from a codex caller command (TOML shape)', async () => {
      state.terminalSessionMeta.set('sess-codex', {
        scopeType: 'project',
        scopeLabel: 'codex terminal',
        workingDir: '/repo',
        command: `codex -c 'mcp_servers.Engy.url="http://127.0.0.1:7777/mcp/sess-codex"' --sandbox workspace-write`,
        agentType: 'codex',
        workspaceSlug: 'ws',
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
          workspaceSlug: 'ws',
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

    it('[FR-MCP-190] should let the spawner close its spawned terminal and free the slot', async () => {
      addCallerSession('sess-claude', 'claude');
      const mcp = makeMcp('sess-claude');
      const { data: spawned } = await callTool(mcp, 'terminal_spawn')({
        agentType: 'codex',
        cwd: '/repo',
        description: 'short-lived worker',
      });
      const workerId = spawned.sessionId as string;
      const pending = await callTool(mcp, 'terminal_dispatch')({
        workerSessionId: workerId,
        message: 'never answered',
      });
      sent.length = 0;

      const { data, isError } = await callTool(mcp, 'terminal_close')({ sessionId: workerId });
      expect(isError).toBe(false);
      expect(data).toMatchObject({ ok: true, sessionId: workerId, closed: 'short-lived worker' });

      // Kill forwarded to the daemon; server state fully torn down
      expect(sent.some((f) => f.includes('"t":"kill"') && f.includes(workerId))).toBe(true);
      expect(state.terminalSessionMeta.has(workerId)).toBe(false);
      expect(state.dispatchWorkers.has(workerId)).toBe(false);
      expect(getDispatch(pending.data.correlationId as string)?.status).toBe('failed');

      // The spawn-cap slot is freed
      expect(countAgentSpawnedSessions(state)).toBe(0);
    });

    it('[FR-MCP-190] should refuse closing terminals the caller did not spawn', async () => {
      addCallerSession('sess-claude', 'claude');
      addCallerSession('sess-other', 'codex');
      // User-opened terminal (no spawnedBy)
      const userTerm = await callTool(makeMcp('sess-claude'), 'terminal_close')({
        sessionId: 'sess-other',
      });
      expect(userTerm.isError).toBe(true);
      expect(String(userTerm.data.error)).toContain('opened by the user');

      // Spawned by someone else
      state.terminalSessionMeta.get('sess-other')!.spawnedBy = 'somebody-else';
      const foreign = await callTool(makeMcp('sess-claude'), 'terminal_close')({
        sessionId: 'sess-other',
      });
      expect(foreign.isError).toBe(true);
      expect(String(foreign.data.error)).toContain('different agent');
    });

    it('[FR-MCP-190] should refuse anonymous callers and unknown sessions', async () => {
      const anon = await callTool(makeMcp(undefined), 'terminal_close')({ sessionId: 'x' });
      expect(anon.isError).toBe(true);
      expect(String(anon.data.error)).toContain('anonymous');

      addCallerSession('sess-claude', 'claude');
      const ghost = await callTool(makeMcp('sess-claude'), 'terminal_close')({
        sessionId: 'ghost',
      });
      expect(ghost.isError).toBe(true);
      expect(String(ghost.data.error)).toContain('Unknown or already-closed');
    });

    it('[FR-MCP-190] should refuse the close when no daemon is connected', async () => {
      addCallerSession('sess-claude', 'claude');
      const { data: spawned } = await callTool(makeMcp('sess-claude'), 'terminal_spawn')({
        agentType: 'codex',
        cwd: '/repo',
        description: 'worker',
      });
      state.terminalDaemon = null;
      const { isError, data } = await callTool(makeMcp('sess-claude'), 'terminal_close')({
        sessionId: spawned.sessionId as string,
      });
      expect(isError).toBe(true);
      expect(String(data.error)).toContain('daemon');
      // Session state is untouched — the PTY could not be killed
      expect(state.terminalSessionMeta.has(spawned.sessionId as string)).toBe(true);
      expect(state.dispatchWorkers.has(spawned.sessionId as string)).toBe(true);
    });

    it('[FR-MCP-170] should allow a spawned worker to spawn on within the cap', async () => {
      addCallerSession('sess-claude', 'claude');
      const first = await callTool(makeMcp('sess-claude'), 'terminal_spawn')({
        agentType: 'codex',
        cwd: '/repo',
        description: 'codex worker',
      });
      const codexSessionId = first.data.sessionId as string;

      const backSpawn = await callTool(makeMcp(codexSessionId), 'terminal_spawn')({
        agentType: 'claude',
        cwd: '/repo',
        description: 'claude sub-worker',
      });
      expect(backSpawn.isError).toBe(false);

      const sameType = await callTool(makeMcp(codexSessionId), 'terminal_spawn')({
        agentType: 'codex',
        cwd: '/repo',
        description: 'second codex worker',
      });
      expect(sameType.isError).toBe(false);
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

    it('[FR-MCP-140] should return the worker link, falling back to the local port for anonymous callers', async () => {
      vi.stubEnv('PORT', '4123');
      addWorkerSession(state, 'w1', 'worker');
      const { data } = await callTool(makeMcp(), 'terminal_status')({ workerSessionId: 'w1' });
      vi.unstubAllEnvs();
      expect(data.link).toBe('http://localhost:4123/t/w1');
    });

    it('should refuse unknown workers', async () => {
      const { isError } = await callTool(makeMcp(), 'terminal_status')({ workerSessionId: 'x' });
      expect(isError).toBe(true);
    });

    it('[FR-MCP-200] exposes activeSubagents and lastFailure', async () => {
      addWorkerSession(state, 'w1', 'worker');
      const meta = state.terminalSessionMeta.get('w1')!;
      meta.activeSubagents = 2;
      meta.lastFailure = { type: 'rate_limit', message: 'try again later', at: 123 };
      const { data } = await callTool(makeMcp(), 'terminal_status')({ workerSessionId: 'w1' });
      expect(data.activeSubagents).toBe(2);
      expect(data.lastFailure).toEqual({ type: 'rate_limit', message: 'try again later', at: 123 });
    });

    it('[FR-MCP-140] should return the last 50 output lines by default and honor a lines input', async () => {
      addWorkerSession(state, 'w1', 'worker');
      state.terminalOutputTails.set('w1', Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n'));

      const byDefault = await callTool(makeMcp(), 'terminal_status')({ workerSessionId: 'w1' });
      const lines = String(byDefault.data.outputTail).split('\n');
      expect(lines).toHaveLength(50);
      expect(lines[49]).toBe('line 79');

      const few = await callTool(makeMcp(), 'terminal_status')({ workerSessionId: 'w1', lines: 3 });
      expect(String(few.data.outputTail).split('\n')).toEqual(['line 77', 'line 78', 'line 79']);
    });

    it('[FR-MCP-140] should report status for an agent terminal that is not connected as a worker', async () => {
      state.terminalSessionMeta.set('free', {
        scopeType: 'project',
        scopeLabel: 'free agent',
        workingDir: '/repo',
        agentType: 'claude',
        cols: 80,
        rows: 24,
      });
      const { data, isError } = await callTool(makeMcp(), 'terminal_status')({ workerSessionId: 'free' });
      expect(isError).toBe(false);
      expect(data).toMatchObject({ sessionId: 'free', connected: false });
    });

    it('[FR-MCP-140] should hide output of a not-connected terminal from a caller without the orchestrator role', async () => {
      state.terminalSessionMeta.set('free', {
        scopeType: 'project',
        scopeLabel: 'free agent',
        workingDir: '/repo',
        agentType: 'claude',
        cols: 80,
        rows: 24,
      });
      state.terminalOutputTails.set('free', 'secret output');
      addWorkerSession(state, 'caller', 'caller');

      const anonymous = await callTool(makeMcp(), 'terminal_status')({ workerSessionId: 'free' });
      const plain = await callTool(makeMcp('caller'), 'terminal_status')({ workerSessionId: 'free' });
      state.terminalSessionMeta.get('caller')!.orchestrator = true;
      const orchestrator = await callTool(makeMcp('caller'), 'terminal_status')({ workerSessionId: 'free' });

      expect(anonymous.data.outputTail).toBeUndefined();
      expect(plain.data.outputTail).toBeUndefined();
      expect(orchestrator.data.outputTail).toBe('secret output');
    });

    it('[FR-MCP-200] defaults activeSubagents to 0 with no lastFailure set', async () => {
      addWorkerSession(state, 'w1', 'worker');
      const { data } = await callTool(makeMcp(), 'terminal_status')({ workerSessionId: 'w1' });
      expect(data.activeSubagents).toBe(0);
      expect(data.lastFailure).toBeUndefined();
    });
  });

  describe('orchestrator dispatch and listing', () => {
    function addAgent(sessionId: string, extra: Partial<TerminalSessionMeta> = {}): void {
      state.terminalSessionMeta.set(sessionId, {
        scopeType: 'project',
        scopeLabel: `label-${sessionId}`,
        workingDir: '/repo',
        agentType: 'claude',
        activityState: 'idle',
        cols: 80,
        rows: 24,
        ...extra,
      });
    }

    it('[FR-MCP-130] should list every live agent terminal for an anonymous caller, with connected, identity and link', async () => {
      addAgent('hand-opened', {
        workspaceSlug: 'ws',
        projectSlug: 'proj',
        worktreeBranch: 'feat/x',
        taskId: 4,
      });
      addAgent('plugged');
      connectWorker(state, 'plugged', 'plugged worker');
      state.terminalSessionMeta.set('shell', {
        scopeType: 'project',
        scopeLabel: 'shell',
        workingDir: '/repo',
        cols: 80,
        rows: 24,
      });

      const { data } = await callTool(makeMcp(), 'terminal_list_workers')();
      const workers = data.workers as Array<Record<string, unknown>>;

      expect(workers.map((w) => w.sessionId).sort()).toEqual(['hand-opened', 'plugged']);
      expect(workers.find((w) => w.sessionId === 'hand-opened')).toMatchObject({
        connected: false,
        workspaceSlug: 'ws',
        projectSlug: 'proj',
        worktreeBranch: 'feat/x',
        taskId: 4,
        link: 'http://localhost:3000/t/hand-opened',
      });
      expect(workers.find((w) => w.sessionId === 'plugged')?.connected).toBe(true);
    });

    it('[FR-MCP-110] should refuse an unconnected agent terminal for an ordinary caller', async () => {
      addAgent('target');
      addAgent('caller');
      const { isError, data } = await callTool(makeMcp('caller'), 'terminal_dispatch')({
        workerSessionId: 'target',
        message: 'hi',
      });
      expect(isError).toBe(true);
      expect(String(data.error)).toContain('not connected');
      expect(sent).toHaveLength(0);
    });

    it('[FR-MCP-110] should let the orchestrator dispatch to a terminal nobody connected', async () => {
      addAgent('target');
      addAgent('boss', { orchestrator: true });
      const { isError, data } = await callTool(makeMcp('boss'), 'terminal_dispatch')({
        workerSessionId: 'target',
        message: 'hi',
      });
      expect(isError).toBe(false);
      expect(data.status).toBe('written');
    });

    it('[FR-MCP-130] should list only its own project for the orchestrator', async () => {
      addAgent('boss', { orchestrator: true, workspaceSlug: 'ws', projectSlug: 'alpha' });
      addAgent('near', { workspaceSlug: 'ws', projectSlug: 'alpha' });
      addAgent('far', { workspaceSlug: 'ws', projectSlug: 'beta' });

      const { data } = await callTool(makeMcp('boss'), 'terminal_list_workers')();
      const workers = data.workers as Array<{ sessionId: string }>;

      expect(workers.map((w) => w.sessionId).sort()).toEqual(['boss', 'near']);
    });

    it('[FR-MCP-140] should hide output outside its project from the orchestrator', async () => {
      addAgent('boss', { orchestrator: true, workspaceSlug: 'ws', projectSlug: 'alpha' });
      addAgent('near', { workspaceSlug: 'ws', projectSlug: 'alpha' });
      addAgent('far', { workspaceSlug: 'ws', projectSlug: 'beta' });
      connectWorker(state, 'far', 'far worker');
      state.terminalOutputTails.set('near', 'near output');
      state.terminalOutputTails.set('far', 'far output');

      const status = callTool(makeMcp('boss'), 'terminal_status');

      expect((await status({ workerSessionId: 'near' })).data.outputTail).toBe('near output');
      expect((await status({ workerSessionId: 'far' })).data.outputTail).toBeUndefined();
    });

    it('[FR-MCP-340] should refuse an orchestrator spawn outside its project', async () => {
      ctx.db.insert(workspaces).values({ name: 'Other', slug: 'other', repos: ['/other'] }).run();
      addAgent('boss', { orchestrator: true, workspaceSlug: 'ws' });

      const { isError, data } = await callTool(makeMcp('boss'), 'terminal_spawn')({
        agentType: 'codex',
        cwd: '/other',
        description: 'worker',
      });

      expect(isError).toBe(true);
      expect(String(data.error)).toContain('outside your project');
    });

    it('[FR-MCP-110] should expose no tool that grants the orchestrator role', () => {
      const tools = (makeMcp('boss') as unknown as { _registeredTools: Record<string, unknown> })
        ._registeredTools;
      expect(Object.keys(tools).filter((name) => /orchestrator/i.test(name))).toEqual([]);
    });

    it('[FR-MCP-150] should report the orchestrator flag in terminal_whoami', async () => {
      addAgent('boss', { orchestrator: true });
      const { data } = await callTool(makeMcp('boss'), 'terminal_whoami')();
      expect(data.orchestrator).toBe(true);
    });
  });

  describe('delivery and stopped states', () => {
    it('[FR-MCP-301] should show written, not delivered, after a PTY write and expose it via terminal_collect', async () => {
      addWorkerSession(state, 'w1', 'worker');
      const mcp = makeMcp();
      const { data } = await callTool(mcp, 'terminal_dispatch')({
        workerSessionId: 'w1',
        message: 'task',
      });
      expect(data.status).toBe('written');
      const { data: collected } = await callTool(mcp, 'terminal_collect')({
        correlationId: data.correlationId as string,
      });
      expect(collected.status).toBe('written');
    });

    it('[FR-MCP-310] should return stopReason and lastOutput for a stopped dispatch in terminal_collect', async () => {
      addWorkerSession(state, 'w1', 'worker');
      const mcp = makeMcp();
      const { data } = await callTool(mcp, 'terminal_dispatch')({
        workerSessionId: 'w1',
        message: 'task',
      });
      const row = getDispatch(data.correlationId as string)!;
      settleDispatch(state, row, 'stopped', {
        settledBy: 'hook',
        stopReason: 'the worker turn ended without a terminal_reply call',
        lastOutput: 'I got stuck',
      });

      const { data: collected } = await callTool(mcp, 'terminal_collect')({
        correlationId: data.correlationId as string,
      });
      expect(collected).toMatchObject({
        status: 'stopped',
        stopReason: 'the worker turn ended without a terminal_reply call',
        lastOutput: 'I got stuck',
      });
    });

    it('[FR-MCP-310] should resolve a sync dispatch with the stopped state instead of timing out', async () => {
      addWorkerSession(state, 'w1', 'worker');
      const call = callTool(makeMcp(), 'terminal_dispatch')({
        workerSessionId: 'w1',
        message: 'task',
        mode: 'sync',
        timeoutSeconds: 30,
      });
      await vi.waitFor(() => {
        expect(ctx.db.select().from(dispatches).all()).toHaveLength(1);
      });
      const row = ctx.db.select().from(dispatches).all()[0];
      settleDispatch(state, getDispatch(row.correlationId)!, 'stopped', {
        settledBy: 'hook',
        stopReason: 'turn ended',
        lastOutput: 'quiet',
      });

      const { data } = await call;
      expect(data.status).toBe('stopped');
    });
  });

  describe('terminal_reply evidence', () => {
    async function dispatchTo(workerId: string): Promise<string> {
      const { data } = await callTool(makeMcp(), 'terminal_dispatch')({
        workerSessionId: workerId,
        message: 'task',
      });
      return data.correlationId as string;
    }

    beforeEach(() => {
      addWorkerSession(state, 'w1', 'worker');
      vi.mocked(dispatchGitShow).mockReset();
    });

    it('[FR-MCP-320] should store and return evidence, marking a commit the daemon finds as verified', async () => {
      vi.mocked(dispatchGitShow).mockResolvedValue({ files: [] });
      const correlationId = await dispatchTo('w1');

      const { data, isError } = await callTool(makeMcp('w1'), 'terminal_reply')({
        result: 'done',
        evidence: {
          commit: 'abc1234',
          commands: [{ command: 'pnpm test', exitCode: 0 }],
          filesChanged: ['a.ts'],
          notVerified: ['browser check'],
        },
      });

      expect(isError).toBe(false);
      expect(dispatchGitShow).toHaveBeenCalledWith('/tmp', 'abc1234', state, undefined);
      const { data: collected } = await callTool(makeMcp(), 'terminal_collect')({ correlationId });
      expect(data.evidence).toMatchObject({ commitVerified: 'verified' });
      expect(collected.evidence).toEqual({
        commit: 'abc1234',
        commands: [{ command: 'pnpm test', exitCode: 0 }],
        filesChanged: ['a.ts'],
        notVerified: ['browser check'],
        commitVerified: 'verified',
      });
    });

    it('[FR-MCP-320] should mark a commit git cannot find as not_found', async () => {
      vi.mocked(dispatchGitShow).mockRejectedValue(new Error('bad object deadbeef'));
      const correlationId = await dispatchTo('w1');

      const { data } = await callTool(makeMcp('w1'), 'terminal_reply')({
        correlationId,
        result: 'done',
        evidence: { commit: 'deadbeef' },
      });

      expect(data.evidence).toMatchObject({ commit: 'deadbeef', commitVerified: 'not_found' });
    });

    it('[FR-MCP-320] should mark the commit unverified when git says the short hash is ambiguous', async () => {
      vi.mocked(dispatchGitShow).mockRejectedValue(
        new Error(
          "error: short object ID abc1234 is ambiguous\nfatal: ambiguous argument 'abc1234': unknown revision or path not in the working tree.",
        ),
      );
      await dispatchTo('w1');

      const { data } = await callTool(makeMcp('w1'), 'terminal_reply')({
        result: 'done',
        evidence: { commit: 'abc1234' },
      });

      expect(data.evidence).toMatchObject({ commitVerified: 'unverified' });
    });

    it('[FR-MCP-320] should mark the commit unverified for an unrelated git or transport error', async () => {
      vi.mocked(dispatchGitShow).mockRejectedValue(new Error('fatal: not a git repository'));
      await dispatchTo('w1');

      const { data } = await callTool(makeMcp('w1'), 'terminal_reply')({
        result: 'done',
        evidence: { commit: 'abc1234' },
      });

      expect(data.evidence).toMatchObject({ commitVerified: 'unverified' });
    });

    it('[FR-MCP-320] should verify the commit through the coder workspace of the worker', async () => {
      vi.mocked(dispatchGitShow).mockClear();
      vi.mocked(dispatchGitShow).mockResolvedValue({ files: [] });
      state.terminalSessionMeta.get('w1')!.workspaceSlug = 'ws-coder';
      ctx.db
        .insert(workspaces)
        .values({
          name: 'c',
          slug: 'ws-coder',
          docsDir: '/docs',
          containerEnabled: true,
          executionBackend: 'coder',
          coderConfig: { workspace: 'remote-box' },
        } as typeof workspaces.$inferInsert)
        .run();
      await dispatchTo('w1');

      await callTool(makeMcp('w1'), 'terminal_reply')({
        result: 'done',
        evidence: { commit: 'abc1234' },
      });

      expect(vi.mocked(dispatchGitShow).mock.calls[0][3]).toBe('remote-box');
    });

    it('[FR-MCP-320] should mark the commit unverified when the daemon cannot answer', async () => {
      vi.mocked(dispatchGitShow).mockRejectedValue(new Error('No daemon connected'));
      await dispatchTo('w1');

      const { data } = await callTool(makeMcp('w1'), 'terminal_reply')({
        result: 'done',
        evidence: { commit: 'abc1234' },
      });

      expect(data.evidence).toMatchObject({ commitVerified: 'unverified' });
    });

    it('[FR-MCP-320] should accept a reply with no evidence', async () => {
      const correlationId = await dispatchTo('w1');
      const ok = await callTool(makeMcp('w1'), 'terminal_reply')({ result: 'done' });
      expect(ok.isError).toBe(false);
      expect(getDispatch(correlationId)?.evidence).toBeUndefined();
    });
  });

  describe('terminal_sessions', () => {
    function addSession(sessionId: string, extra: Partial<TerminalSessionMeta> = {}) {
      ctx.state.terminalSessionMeta.set(sessionId, {
        scopeType: 'project',
        scopeLabel: `label-${sessionId}`,
        workingDir: '/repo',
        agentType: 'claude',
        workspaceSlug: 'ws',
        cols: 80,
        rows: 24,
        ...extra,
      });
    }

    function addHistory(sessionId: string) {
      ctx.db
        .insert(terminalSessionHistory)
        .values({
          sessionId,
          agentType: 'claude',
          workingDir: '/repo',
          scopeLabel: 'old work',
          summary: `summary-${sessionId}`,
          workspaceSlug: 'ws',
          projectSlug: 'proj',
          worktreeBranch: 'feat/x',
          startedAt: '2026-01-01T00:00:00.000Z',
          closedAt: '2026-01-01T01:00:00.000Z',
        })
        .run();
    }

    it('[FR-MCP-290] should list live and dormant agent sessions with state, identity and link', async () => {
      addSession('live-1', {
        projectSlug: 'proj',
        taskId: 7,
        worktreeBranch: 'feat/y',
        activityState: 'waiting',
        lastTitle: 'Fixing tests',
        activeSubagents: 2,
        lastFailure: { type: 'rate_limit', message: 'limit', at: 1 },
      });
      addSession('dorm-1', { dormant: true });

      const { data } = await callTool(makeMcp(), 'terminal_sessions')();
      const sessions = data.sessions as Array<Record<string, unknown>>;
      expect(sessions.find((s) => s.sessionId === 'live-1')).toMatchObject({
        state: 'live',
        activityState: 'waiting',
        agentType: 'claude',
        workspaceSlug: 'ws',
        projectSlug: 'proj',
        taskId: 7,
        worktreeBranch: 'feat/y',
        lastTitle: 'Fixing tests',
        activeSubagents: 2,
        lastFailure: { type: 'rate_limit', message: 'limit', at: 1 },
        link: 'http://localhost:3000/t/live-1',
      });
      expect(sessions.find((s) => s.sessionId === 'dorm-1')?.state).toBe('dormant');
    });

    it('[FR-MCP-290] should exclude plain shells', async () => {
      addSession('shell-1', { agentType: undefined });
      const { data } = await callTool(makeMcp(), 'terminal_sessions')();
      expect(data.sessions).toEqual([]);
    });

    it('[FR-MCP-290] should list closed history sessions linked by the history key', async () => {
      addHistory('hist-1');
      const { data } = await callTool(makeMcp(), 'terminal_sessions')();
      const sessions = data.sessions as Array<Record<string, unknown>>;
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        sessionId: 'hist-1',
        state: 'closed',
        summary: 'summary-hist-1',
        workspaceSlug: 'ws',
        projectSlug: 'proj',
        worktreeBranch: 'feat/x',
        closedAt: '2026-01-01T01:00:00.000Z',
        link: 'http://localhost:3000/t/hist-1',
      });
    });

    it('[FR-MCP-290] should not repeat a history row whose conversation is live', async () => {
      addHistory('conv-1');
      addSession('term-1', { resumedFrom: 'conv-1' });
      const { data } = await callTool(makeMcp(), 'terminal_sessions')();
      const sessions = data.sessions as Array<Record<string, unknown>>;
      expect(sessions.map((s) => s.sessionId)).toEqual(['term-1']);
    });

    it('[FR-MCP-290] should cap closed sessions at 10 per workspace', async () => {
      for (let index = 0; index < 11; index++) addHistory(`hist-${index}`);
      const { data } = await callTool(makeMcp(), 'terminal_sessions')();
      expect(data.sessions).toHaveLength(10);
    });

    it('[FR-MCP-290] should not repeat a dormant session that also has a history row', async () => {
      addHistory('dorm-1');
      addSession('dorm-1', { dormant: true });
      const { data } = await callTool(makeMcp(), 'terminal_sessions')();
      const sessions = data.sessions as Array<Record<string, unknown>>;
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({ sessionId: 'dorm-1', state: 'dormant' });
    });

    it('[FR-MCP-290] should build links from the caller MCP origin and serve anonymous callers', async () => {
      addSession('caller', {
        command: `claude --mcp-config '{"url":"http://localhost:5555/mcp/caller"}'`,
      });
      addSession('other');
      const { data } = await callTool(makeMcp('caller'), 'terminal_sessions')();
      const links = (data.sessions as Array<{ link: string }>).map((s) => s.link).sort();
      expect(links).toEqual(['http://localhost:5555/t/caller', 'http://localhost:5555/t/other']);

      const anonymous = await callTool(makeMcp(), 'terminal_sessions')();
      expect(anonymous.isError).toBe(false);
    });
  });
});
