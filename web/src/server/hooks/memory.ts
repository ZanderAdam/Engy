/** FR-MEMORY-310: origin marker, force-set server-side — the model's JSON is never trusted to include it. */
export const MEMORY_CAPTURE_ORIGIN_TAG = 'hook-capture';

/**
 * Synthetic `hook_event_name` the Engy session mod POSTs after it distils a
 * session at PreCompact (`plugins/engy/hooks/engy-session.ts`). Distinct from
 * the real CLI events so nothing else that might reach `/hooks/<sessionId>`
 * can be mistaken for it.
 */
export const MEMORY_CAPTURE_HOOK_EVENT = 'MemoryCapture';
