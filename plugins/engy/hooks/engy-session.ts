import type { EngineInterface, Register } from 'claude-code';
import type { EngySession } from '../types';

const FORWARD_TIMEOUT_MS = 5_000;

const MEMORY_CAPTURE_EVENT = 'MemoryCapture';

const MEMORY_CAPTURE_PROMPT =
  'You are a background memory-capture job for this Engy-managed session, which is about to be compacted. ' +
  'Apply the engy:session-distill extraction criteria: reflect on the conversation so far and extract 1 to 3 atomic, non-obvious, durable learnings -- a decision and its rationale, a gotcha found the hard way, a rejected approach -- that the code or commit history would not already reveal. Skip anything routine or already obvious from a diff. ' +
  'Reply with ONLY a single JSON object, with no prose before or after it: {"memories":[{"content":"...","type":"capture","tags":["..."]}]}. Structure each memory\'s content as Core claim / What surprised / Connects to / Contradicts, one claim per memory. If nothing is worth remembering, reply {"memories":[]}.';

const engySession = { plugin: 'engy', key: 'session' } as const;

let latched: EngySession | undefined;

// The env is unset once read: every child of the agent (Bash, a nested claude)
// inherits it, and a nested claude would forward its events as this session's.
// ENGY_MCP_URL stays set: /reload-plugins re-expands .mcp.json from this env.
// `$.state` is cleared by /clear and the module variable by a reload, so the
// latched values live in both.
async function readEngySession($: EngineInterface): Promise<EngySession> {
  const { value } = await $.state.get(engySession);
  if (value) {
    latched = value;
    return value;
  }
  if (latched) {
    await $.state.set(engySession, latched);
    return latched;
  }

  const session: EngySession = {
    hookUrl: (await $.env.get('ENGY_HOOK_URL')) ?? null,
    memoryCapture: (await $.env.get('ENGY_MEMORY_CAPTURE')) === '1',
  };
  latched = session;
  await $.state.set(engySession, session);
  if (session.hookUrl) {
    await $.env.set('ENGY_HOOK_URL', undefined);
    await $.env.set('ENGY_MEMORY_CAPTURE', undefined);
  }
  return session;
}

async function postToEngy($: EngineInterface, body: unknown): Promise<string | undefined> {
  const { hookUrl } = await readEngySession($);
  if (!hookUrl) return undefined;

  const timeout = new AbortController();
  const request = $.http
    .fetch(hookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    .then(
      (response) => (response.ok ? response.text : undefined),
      () => undefined,
    );
  const expiry = $.clock.sleep(FORWARD_TIMEOUT_MS, { signal: timeout.signal }).then(
    () => undefined,
    () => undefined,
  );

  const text = await Promise.race([request, expiry]);
  timeout.abort();
  return text;
}

async function forward<E, R>($: EngineInterface, e: E, next: (e: E) => Promise<R>): Promise<R> {
  await postToEngy($, e);
  return next(e);
}

function parseAdditionalContext(response: string | undefined): string | undefined {
  if (!response) return undefined;
  try {
    const parsed: unknown = JSON.parse(response);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const context = (parsed as { additionalContext?: unknown }).additionalContext;
    return typeof context === 'string' && context ? context : undefined;
  } catch {
    return undefined;
  }
}

async function captureMemories($: EngineInterface): Promise<void> {
  const reply = await $.model.fork({ prompt: MEMORY_CAPTURE_PROMPT });
  if (!reply.isAnswered) return;
  await postToEngy($, { hook_event_name: MEMORY_CAPTURE_EVENT, distillation: reply.text });
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await readEngySession($);
    return next(e);
  });

  on('classic.UserPromptSubmit', forward);
  on('classic.Stop', forward);
  on('classic.StopFailure', forward);
  on('classic.Notification', forward);
  on('classic.SubagentStart', forward);
  on('classic.SubagentStop', forward);
  on('classic.CwdChanged', forward);

  on('classic.SessionStart', async ($, e, next) => {
    const [result, response] = await Promise.all([next(e), postToEngy($, e)]);
    const context = parseAdditionalContext(response);
    if (!context) return result;
    return { ...result, additionalContext: [...(result.additionalContext ?? []), context] };
  });

  on('classic.PreCompact', async ($, e, next) => {
    const { hookUrl, memoryCapture } = await readEngySession($);
    if (hookUrl && memoryCapture) {
      await captureMemories($);
    }
    return next(e);
  });
};
