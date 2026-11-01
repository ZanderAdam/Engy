import { posix } from 'node:path';
import type { AppState, TerminalSessionMeta } from '../trpc/context';
import { persistTerminalSession } from '../ws/terminal-session-store';
import { dispatchFileRead } from '../ws/server';
import { isSubagentEvent } from './shared';
import type { HookHandler } from './types';

const MAX_REPLY_LENGTH = 4000;
// A current recap follows the last turn, so it sits at the end of the transcript.
const TRANSCRIPT_TAIL_BYTES = 1024 * 1024;
const RECAP_FOOTER = /\s*\(disable recaps in \/config\)\s*$/;

/** Keeps what a park needs later: no hook fires when the CLI writes its recap. */
export const handleStopBrief: HookHandler = (payload, meta, _state, sessionId) => {
  if (isSubagentEvent(payload)) return;

  if (typeof payload.transcript_path === 'string') meta.transcriptPath = payload.transcript_path;
  if (typeof payload.last_assistant_message === 'string' && payload.last_assistant_message) {
    meta.lastReply = payload.last_assistant_message.slice(0, MAX_REPLY_LENGTH);
  }
  meta.lastStopAt = Date.now();
  persistTerminalSession(sessionId, meta);
};

/**
 * The newest `away_summary` entry of a Claude transcript, or undefined when
 * there is none from `notBefore` on. The entry is not public CLI API, so any
 * line that does not parse counts as no recap.
 */
export function parseRecap(transcript: string, notBefore: number): string | undefined {
  const lines = transcript.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"away_summary"')) continue;
    try {
      const entry = JSON.parse(lines[i]) as Record<string, unknown>;
      if (entry.subtype !== 'away_summary' || typeof entry.content !== 'string') continue;
      if (!(Date.parse(String(entry.timestamp)) >= notBefore)) return undefined;
      return entry.content.replace(RECAP_FOOTER, '');
    } catch {
      continue;
    }
  }
  return undefined;
}

/** The transcript recap when it is current, else the agent's last reply. */
export async function readParkBrief(
  transcriptPath: string,
  meta: TerminalSessionMeta,
  state: AppState,
  coderWorkspace?: string,
): Promise<string | undefined> {
  try {
    const { content } = await dispatchFileRead(
      posix.dirname(transcriptPath),
      posix.basename(transcriptPath),
      state,
      undefined,
      coderWorkspace,
      TRANSCRIPT_TAIL_BYTES,
    );
    return parseRecap(content, meta.lastStopAt ?? 0) ?? meta.lastReply;
  } catch (err) {
    console.warn(`[terminal] Failed to read transcript ${transcriptPath}:`, err);
    return meta.lastReply;
  }
}
