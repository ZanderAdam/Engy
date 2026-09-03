import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type WebSocket from 'ws';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerVoiceTools } from './voice-tools';
import { resetAppState, type AppState } from '../trpc/context';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { workspaces } from '../db/schema';

// Mirrors terminal-tools.test.ts's harness: invoke a registered tool handler
// directly, applying the tool's zod schema like the SDK would.
function callTool(mcp: McpServer, name: string) {
  const tools = (
    mcp as unknown as {
      _registeredTools: Record<
        string,
        {
          inputSchema?: { safeParse?: (p: unknown) => { success: boolean; data: unknown } };
          handler: (
            args: unknown,
            extra: unknown,
          ) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
        }
      >;
    }
  )._registeredTools;
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
  registerVoiceTools(mcp, callerTerminalSessionId);
  return mcp;
}

/** Captures what reached the browser, since broadcasting is the tool's only
 * effect — synthesis happens later, when the browser fetches the audio. */
function captureBroadcasts(state: AppState): string[] {
  const sent: string[] = [];
  state.fileChangeListeners.add({
    readyState: 1,
    OPEN: 1,
    send: (d: string) => sent.push(d),
  } as unknown as WebSocket);
  return sent;
}

function addSession(state: AppState, sessionId: string, workspaceSlug?: string): void {
  state.terminalSessionMeta.set(sessionId, {
    scopeType: 'project',
    scopeLabel: 'build',
    workingDir: '/tmp',
    activityState: 'idle',
    agentType: 'claude',
    workspaceSlug,
    cols: 80,
    rows: 24,
  });
}

describe('MCP voice tools', () => {
  let ctx: TestContext;
  let state: AppState;

  beforeEach(() => {
    ctx = setupTestDb();
    state = ctx.state;
    ctx.db
      .insert(workspaces)
      .values({ name: 'WS', slug: 'ws', repos: ['/repo'], voiceEnabled: true, ttsEnabled: true })
      .run();
  });

  afterEach(() => {
    resetAppState();
  });

  describe('speak', () => {
    it('[FR-TG2.24] should broadcast the utterance to the browser', async () => {
      addSession(state, 'sess-1', 'ws');
      const sent = captureBroadcasts(state);

      const { data, isError } = await callTool(makeMcp('sess-1'), 'speak')({
        text: 'Tests are green.',
      });

      expect(isError).toBe(false);
      expect(data).toEqual({ spoken: true, text: 'Tests are green.' });
      expect(sent).toHaveLength(1);
      // workspaceSlug is what stops the utterance playing in every open tab:
      // broadcasts reach every socket, whatever workspace it is showing.
      expect(JSON.parse(sent[0])).toEqual({
        type: 'VOICE_SPEAK',
        payload: {
          text: 'Tests are green.',
          workspaceSlug: 'ws',
          sessionId: 'sess-1',
          scopeLabel: 'build',
        },
      });
    });

    // Speaking is opt-in per workspace. An agent that cannot be heard must be
    // told so, or it will believe the user got an answer they never heard.
    it('[FR-TG2.24] should refuse and say so when spoken replies are off', async () => {
      ctx.db.update(workspaces).set({ ttsEnabled: false }).run();
      addSession(state, 'sess-1', 'ws');
      const sent = captureBroadcasts(state);

      const { isError } = await callTool(makeMcp('sess-1'), 'speak')({ text: 'Hello.' });

      expect(isError).toBe(true);
      expect(sent).toEqual([]);
    });

    it('[FR-TG2.24] should refuse when voice input is off, even with TTS on', async () => {
      ctx.db.update(workspaces).set({ voiceEnabled: false }).run();
      addSession(state, 'sess-1', 'ws');

      const { isError } = await callTool(makeMcp('sess-1'), 'speak')({ text: 'Hello.' });
      expect(isError).toBe(true);
    });

    // An agent registered at plain /mcp has no terminal identity, so there is
    // no workspace to check the opt-in against.
    it('should refuse a caller with no terminal identity', async () => {
      const { isError } = await callTool(makeMcp(), 'speak')({ text: 'Hello.' });
      expect(isError).toBe(true);
    });

    it('should refuse a session whose workspace is unknown', async () => {
      addSession(state, 'sess-1', 'no-such-workspace');
      const { isError } = await callTool(makeMcp('sess-1'), 'speak')({ text: 'Hello.' });
      expect(isError).toBe(true);
    });
  });
});
