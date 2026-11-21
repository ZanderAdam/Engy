import type { AppState, TerminalSessionMeta } from '../trpc/context';

/**
 * A Claude Code hook payload, forwarded by the Engy session mod. `session_id` here is Claude's
 * own conversation id — distinct from the Engy terminal session id carried in
 * the `/hooks/<sessionId>` path, which is what identifies the caller.
 */
export interface HookPayload {
  session_id?: string;
  hook_event_name: string;
  // Present only on events fired from inside a subagent (Stop,
  // UserPromptSubmit), which otherwise carry the parent's own session_id.
  agent_id?: string;
  notification_type?: string;
  // Not part of the real CLI schema — set only on the synthetic
  // MEMORY_CAPTURE_HOOK_EVENT the session mod POSTs. The model's own reply,
  // `{"memories":[...]}`; untrusted, parsed defensively.
  distillation?: unknown;
  [key: string]: unknown;
}

// `sessionId` is the Engy terminal session id — the `/hooks/<sessionId>` path
// token the router already parsed. It is not `payload.session_id`, which is
// Claude's own conversation id and does not identify the same thing.
export type HookHandler = (
  payload: HookPayload,
  meta: TerminalSessionMeta,
  state: AppState,
  sessionId: string,
) => void;

/** Handlers registered for one `hook_event_name`, in registration order. */
export type HookRegistry = Record<string, HookHandler[]>;
