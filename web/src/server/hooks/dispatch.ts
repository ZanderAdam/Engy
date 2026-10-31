import { settleDispatch } from '../terminal-dispatch';
import { listWorkerDispatches, saveDispatch } from '../terminal-dispatch-store';
import { stripControlCharacters } from '../../lib/osc-title';
import { isSubagentEvent } from './shared';
import type { HookHandler, HookPayload } from './types';

const LAST_OUTPUT_MAX_CHARS = 2_000;
const DISPATCH_MARKER = '[engy-dispatch';

function readPromptId(payload: HookPayload): string | undefined {
  return typeof payload.prompt_id === 'string' && payload.prompt_id ? payload.prompt_id : undefined;
}

/**
 * Marks a dispatch `delivered` when the worker's UserPromptSubmit opens the
 * turn its paste started, and records that turn's `prompt_id` so the Stop that
 * closes that exact turn — not any later Stop — is the one allowed to settle
 * it. Only a prompt carrying that dispatch's own `[engy-dispatch <id>]` marker
 * counts, so neither a human turn nor another dispatch's turn acks it. A PTY
 * write alone leaves the dispatch at `written`.
 */
export const tagDispatchDeliveryTurn: HookHandler = (payload, meta, _state, sessionId) => {
  if (isSubagentEvent(payload)) return;
  const promptId = readPromptId(payload);
  if (!promptId) return;
  meta.currentPromptId = promptId;
  if (typeof payload.prompt !== 'string') return;

  // The contract is appended last, so an earlier marker is only quoted text.
  const lastMarker = payload.prompt.slice(payload.prompt.lastIndexOf(DISPATCH_MARKER));
  const entry = listWorkerDispatches(sessionId, ['written']).find((candidate) =>
    lastMarker.startsWith(`${DISPATCH_MARKER} ${candidate.correlationId}]`),
  );
  if (!entry) return;
  entry.deliveryPromptId = promptId;
  entry.status = 'delivered';
  entry.deliveredAt = Date.now();
  saveDispatch(entry);
};

/**
 * Safety net for a worker that never calls `terminal_reply`: the turn that
 * carried the dispatch ended with no reply. The dispatch settles as `stopped`
 * — the turn ended, which proves nothing about the work — with the reason and
 * the worker's last output.
 */
export const settleDispatchOnStop: HookHandler = (payload, _meta, state, sessionId) => {
  if (isSubagentEvent(payload)) return;
  const promptId = readPromptId(payload);
  if (!promptId) return;

  const entry = listWorkerDispatches(sessionId, ['delivered']).find(
    (candidate) => candidate.deliveryPromptId === promptId,
  );
  if (!entry) return;

  const message =
    typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message : '';
  settleDispatch(state, entry, 'stopped', {
    settledBy: 'hook',
    stopReason: 'the worker turn ended without a terminal_reply call',
    lastOutput: stripControlCharacters(message).slice(0, LAST_OUTPUT_MAX_CHARS),
  });
};
