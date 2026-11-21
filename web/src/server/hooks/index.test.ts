import { createServer, type Server } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAppState, type AppState, type TerminalSessionMeta } from '../trpc/context';
import { loadPersistedTerminalSessions } from '../ws/terminal-session-store';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { appRouter } from '../trpc/root';
import {
  isHookPath,
  handleHookRequest,
  buildHookRegistry,
  dispatchHookEvent,
  _resetUnknownSessionLog,
  _unknownSessionLogSize,
  MAX_LOGGED_UNKNOWN_SESSIONS,
  HOOK_HANDLERS,
  HOOK_HANDLER_REGISTRATIONS,
} from './index';
import { handleStopActivity } from './activity';
import { settleDispatchOnStop } from './dispatch';
import type { HookHandler, HookRegistry } from './types';

function baseMeta(overrides: Partial<TerminalSessionMeta> = {}): TerminalSessionMeta {
  return {
    scopeType: 'project',
    scopeLabel: 'Test Session',
    workingDir: '/tmp/engy-test',
    cols: 80,
    rows: 24,
    ...overrides,
  };
}

function startServer(
  state: AppState,
  registry?: HookRegistry,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      handleHookRequest(state, req, res, registry);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

function postHook(
  port: number,
  sessionId: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return fetch(`http://127.0.0.1:${port}/hooks/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  }).then(async (res) => ({ status: res.status, json: await res.json().catch(() => undefined) }));
}

describe('hooks/index', () => {
  describe('isHookPath', () => {
    it('matches /hooks/<sessionId> and rejects everything else', () => {
      expect(isHookPath('/hooks/abc-123')).toBe(true);
      expect(isHookPath('/hooks/')).toBe(true);
      expect(isHookPath('/mcp/abc-123')).toBe(false);
      expect(isHookPath('/hooksomething')).toBe(false);
    });
  });

  describe('buildHookRegistry', () => {
    it('groups handlers by event, preserving registration order', () => {
      const calls: string[] = [];
      const a: HookHandler = () => {
        calls.push('a');
      };
      const b: HookHandler = () => {
        calls.push('b');
      };
      const registry = buildHookRegistry([
        { event: 'Stop', handler: a },
        { event: 'Stop', handler: b },
      ]);
      expect(registry.Stop).toEqual([a, b]);
    });
  });

  describe('dispatchHookEvent', () => {
    it('passes the resolved sessionId through to each handler', () => {
      const seen: string[] = [];
      const handler: HookHandler = (_payload, _meta, _state, sessionId) => {
        seen.push(sessionId);
      };
      dispatchHookEvent(
        [handler],
        { hook_event_name: 'Stop' },
        baseMeta(),
        createAppState(),
        'sess-explicit',
      );
      expect(seen).toEqual(['sess-explicit']);
    });
  });

  describe('HTTP endpoint', () => {
    let ctx: TestContext;
    let server: Server;
    let port: number;

    beforeEach(async () => {
      ctx = setupTestDb();
      _resetUnknownSessionLog();
    });

    afterEach(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
      ctx.cleanup();
    });

    it('[FR-TERMINAL-570] returns 200 {} for an unknown session', async () => {
      ({ server, port } = await startServer(ctx.state));
      const { status, json } = await postHook(port, 'no-such-session', { hook_event_name: 'Stop' });
      expect(status).toBe(200);
      expect(json).toEqual({});
    });

    it('[FR-TERMINAL-550] returns 200 {} for a known session with no registered handler for the event', async () => {
      const sessionId = 'sess-unregistered';
      ctx.state.terminalSessionMeta.set(sessionId, baseMeta());
      ({ server, port } = await startServer(ctx.state, {}));
      const { status, json } = await postHook(port, sessionId, { hook_event_name: 'PreCompact' });
      expect(status).toBe(200);
      expect(json).toEqual({});
    });

    it('[FR-TERMINAL-550] runs two handlers registered for the same event, in declared order', async () => {
      const sessionId = 'sess-order';
      ctx.state.terminalSessionMeta.set(sessionId, baseMeta());
      const order: string[] = [];
      const registry = buildHookRegistry([
        {
          event: 'Stop',
          handler: () => {
            order.push('first');
          },
        },
        {
          event: 'Stop',
          handler: () => {
            order.push('second');
          },
        },
      ]);
      ({ server, port } = await startServer(ctx.state, registry));
      const { status } = await postHook(port, sessionId, { hook_event_name: 'Stop' });
      expect(status).toBe(200);
      expect(order).toEqual(['first', 'second']);
    });

    it('[FR-TERMINAL-550] returns 500 when a handler throws', async () => {
      const sessionId = 'sess-throwing-handler';
      ctx.state.terminalSessionMeta.set(sessionId, baseMeta());
      const registry = buildHookRegistry([
        {
          event: 'Stop',
          handler: () => {
            throw new Error('boom');
          },
        },
      ]);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      ({ server, port } = await startServer(ctx.state, registry));
      const { status } = await postHook(port, sessionId, { hook_event_name: 'Stop' });
      expect(status).toBe(500);
    });

    it('[FR-TERMINAL-590] sets hookDriven/lastHookAt on the in-memory meta and persists them', async () => {
      const sessionId = 'sess-persist';
      ctx.state.terminalSessionMeta.set(sessionId, baseMeta());
      ({ server, port } = await startServer(ctx.state, {}));

      const before = Date.now();
      const { status } = await postHook(port, sessionId, { hook_event_name: 'UserPromptSubmit' });
      expect(status).toBe(200);

      const meta = ctx.state.terminalSessionMeta.get(sessionId);
      expect(meta?.hookDriven).toBe(true);
      expect(meta?.lastHookAt).toBeGreaterThanOrEqual(before);

      // Simulate a server restart: a fresh AppState reloading only what was persisted.
      const restarted = createAppState();
      loadPersistedTerminalSessions(restarted);
      const restored = restarted.terminalSessionMeta.get(sessionId);
      expect(restored?.hookDriven).toBe(true);
      expect(restored?.lastHookAt).toBe(meta?.lastHookAt);
    });

    it('[FR-TERMINAL-540] returns 400 for a malformed (non-JSON) body rather than throwing', async () => {
      const sessionId = 'sess-malformed';
      ctx.state.terminalSessionMeta.set(sessionId, baseMeta());
      ({ server, port } = await startServer(ctx.state, {}));
      const { status } = await postHook(port, sessionId, '{not json');
      expect(status).toBe(400);
    });

    it('[FR-TERMINAL-540] returns 400 when hook_event_name is missing', async () => {
      const sessionId = 'sess-missing-event';
      ctx.state.terminalSessionMeta.set(sessionId, baseMeta());
      ({ server, port } = await startServer(ctx.state, {}));
      const { status } = await postHook(port, sessionId, { foo: 'bar' });
      expect(status).toBe(400);
    });

    it('[FR-TERMINAL-580] rejects a body past the size cap without buffering it', async () => {
      const sessionId = 'sess-oversized';
      ctx.state.terminalSessionMeta.set(sessionId, baseMeta());
      ({ server, port } = await startServer(ctx.state, {}));

      const oversized = JSON.stringify({
        hook_event_name: 'Stop',
        last_assistant_message: 'x'.repeat(1_200_000),
      });
      const res = await fetch(`http://127.0.0.1:${port}/hooks/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: oversized,
      });
      expect(res.status).toBe(413);

      // Rejection must not have run any handler with the (unparsed) oversized body.
      const meta = ctx.state.terminalSessionMeta.get(sessionId);
      expect(meta?.hookDriven).toBeUndefined();
    });

    it('[FR-TERMINAL-570] logs an unknown session at most once, through bounded bookkeeping', async () => {
      ({ server, port } = await startServer(ctx.state, {}));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await postHook(port, 'ghost-session', { hook_event_name: 'Stop' });
      await postHook(port, 'ghost-session', { hook_event_name: 'Stop' });
      await postHook(port, 'ghost-session', { hook_event_name: 'Stop' });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    it('[FR-TERMINAL-570] bounds the unknown-session log size', async () => {
      ({ server, port } = await startServer(ctx.state, {}));
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      for (let i = 0; i < MAX_LOGGED_UNKNOWN_SESSIONS + 50; i++) {
        await postHook(port, `ghost-${i}`, { hook_event_name: 'Stop' });
      }

      expect(_unknownSessionLogSize()).toBeLessThanOrEqual(MAX_LOGGED_UNKNOWN_SESSIONS);
      vi.mocked(console.warn).mockRestore();
    });

    describe('SessionStart special case', () => {
      it('[FR-TERMINAL-640] returns {} for a session with no project binding', async () => {
        const sessionId = 'sess-session-start-unbound';
        ctx.state.terminalSessionMeta.set(sessionId, baseMeta());
        ({ server, port } = await startServer(ctx.state, {}));

        const { status, json } = await postHook(port, sessionId, {
          hook_event_name: 'SessionStart',
          source: 'startup',
        });

        expect(status).toBe(200);
        expect(json).toEqual({});
      });

      it('[FR-TERMINAL-640] returns the additionalContext for a project-bound session', async () => {
        const caller = appRouter.createCaller({ state: ctx.state });
        const ws = await caller.workspace.create({ name: 'Hook Router WS' });
        const project = await caller.project.create({
          workspaceSlug: ws.slug,
          name: 'Hook Router Project',
        });

        const sessionId = 'sess-session-start-bound';
        ctx.state.terminalSessionMeta.set(
          sessionId,
          baseMeta({ workspaceSlug: ws.slug, projectId: project.id, projectSlug: project.slug }),
        );
        ({ server, port } = await startServer(ctx.state, {}));

        const { status, json } = await postHook(port, sessionId, {
          hook_event_name: 'SessionStart',
          source: 'startup',
        });

        expect(status).toBe(200);
        expect((json as { additionalContext: string }).additionalContext).toContain(
          'Hook Router Project',
        );
      });
    });

    describe('CwdChanged', () => {
      it('[FR-TERMINAL-870] records the new cwd through the real registry', async () => {
        const sessionId = 'sess-cwd-changed';
        const meta = baseMeta();
        ctx.state.terminalSessionMeta.set(sessionId, meta);
        ({ server, port } = await startServer(ctx.state));

        const { status } = await postHook(port, sessionId, {
          hook_event_name: 'CwdChanged',
          cwd: '/tmp/engy-test',
          old_cwd: '/tmp/engy-test',
          new_cwd: '/tmp/engy-test/.claude/worktrees/feature',
        });

        expect(status).toBe(200);
        expect(meta.agentCwd).toBe('/tmp/engy-test/.claude/worktrees/feature');
      });
    });

    describe('[Stop ordering] the actual registry, not a synthetic stand-in', () => {
      it('settleDispatchOnStop must run before handleStopActivity in HOOK_HANDLERS.Stop', () => {
        const stopHandlers = HOOK_HANDLER_REGISTRATIONS.filter((r) => r.event === 'Stop').map(
          (r) => r.handler,
        );
        const settleIndex = stopHandlers.indexOf(settleDispatchOnStop);
        const activityIndex = stopHandlers.indexOf(handleStopActivity);

        expect(settleIndex).toBeGreaterThanOrEqual(0);
        expect(activityIndex).toBeGreaterThanOrEqual(0);
        expect(settleIndex).toBeLessThan(activityIndex);

        // HOOK_HANDLERS is built from HOOK_HANDLER_REGISTRATIONS by
        // buildHookRegistry — assert the invariant holds there too, since
        // that grouped registry is what handleHookRequest actually dispatches.
        expect(HOOK_HANDLERS.Stop.indexOf(settleDispatchOnStop)).toBeLessThan(
          HOOK_HANDLERS.Stop.indexOf(handleStopActivity),
        );
      });
    });
  });
});
