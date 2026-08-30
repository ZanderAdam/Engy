// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveAction } from '../resolve';
import { createTerminalActions } from './terminal';

describe('terminal actions', () => {
  let dispatched: CustomEvent[] = [];
  let listener: (e: Event) => void;

  beforeEach(() => {
    dispatched = [];
    listener = (e) => dispatched.push(e as CustomEvent);
    window.addEventListener('terminal:focus', listener);
  });

  afterEach(() => {
    window.removeEventListener('terminal:focus', listener);
    dispatched = [];
  });

  it('should omit the focus action when no sessions are live', () => {
    expect(createTerminalActions({ sessions: [] })).toEqual([]);
  });

  it('[FR-TG2.6] should emit the existing terminal:focus signal for an ordinal reference', () => {
    const actions = createTerminalActions({
      sessions: [
        { sessionId: 'sess-1', label: 'build' },
        { sessionId: 'sess-2', label: 'test' },
      ],
    });

    const resolved = resolveAction('focus terminal two', actions);
    expect(resolved.matched).toBe(true);
    if (resolved.matched) void resolved.result.action.run({ params: resolved.result.params });

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].detail).toEqual({ sessionId: 'sess-2' });
  });

  it('[FR-TG2.6] should emit the existing terminal:focus signal for a label reference', () => {
    const actions = createTerminalActions({
      sessions: [
        { sessionId: 'sess-1', label: 'build' },
        { sessionId: 'sess-2', label: 'test' },
      ],
    });

    const resolved = resolveAction('focus terminal build', actions);
    expect(resolved.matched).toBe(true);
    if (resolved.matched) void resolved.result.action.run({ params: resolved.result.params });

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].detail).toEqual({ sessionId: 'sess-1' });
  });

  it('should emit nothing when the reference matches no session', () => {
    const actions = createTerminalActions({ sessions: [{ sessionId: 'sess-1', label: 'build' }] });
    const action = actions[0];
    void action.run({ params: { name: 'nine' } });
    expect(dispatched).toHaveLength(0);
  });

  it('should not invent a new signal for terminal focus', () => {
    // Guards against regressing to a bespoke event: the action's only side
    // effect is the terminal:focus CustomEvent FR-TERMINAL-240 already owns.
    const spy = vi.spyOn(window, 'dispatchEvent');
    const actions = createTerminalActions({ sessions: [{ sessionId: 'sess-1', label: 'build' }] });
    void actions[0].run({ params: { name: 'build' } });
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0][0] as CustomEvent).type).toBe('terminal:focus');
    spy.mockRestore();
  });
});
