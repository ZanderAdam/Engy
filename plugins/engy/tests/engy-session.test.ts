import type { On } from 'claude-code';
import { describe, expect, mock, test } from 'claude-code/testing';

const HOOK_URL = 'http://engy.test/hooks/session-1';

function okResponse(text = '{}') {
  return { value: { status: 200, ok: true, headers: {}, text } };
}

function jsonBody(body: string | { readonly base64: string } | undefined): unknown {
  if (typeof body !== 'string')
    throw new Error(`expected a JSON string body, got ${JSON.stringify(body)}`);
  return JSON.parse(body);
}

function engyEnv(on: On, variables: Record<string, string>): string[] {
  const unset: string[] = [];
  mock.env(on, variables);
  on('env.set', ($, e) => {
    unset.push(e.name);
    return { value: {} };
  });
  return unset;
}

describe('Engy session mod', () => {
  test('[FR-TERMINAL-610] forwards Stop to ENGY_HOOK_URL as the raw hook payload', async ($, on) => {
    const posts: { url: string; body: unknown }[] = [];
    engyEnv(on, { ENGY_HOOK_URL: HOOK_URL });
    mock.clock(on);
    on('http.fetch', ($, e) => {
      posts.push({ url: e.url, body: jsonBody(e.init?.body) });
      return okResponse();
    });
    on('classic.Stop', () => ({}));

    await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'done' });

    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe(HOOK_URL);
    expect(posts[0]?.body).toEqual(
      expect.objectContaining({ hook_event_name: 'Stop', last_assistant_message: 'done' }),
    );
  });

  test('[FR-TERMINAL-630] stays inert without ENGY_HOOK_URL', async ($, on) => {
    let fetched = false;
    engyEnv(on, {});
    mock.clock(on);
    on('http.fetch', () => {
      fetched = true;
      return okResponse();
    });
    on('classic.Stop', () => ({}));

    await $.classic.Stop({ stop_hook_active: false });

    expect(fetched).toBe(false);
  });

  test('[FR-TERMINAL-630] unsets the Engy env so child processes do not inherit it', async ($, on) => {
    const unset = engyEnv(on, { ENGY_HOOK_URL: HOOK_URL, ENGY_MEMORY_CAPTURE: '1' });
    mock.clock(on);
    on('http.fetch', () => okResponse());
    on('classic.Stop', () => ({}));

    await $.classic.Stop({ stop_hook_active: false });

    expect(unset.sort()).toEqual(['ENGY_HOOK_URL', 'ENGY_MEMORY_CAPTURE']);
  });

  test('[FR-TERMINAL-620] lets the event go on when Engy does not answer within 5 seconds', async ($, on) => {
    engyEnv(on, { ENGY_HOOK_URL: HOOK_URL });
    const clock = mock.clock(on);
    on('http.fetch', () => new Promise<never>(() => {}));
    on('classic.Stop', () => ({}));

    const stop = $.classic.Stop({ stop_hook_active: false });
    await clock.advance(5_000);

    await expect(stop).resolves.toEqual({});
  });

  test('[FR-TERMINAL-640] appends the server context to SessionStart', async ($, on) => {
    engyEnv(on, { ENGY_HOOK_URL: HOOK_URL });
    mock.clock(on);
    on('http.fetch', () => okResponse(JSON.stringify({ additionalContext: '## Project: demo' })));
    on('classic.SessionStart', () => ({ additionalContext: ['from settings'] }));

    const result = await $.classic.SessionStart({ source: 'startup' });

    expect(result.additionalContext).toEqual(['from settings', '## Project: demo']);
  });

  test('[FR-TERMINAL-640] leaves SessionStart unchanged when the server reply is not JSON', async ($, on) => {
    engyEnv(on, { ENGY_HOOK_URL: HOOK_URL });
    mock.clock(on);
    on('http.fetch', () => okResponse('<html>'));
    on('classic.SessionStart', () => ({ additionalContext: ['from settings'] }));

    const result = await $.classic.SessionStart({ source: 'startup' });

    expect(result.additionalContext).toEqual(['from settings']);
  });

  test('[FR-MEMORY-300] posts a PreCompact distillation when memory capture is on', async ($, on) => {
    const events: unknown[] = [];
    engyEnv(on, { ENGY_HOOK_URL: HOOK_URL, ENGY_MEMORY_CAPTURE: '1' });
    mock.clock(on);
    on('model.fork', () => ({
      value: {
        isAnswered: true,
        text: '{"memories":[]}',
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    }));
    on('http.fetch', ($, e) => {
      events.push(jsonBody(e.init?.body));
      return okResponse();
    });
    on('classic.PreCompact', () => ({}));

    await $.classic.PreCompact({ trigger: 'manual', custom_instructions: null });

    expect(events).toEqual([{ hook_event_name: 'MemoryCapture', distillation: '{"memories":[]}' }]);
  });

  test('[FR-MEMORY-300] skips the PreCompact distillation when memory capture is off', async ($, on) => {
    let forked = false;
    engyEnv(on, { ENGY_HOOK_URL: HOOK_URL });
    mock.clock(on);
    on('model.fork', () => {
      forked = true;
      return { value: { isAnswered: false, reason: 'nothing-to-fork' } };
    });
    on('classic.PreCompact', () => ({}));

    await $.classic.PreCompact({ trigger: 'auto', custom_instructions: null });

    expect(forked).toBe(false);
  });
});
