import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { terminalSessionHistory } from '../db/schema';
import { recordSessionStart } from '../ws/terminal-session-history';
import type { AppState, TerminalSessionMeta } from '../trpc/context';
import type { HookPayload } from './types';
import {
  handleStopTitle,
  handleNotificationAttention,
  handleClearAttention,
  clearAttention,
} from './title';

function baseMeta(overrides: Partial<TerminalSessionMeta> = {}): TerminalSessionMeta {
  return {
    scopeType: 'project',
    scopeLabel: 'my-project',
    workingDir: '/home/user/project',
    agentType: 'claude',
    workspaceSlug: 'ws-1',
    cols: 80,
    rows: 24,
    ...overrides,
  };
}

function stopPayload(overrides: Partial<HookPayload> = {}): HookPayload {
  return {
    session_id: 'claude-conv-1',
    hook_event_name: 'Stop',
    last_assistant_message: 'Fixed the flaky title test',
    ...overrides,
  };
}

function notificationPayload(overrides: Partial<HookPayload> = {}): HookPayload {
  return {
    session_id: 'claude-conv-1',
    hook_event_name: 'Notification',
    notification_type: 'permission_prompt',
    ...overrides,
  };
}

function userPromptSubmitPayload(overrides: Partial<HookPayload> = {}): HookPayload {
  return {
    session_id: 'claude-conv-1',
    hook_event_name: 'UserPromptSubmit',
    ...overrides,
  };
}

function openWs(): WebSocket {
  return { readyState: 1, send: vi.fn() } as unknown as WebSocket;
}

function makeState(sessionId: string, meta: TerminalSessionMeta): AppState {
  return {
    terminalSessionMeta: new Map([[sessionId, meta]]),
    terminalSessions: new Map(),
  } as AppState;
}

describe('hooks/title', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTestDb();
    return () => ctx.cleanup();
  });

  describe('handleStopTitle', () => {
    it('[FR-TERMINAL-710] sets lastTitle and the history summary with no browser attached', () => {
      const sessionId = 'sess-1';
      const meta = baseMeta();
      const state = makeState(sessionId, meta);
      recordSessionStart(sessionId, meta);

      handleStopTitle(stopPayload(), meta, state, sessionId);

      expect(meta.lastTitle).toBe('Fixed the flaky title test');
      const rows = ctx.db.select().from(terminalSessionHistory).all();
      expect(rows).toHaveLength(1);
      expect(rows[0].summary).toBe('Fixed the flaky title test');
    });

    it('[FR-TERMINAL-710] keys the history summary by resumedFrom when the session was resumed', () => {
      const sessionId = 'sess-resumed';
      const meta = baseMeta({ resumedFrom: 'claude-conv-original' });
      const state = makeState(sessionId, meta);
      recordSessionStart(sessionId, meta);

      handleStopTitle(stopPayload(), meta, state, sessionId);

      const rows = ctx.db.select().from(terminalSessionHistory).all();
      expect(rows[0].sessionId).toBe('claude-conv-original');
      expect(rows[0].summary).toBe('Fixed the flaky title test');
    });

    it('[FR-TERMINAL-720] strips control characters from last_assistant_message before persisting', () => {
      const sessionId = 'sess-2';
      const meta = baseMeta();
      const state = makeState(sessionId, meta);
      recordSessionStart(sessionId, meta);

      handleStopTitle(
        stopPayload({ last_assistant_message: '\x07Done\x1bfixing bug\x00' }),
        meta,
        state,
        sessionId,
      );

      expect(meta.lastTitle).toBe('Donefixing bug');
    });

    it('[FR-TERMINAL-720] truncates a very long message at a code-point boundary', () => {
      const sessionId = 'sess-3';
      const meta = baseMeta();
      const state = makeState(sessionId, meta);
      recordSessionStart(sessionId, meta);
      // Surrogate-pair emoji repeated so a blind character-count slice would
      // split a pair — sanitizeOscTitle's own boundary check is exercised here.
      const longMessage = '🙂'.repeat(300);

      handleStopTitle(stopPayload({ last_assistant_message: longMessage }), meta, state, sessionId);

      // Truncated at exactly 256 UTF-16 units — a blind slice would land
      // mid-surrogate-pair and leave a lone (unpaired) trailing code unit.
      expect(meta.lastTitle).toBe('🙂'.repeat(128));
      expect(meta.lastTitle!.length).toBe(256);
    });

    it('[TG1 gate] ignores a Stop fired inside a subagent (same session_id, agent_id set)', () => {
      const sessionId = 'sess-4';
      const meta = baseMeta({ lastTitle: 'Original title' });
      const state = makeState(sessionId, meta);
      recordSessionStart(sessionId, meta);

      handleStopTitle(
        stopPayload({ agent_id: 'sub-1', last_assistant_message: 'Subagent internal reply' }),
        meta,
        state,
        sessionId,
      );

      expect(meta.lastTitle).toBe('Original title');
      const rows = ctx.db.select().from(terminalSessionHistory).all();
      expect(rows[0].summary).toBe('my-project');
    });

    it('pushes the derived title to every attached browser socket', () => {
      const sessionId = 'sess-5';
      const meta = baseMeta();
      const state = makeState(sessionId, meta);
      recordSessionStart(sessionId, meta);
      const ws = openWs();
      state.terminalSessions.set(sessionId, new Set([ws]));

      handleStopTitle(stopPayload(), meta, state, sessionId);

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ t: 'title', sessionId, title: 'Fixed the flaky title test' }),
      );
    });

    it('is a no-op when the browser echoes the derived title back (matches meta.lastTitle)', () => {
      const sessionId = 'sess-6';
      const meta = baseMeta({ lastTitle: 'Fixed the flaky title test' });
      const state = makeState(sessionId, meta);
      recordSessionStart(sessionId, meta);
      const ws = openWs();
      state.terminalSessions.set(sessionId, new Set([ws]));

      handleStopTitle(stopPayload(), meta, state, sessionId);

      expect(ws.send).not.toHaveBeenCalled();
      const rows = ctx.db.select().from(terminalSessionHistory).all();
      // Summary was never touched by this call — still the recordSessionStart default.
      expect(rows[0].summary).toBe('my-project');
    });

    it('does nothing when last_assistant_message is missing', () => {
      const sessionId = 'sess-7';
      const meta = baseMeta();
      const state = makeState(sessionId, meta);

      handleStopTitle(stopPayload({ last_assistant_message: undefined }), meta, state, sessionId);

      expect(meta.lastTitle).toBeUndefined();
    });
  });

  describe('handleNotificationAttention', () => {
    it.each(['permission_prompt', 'agent_needs_input', 'elicitation_dialog'])(
      '[FR-TERMINAL-730] sets needsAttention and returns the 9;4 set sequence for %s',
      (notification_type) => {
        const sessionId = 'sess-8';
        const meta = baseMeta();
        const state = makeState(sessionId, meta);

        const result = handleNotificationAttention(
          notificationPayload({ notification_type }),
          meta,
          state,
          sessionId,
        );

        expect(meta.needsAttention).toBe(true);
        expect(result).toEqual({ terminalSequence: '\x1b]9;4;4;0\x07' });
      },
    );

    it('[FR-TERMINAL-730] ignores an unrecognised notification_type, leaving attention unset', () => {
      const sessionId = 'sess-9';
      const meta = baseMeta();
      const state = makeState(sessionId, meta);

      const result = handleNotificationAttention(
        notificationPayload({ notification_type: 'idle_prompt' }),
        meta,
        state,
        sessionId,
      );

      expect(meta.needsAttention).toBeUndefined();
      expect(result).toBeUndefined();
    });

    it('[FR-TERMINAL-730] ignores a missing notification_type rather than guessing', () => {
      const sessionId = 'sess-10';
      const meta = baseMeta();
      const state = makeState(sessionId, meta);

      const result = handleNotificationAttention(
        notificationPayload({ notification_type: undefined }),
        meta,
        state,
        sessionId,
      );

      expect(meta.needsAttention).toBeUndefined();
      expect(result).toBeUndefined();
    });

    it('[TG1 gate] ignores a Notification fired inside a subagent', () => {
      const sessionId = 'sess-11';
      const meta = baseMeta();
      const state = makeState(sessionId, meta);

      handleNotificationAttention(
        notificationPayload({ agent_id: 'sub-1' }),
        meta,
        state,
        sessionId,
      );

      expect(meta.needsAttention).toBeUndefined();
    });

    it('is a no-op when attention is already set', () => {
      const sessionId = 'sess-12';
      const meta = baseMeta({ needsAttention: true });
      const state = makeState(sessionId, meta);

      const result = handleNotificationAttention(notificationPayload(), meta, state, sessionId);

      expect(result).toBeUndefined();
      expect(meta.needsAttention).toBe(true);
    });
  });

  describe('handleClearAttention', () => {
    it('[FR-TERMINAL-730] clears needsAttention on Stop and returns the 9;4 clear sequence', () => {
      const sessionId = 'sess-14';
      const meta = baseMeta({ needsAttention: true });
      const state = makeState(sessionId, meta);

      const result = handleClearAttention(stopPayload(), meta, state, sessionId);

      expect(meta.needsAttention).toBe(false);
      expect(result).toEqual({ terminalSequence: '\x1b]9;4;0;0\x07' });
    });

    it('[FR-TERMINAL-730] clears needsAttention on UserPromptSubmit', () => {
      const sessionId = 'sess-15';
      const meta = baseMeta({ needsAttention: true });
      const state = makeState(sessionId, meta);

      const result = handleClearAttention(userPromptSubmitPayload(), meta, state, sessionId);

      expect(meta.needsAttention).toBe(false);
      expect(result).toEqual({ terminalSequence: '\x1b]9;4;0;0\x07' });
    });

    it('[TG1 gate] ignores a Stop fired inside a subagent, leaving attention set', () => {
      const sessionId = 'sess-16';
      const meta = baseMeta({ needsAttention: true });
      const state = makeState(sessionId, meta);

      handleClearAttention(stopPayload({ agent_id: 'sub-1' }), meta, state, sessionId);

      expect(meta.needsAttention).toBe(true);
    });

    it('is a no-op when attention was never set', () => {
      const sessionId = 'sess-17';
      const meta = baseMeta();
      const state = makeState(sessionId, meta);

      const result = handleClearAttention(stopPayload(), meta, state, sessionId);

      expect(result).toBeUndefined();
    });
  });

  describe('clearAttention', () => {
    it('[FR-TERMINAL-730] clears needsAttention for the browser focus ack path', () => {
      const sessionId = 'sess-18';
      const meta = baseMeta({ needsAttention: true });
      const state = makeState(sessionId, meta);

      clearAttention(state, sessionId);

      expect(meta.needsAttention).toBe(false);
    });

    it('does nothing for an unknown session id', () => {
      const state = makeState('sess-19', baseMeta());

      expect(() => clearAttention(state, 'not-a-real-session')).not.toThrow();
    });
  });
});
