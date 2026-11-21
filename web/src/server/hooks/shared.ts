import type { HookPayload } from './types';

// A Stop/UserPromptSubmit/Notification/StopFailure fired inside a subagent
// carries the parent's own session_id, distinguished only by `agent_id`
// (confirmed for Stop/UserPromptSubmit in TG1's live-payload capture; applied
// on the same assumption elsewhere). Acting on it as if it were the parent's
// own event would let a subagent's internal turn drive the parent session's
// state.
export function isSubagentEvent(payload: HookPayload): boolean {
  return payload.agent_id != null;
}

export function resolveNotificationType(payload: HookPayload): string | undefined {
  const type = payload.notification_type;
  return typeof type === 'string' && type ? type : undefined;
}

/** `Notification` types that mean a session is blocked on a person. */
export const ATTENTION_NOTIFICATION_TYPES = new Set([
  'permission_prompt',
  'agent_needs_input',
  'elicitation_dialog',
]);
