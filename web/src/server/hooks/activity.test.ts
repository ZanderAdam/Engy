import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import type { TerminalSessionMeta } from '../trpc/context';
import { connectWorker, createDispatch } from '../terminal-dispatch';
import type { WebSocket } from 'ws';
import {
  applyActivityState,
  handleNotificationActivity,
  handleStopActivity,
  handleUserPromptSubmitActivity,
  ACTIVITY_HOOK_TRUST_WINDOW_MS,
} from './activity';
import type { HookPayload } from './types';

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

function payload(event: string, overrides: Partial<HookPayload> = {}): HookPayload {
  return { hook_event_name: event, session_id: 'claude-conv-id', ...overrides };
}

// Mirrors the fileChangeListeners capture pattern used in ws/terminal-server.test.ts.
function captureBroadcasts(ctx: TestContext): { events: unknown[] } {
  const captured = { events: [] as unknown[] };
  const listener = {
    readyState: 1,
    OPEN: 1,
    send: (data: string) => captured.events.push(JSON.parse(data)),
  } as unknown as WebSocket;
  ctx.state.fileChangeListeners.add(listener);
  return captured;
}

describe('hooks/activity', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('FR-TERMINAL-760 mappings', () => {
    it('UserPromptSubmit sets active', () => {
      const meta = baseMeta();
      ctx.state.terminalSessionMeta.set('sess-1', meta);
      handleUserPromptSubmitActivity(payload('UserPromptSubmit'), meta, ctx.state, 'sess-1');
      expect(meta.activityState).toBe('active');
    });

    it('Stop sets done', () => {
      const meta = baseMeta();
      ctx.state.terminalSessionMeta.set('sess-2', meta);
      handleStopActivity(payload('Stop'), meta, ctx.state, 'sess-2');
      expect(meta.activityState).toBe('done');
    });

    it.each(['permission_prompt', 'agent_needs_input', 'elicitation_dialog'])(
      'Notification %s sets waiting',
      (notificationType) => {
        const meta = baseMeta();
        ctx.state.terminalSessionMeta.set('sess-3', meta);
        handleNotificationActivity(
          payload('Notification', { notification_type: notificationType }),
          meta,
          ctx.state,
          'sess-3',
        );
        expect(meta.activityState).toBe('waiting');
      },
    );

    it('Notification idle_prompt sets idle', () => {
      const meta = baseMeta();
      ctx.state.terminalSessionMeta.set('sess-4', meta);
      handleNotificationActivity(
        payload('Notification', { notification_type: 'idle_prompt' }),
        meta,
        ctx.state,
        'sess-4',
      );
      expect(meta.activityState).toBe('idle');
    });

    it('Notification with an unrecognised type is a no-op', () => {
      const meta = baseMeta({ activityState: 'active' });
      ctx.state.terminalSessionMeta.set('sess-5', meta);
      handleNotificationActivity(
        payload('Notification', { notification_type: 'something_unheard_of' }),
        meta,
        ctx.state,
        'sess-5',
      );
      expect(meta.activityState).toBe('active');
    });

    it('Notification with no type field at all is a no-op', () => {
      const meta = baseMeta({ activityState: 'active' });
      ctx.state.terminalSessionMeta.set('sess-6', meta);
      handleNotificationActivity(payload('Notification'), meta, ctx.state, 'sess-6');
      expect(meta.activityState).toBe('active');
    });
  });

  describe('subagent guard', () => {
    it('ignores a Stop payload carrying agent_id', () => {
      const meta = baseMeta({ activityState: 'active' });
      ctx.state.terminalSessionMeta.set('sess-sub-stop', meta);
      handleStopActivity(
        payload('Stop', { agent_id: 'agent-123' }),
        meta,
        ctx.state,
        'sess-sub-stop',
      );
      expect(meta.activityState).toBe('active');
    });

    it('ignores a UserPromptSubmit payload carrying agent_id', () => {
      const meta = baseMeta({ activityState: 'done' });
      ctx.state.terminalSessionMeta.set('sess-sub-ups', meta);
      handleUserPromptSubmitActivity(
        payload('UserPromptSubmit', { agent_id: 'agent-123' }),
        meta,
        ctx.state,
        'sess-sub-ups',
      );
      expect(meta.activityState).toBe('done');
    });
  });

  describe('the override rule (FR-TERMINAL-770)', () => {
    it('lets a user focus ack clear a hook-driven session inside the window', () => {
      const meta = baseMeta({ activityState: 'waiting', hookDriven: true, lastHookAt: Date.now() });
      ctx.state.terminalSessionMeta.set('sess-ack', meta);
      applyActivityState(ctx.state, 'sess-ack', 'idle', 'user');
      expect(meta.activityState).toBe('idle');
    });

    it('[FR-TERMINAL-770] drops a relay act inside the trust window', () => {
      const meta = baseMeta({ activityState: 'done', hookDriven: true, lastHookAt: Date.now() });
      ctx.state.terminalSessionMeta.set('sess-window', meta);
      applyActivityState(ctx.state, 'sess-window', 'active', 'relay');
      expect(meta.activityState).toBe('done');
    });

    it('[FR-TERMINAL-780] applies a relay act once the trust window has elapsed', () => {
      const meta = baseMeta({
        activityState: 'done',
        hookDriven: true,
        lastHookAt: Date.now() - ACTIVITY_HOOK_TRUST_WINDOW_MS - 1,
      });
      ctx.state.terminalSessionMeta.set('sess-window-expired', meta);
      applyActivityState(ctx.state, 'sess-window-expired', 'active', 'relay');
      expect(meta.activityState).toBe('active');
    });

    it('always applies a hook-sourced call, even inside the window', () => {
      const meta = baseMeta({ activityState: 'active', hookDriven: true, lastHookAt: Date.now() });
      ctx.state.terminalSessionMeta.set('sess-hook-always', meta);
      applyActivityState(ctx.state, 'sess-hook-always', 'done', 'hook');
      expect(meta.activityState).toBe('done');
    });

    it('always applies a relay act on a non-hook-driven session', () => {
      const meta = baseMeta({ activityState: 'active' });
      ctx.state.terminalSessionMeta.set('sess-non-hook', meta);
      applyActivityState(ctx.state, 'sess-non-hook', 'idle', 'relay');
      expect(meta.activityState).toBe('idle');
    });
  });

  describe('dispatch flush', () => {
    it('[FR-TERMINAL-790] flushes a queued dispatch on a hook-derived done', () => {
      const meta = baseMeta({ activityState: 'active' });
      ctx.state.terminalSessionMeta.set('sess-flush', meta);
      connectWorker(ctx.state, 'sess-flush', 'worker');
      const entry = createDispatch(ctx.state, 'sess-flush', 'do the thing');
      expect(entry.status).toBe('queued');

      handleStopActivity(payload('Stop'), meta, ctx.state, 'sess-flush');

      expect(ctx.state.dispatches.get(entry.correlationId)?.status).not.toBe('queued');
    });

    it('[FR-TERMINAL-780] a session that gets UserPromptSubmit and then nothing stays deliverable once the window passes', () => {
      // hookDriven/lastHookAt are normally stamped by the HTTP router before a
      // handler runs (index.ts) — set here since the handler is called directly.
      const meta = baseMeta({ hookDriven: true, lastHookAt: Date.now() });
      ctx.state.terminalSessionMeta.set('sess-recover', meta);
      handleUserPromptSubmitActivity(payload('UserPromptSubmit'), meta, ctx.state, 'sess-recover');
      expect(meta.activityState).toBe('active');

      connectWorker(ctx.state, 'sess-recover', 'worker');
      const entry = createDispatch(ctx.state, 'sess-recover', 'later task');
      expect(entry.status).toBe('queued');

      // No further hook fires. Age the last hook past the trust window so the
      // relay heuristic is trusted again, then let a relay idle transition heal it.
      meta.lastHookAt = Date.now() - ACTIVITY_HOOK_TRUST_WINDOW_MS - 1;
      applyActivityState(ctx.state, 'sess-recover', 'idle', 'relay');

      expect(meta.activityState).toBe('idle');
      expect(ctx.state.dispatches.get(entry.correlationId)?.status).not.toBe('queued');
    });
  });

  describe('FR-TERMINAL-800: hookDriven on the broadcast payload', () => {
    it('broadcasts hookDriven: true for a hook-driven session', () => {
      const meta = baseMeta({ hookDriven: true, lastHookAt: Date.now() });
      ctx.state.terminalSessionMeta.set('sess-broadcast-hook', meta);
      const { events } = captureBroadcasts(ctx);

      handleStopActivity(payload('Stop'), meta, ctx.state, 'sess-broadcast-hook');

      const change = events.find(
        (e): e is { type: string; payload: { sessionId: string; hookDriven?: boolean } } =>
          (e as { type: string }).type === 'TERMINAL_ACTIVITY_CHANGE',
      );
      expect(change?.payload.sessionId).toBe('sess-broadcast-hook');
      expect(change?.payload.hookDriven).toBe(true);
    });

    it('broadcasts hookDriven: undefined for a non-hook session', () => {
      const meta = baseMeta();
      ctx.state.terminalSessionMeta.set('sess-broadcast-non-hook', meta);
      const { events } = captureBroadcasts(ctx);

      applyActivityState(ctx.state, 'sess-broadcast-non-hook', 'active', 'relay');

      const change = events.find(
        (e): e is { type: string; payload: { sessionId: string; hookDriven?: boolean } } =>
          (e as { type: string }).type === 'TERMINAL_ACTIVITY_CHANGE',
      );
      expect(change?.payload.sessionId).toBe('sess-broadcast-non-hook');
      expect(change?.payload.hookDriven).toBeUndefined();
    });
  });
});
