import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { getAppState } from '../trpc/context';
import { isTtsEnabledForWorkspace } from '../ws/voice-server';
import { broadcastVoiceSpeak } from '../ws/broadcast';
import { mcpResult, mcpError } from './result';

// Long answers cannot be skimmed or interrupted, so the limit is part of the
// contract rather than a safety valve — it is stated in the tool description
// so the agent writes to it instead of being truncated by it.
//
// Duplicated from tts.ts's MAX_SPEAK_CHARS rather than imported: tts.ts loads
// the native sherpa addon at module top level, and this file is imported
// statically by every MCP session — importing tts.ts here would load that
// addon on every server boot.
const MAX_SPEAK_CHARS = 600;

const speakInput = {
  text: z
    .string()
    .min(1)
    .max(MAX_SPEAK_CHARS)
    .describe(
      `What to say out loud, in at most ${MAX_SPEAK_CHARS} characters. Write for the ear: one or two plain sentences, no markdown, no code, no file paths, no lists. Say the outcome, not the steps.`,
    ),
};

/**
 * Lets an agent answer out loud. `callerTerminalSessionId` is the path token
 * from the caller's `/mcp/<id>` endpoint, so the utterance carries which
 * terminal produced it.
 *
 * The tool only broadcasts — synthesis happens when the browser fetches
 * `/api/voice/speak`. That keeps the agent's call cheap and non-blocking, and
 * means an agent speaking to nobody (no browser open) costs nothing.
 */
export function registerVoiceTools(mcp: McpServer, callerTerminalSessionId?: string): void {
  mcp.tool(
    'speak',
    "Say something out loud to the user through Engy's voice. Use it when the user asked by voice and wants a spoken answer — a short status summary, or confirmation that a long task finished. Not for routine narration: everything you speak interrupts the user, and they cannot skim it.",
    speakInput,
    async ({ text }) => {
      const meta = callerTerminalSessionId
        ? getAppState().terminalSessionMeta.get(callerTerminalSessionId)
        : undefined;

      if (!isTtsEnabledForWorkspace(meta?.workspaceSlug)) {
        return mcpError(
          'Spoken replies are off for this workspace. Answer in text instead — the user has not enabled voice output.',
        );
      }

      broadcastVoiceSpeak({
        text,
        workspaceSlug: meta?.workspaceSlug,
        sessionId: callerTerminalSessionId,
        scopeLabel: meta?.scopeLabel ?? undefined,
      });
      return mcpResult({ spoken: true, text });
    },
  );
}
