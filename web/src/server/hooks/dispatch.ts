import type { AppState, DispatchEntry } from '../trpc/context';
import { settleDispatch } from '../terminal-dispatch';
import { stripControlCharacters } from '../../lib/osc-title';
import { isSubagentEvent } from './shared';
import type { HookHandler, HookPayload } from './types';

function readPromptId(payload: HookPayload): string | undefined {
  return typeof payload.prompt_id === 'string' && payload.prompt_id ? payload.prompt_id : undefined;
}

function oldestDeliveredDispatch(
  state: AppState,
  workerSessionId: string,
  predicate: (entry: DispatchEntry) => boolean,
): DispatchEntry | undefined {
  let oldest: DispatchEntry | undefined;
  for (const entry of state.dispatches.values()) {
    if (entry.workerSessionId !== workerSessionId || entry.status !== 'delivered') continue;
    if (!predicate(entry)) continue;
    if (!oldest || (entry.deliveredAt ?? 0) < (oldest.deliveredAt ?? 0)) oldest = entry;
  }
  return oldest;
}

/**
 * Records which turn a dispatch's delivery paste started, so the Stop that
 * closes that exact turn — not any later Stop — is the one allowed to settle
 * it. Registered on `UserPromptSubmit`; the delivered dispatch has no
 * `prompt_id` to tag with until the CLI opens the turn the paste triggered.
 */
export const tagDispatchDeliveryTurn: HookHandler = (payload, _meta, state, sessionId) => {
  if (isSubagentEvent(payload)) return;
  const promptId = readPromptId(payload);
  if (!promptId) return;

  const entry = oldestDeliveredDispatch(
    state,
    sessionId,
    (candidate) => candidate.deliveryPromptId == null,
  );
  if (entry) entry.deliveryPromptId = promptId;
};

/**
 * Safety net for a worker that never calls `terminal_reply`: settles the
 * dispatch its own turn carried using `last_assistant_message`. `replyContract`
 * in the pasted prompt is left unchanged — this only covers the model
 * forgetting it.
 */
export const settleDispatchOnStop: HookHandler = (payload, _meta, state, sessionId) => {
  if (isSubagentEvent(payload)) return;
  const promptId = readPromptId(payload);
  if (!promptId) return;

  const entry = oldestDeliveredDispatch(
    state,
    sessionId,
    (candidate) => candidate.deliveryPromptId === promptId,
  );
  if (!entry) return;

  const message =
    typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message : '';
  settleDispatch(state, entry, 'replied', stripControlCharacters(message), undefined, 'hook');
};
