// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveAction } from '../resolve';
import { createTerminalActions, type VoiceTerminalVocabEntry } from './terminal';

function entry(over: Partial<VoiceTerminalVocabEntry> = {}): VoiceTerminalVocabEntry {
  return { sessionId: 'sess-1', label: 'build', activity: 'idle', stopped: false, ...over };
}

const TWO = [
  entry({ sessionId: 'sess-1', label: 'build' }),
  entry({ sessionId: 'sess-2', label: 'test' }),
];

let submit: () => boolean = () => true;

function runPhrase(sessions: VoiceTerminalVocabEntry[], phrase: string): string | null {
  const resolved = resolveAction(phrase, createTerminalActions({ sessions, submit }));
  expect(resolved.matched, `"${phrase}" did not resolve`).toBe(true);
  if (!resolved.matched) return null;
  return (resolved.result.action.run({ params: resolved.result.params }) as string) ?? null;
}

describe('terminal actions', () => {
  let dispatched: CustomEvent[] = [];
  let listener: (e: Event) => void;

  beforeEach(() => {
    submit = () => true;
    dispatched = [];
    listener = (e) => dispatched.push(e as CustomEvent);
    window.addEventListener('terminal:focus', listener);
  });

  afterEach(() => {
    window.removeEventListener('terminal:focus', listener);
    dispatched = [];
  });

  it('should omit every terminal action when no sessions are live', () => {
    expect(createTerminalActions({ sessions: [], submit })).toEqual([]);
  });

  describe('focus', () => {
    // The numbers the rail shows while voice is on. Digits, number words, and
    // the recognizer's homophones for them all name the same terminal.
    it.each(['focus terminal 2', 'focus terminal two', 'focus terminal to'])(
      '[FR-TG2.5] should focus by number via "%s"',
      (phrase) => {
        runPhrase(TWO, phrase);
        expect(dispatched).toHaveLength(1);
        expect(dispatched[0].detail).toEqual({ sessionId: 'sess-2' });
      },
    );

    // The verbs a user actually reaches for. "select" is the one used for
    // projects, so it is what comes to mind for terminals too.
    it.each([
      'select terminal 2',
      'focus terminal 2',
      'open terminal 2',
      'switch to terminal 2',
      'go to terminal 2',
    ])('[FR-TG2.5] should focus via "%s"', (phrase) => {
      runPhrase(TWO, phrase);
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0].detail).toEqual({ sessionId: 'sess-2' });
    });

    // "select terminal" scored 0.64 against "status terminal" when the two
    // phrases were compared joined, clearing the threshold and running the
    // wrong action — the shared word "terminal" hid the only word that
    // differs. Scoring by the worst word drops it to 0.25.
    it('[FR-TG2.5] should not resolve a focus verb to the status action', () => {
      const resolved = resolveAction('select terminal 2', createTerminalActions({ sessions: TWO, submit }));
      expect(resolved.matched).toBe(true);
      if (!resolved.matched) return;
      expect(resolved.result.action.id).toBe('voice.terminal.focus');
    });

    it('[FR-TG2.5] should focus by label', () => {
      runPhrase(TWO, 'focus terminal build');
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0].detail).toEqual({ sessionId: 'sess-1' });
    });

    // Silence reads as a broken feature, so a number past the end says so
    // rather than doing nothing.
    it('should report a number past the end instead of focusing', () => {
      const answer = runPhrase(TWO, 'focus terminal nine');
      expect(dispatched).toHaveLength(0);
      expect(answer).toContain('No terminal matching');
    });

    it('should not invent a new signal for terminal focus', () => {
      // Guards against regressing to a bespoke event: the action's only side
      // effect is the terminal:focus CustomEvent FR-TERMINAL-240 already owns.
      const spy = vi.spyOn(window, 'dispatchEvent');
      runPhrase([entry()], 'focus terminal build');
      expect(spy).toHaveBeenCalledTimes(1);
      expect((spy.mock.calls[0][0] as CustomEvent).type).toBe('terminal:focus');
      spy.mockRestore();
    });
  });

  describe('send', () => {
    // Dictation never auto-submits into a live agent terminal, so submitting
    // is its own spoken step.
    it.each(['send', 'send it', 'send message', 'submit', 'press enter'])(
      '[FR-TG2.20] should press Enter via "%s"',
      (phrase) => {
        let pressed = 0;
        submit = () => {
          pressed += 1;
          return true;
        };
        runPhrase(TWO, phrase);
        expect(pressed).toBe(1);
      },
    );

    it('[FR-TG2.20] should report when no terminal took the Enter', () => {
      submit = () => false;
      expect(runPhrase(TWO, 'send')).toBe('No terminal took it.');
    });

    // "send", "status" and "help" are all one word, and a one-word phrase is
    // scored by that word alone — so they have to stay far apart.
    it.each([
      ['send', 'voice.terminal.send'],
      ['submit', 'voice.terminal.send'],
      ['status', 'voice.terminal.status.all'],
    ])('[FR-TG2.20] should resolve the one-word phrase "%s" to its own action', (phrase, id) => {
      const resolved = resolveAction(phrase, createTerminalActions({ sessions: TWO, submit }));
      expect(resolved.matched).toBe(true);
      if (!resolved.matched) return;
      expect(resolved.result.action.id).toBe(id);
    });
  });

  describe('status', () => {
    const MIXED = [
      entry({ sessionId: 's1', label: 'build', activity: 'idle' }),
      entry({ sessionId: 's2', label: 'test', activity: 'waiting' }),
      entry({ sessionId: 's3', label: 'docs', activity: 'active', detail: 'pnpm dev' }),
    ];

    it('[FR-TG2.18] should report every terminal with its number', () => {
      const answer = runPhrase(MIXED, 'terminal status') ?? '';
      expect(answer).toContain('1. build');
      expect(answer).toContain('2. test');
      expect(answer).toContain('3. docs');
    });

    // A status readout is only useful if what needs the user is at the top.
    it('[FR-TG2.18] should list a waiting terminal before idle ones', () => {
      const lines = (runPhrase(MIXED, 'terminal status') ?? '').split('\n');
      expect(lines[0]).toContain('test');
      expect(lines[0]).toContain('waiting for you');
      expect(lines[lines.length - 1]).toContain('build');
    });

    it('should include the running command when the shell set a title', () => {
      expect(runPhrase(MIXED, 'terminal status')).toContain('(pnpm dev)');
    });

    it('[FR-TG2.18] should report one terminal by number', () => {
      const answer = runPhrase(MIXED, 'status of terminal 2');
      expect(answer).toBe('2. test — waiting for you');
    });

    it('[FR-TG2.18] should report one terminal by label', () => {
      expect(runPhrase(MIXED, 'status of terminal docs')).toContain('3. docs — running');
    });

    it('should report a stopped terminal as stopped, not by activity', () => {
      const sessions = [entry({ label: 'build', activity: 'active', stopped: true })];
      expect(runPhrase(sessions, 'status of terminal 1')).toBe('1. build — stopped');
    });

    it('should report an unknown terminal instead of answering nothing', () => {
      expect(runPhrase(MIXED, 'status of terminal nine')).toContain('No terminal matching');
    });
  });
});
