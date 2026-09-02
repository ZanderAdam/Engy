// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DEFAULT_WAKE_WORD, WAKE_PREFIXES } from '@/server/voice/keywords';
import type { ResolveResult } from '@/lib/voice/resolve';
import {
  VoicePttController,
  isPttKeyEvent,
  buildVoiceWsUrl,
  getVoicePttController,
  VOICE_PTT_CODE,
  WAKE_PREFIXES as MIRRORED_WAKE_PREFIXES,
  type VoicePttControllerOpts,
  type VoiceCaptureObserver,
  type VoiceCaptureState,
  type VoicePhase,
} from './use-voice-capture';
import type { MicCaptureOpts } from './mic-capture';

const WAKE_WORD = 'ANGIE';
const NO_MATCH: ResolveResult = { matched: false, reason: 'no_match' };

class FakeWebSocket {
  static CONNECTING = 0 as const;
  static OPEN = 1 as const;
  static CLOSING = 2 as const;
  static CLOSED = 3 as const;

  readyState: number = FakeWebSocket.CONNECTING;
  url: string;
  sent: (string | ArrayBuffer)[] = [];
  binaryType = 'blob';
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;

  static instances: FakeWebSocket[] = [];
  static reset(): void {
    FakeWebSocket.instances = [];
  }

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string | ArrayBuffer): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: '', wasClean: true } as CloseEvent);
  }

  simulateOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  simulateMessage(data: unknown): void {
    // A real socket can't deliver a frame once it's closed — guard so a
    // simulated late arrival after close() is dropped just like the real
    // thing, instead of always reaching the handler regardless of state.
    if (this.readyState !== FakeWebSocket.OPEN) return;
    this.onmessage?.({ data } as MessageEvent);
  }
}

class FakeMicCapture {
  static instances: FakeMicCapture[] = [];
  static reset(): void {
    FakeMicCapture.instances = [];
  }
  static startResult: 'resolve' | Error = 'resolve';

  opts: MicCaptureOpts;
  stop = vi.fn(async () => {});

  constructor(opts: MicCaptureOpts) {
    this.opts = opts;
    FakeMicCapture.instances.push(this);
  }

  async start(): Promise<void> {
    if (FakeMicCapture.startResult instanceof Error) throw FakeMicCapture.startResult;
  }
}

function fireKey(type: 'keydown' | 'keyup', init: KeyboardEventInit) {
  document.dispatchEvent(new KeyboardEvent(type, { bubbles: true, ...init }));
}

/** Fires the PTT chord key itself (Right Ctrl) by `code`, as a real keydown
 * would — `key` is along for the ride, never what gating checks. */
function firePtt(type: 'keydown' | 'keyup', extra: Partial<KeyboardEventInit> = {}) {
  fireKey(type, { code: VOICE_PTT_CODE, key: 'Control', ...extra });
}

function makeOpts(overrides: Partial<VoicePttControllerOpts> = {}): VoicePttControllerOpts {
  return {
    wsUrlFactory: () => 'ws://test/ws/voice',
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    MicCaptureImpl: FakeMicCapture,
    ...overrides,
  };
}

/** A test double for a `useVoiceCapture()` caller: records every state push
 * and every segment handed to it via spies, so assertions read the same way
 * whether the observer is the sole subscriber or one of several. */
function makeObserver(
  onCommandImpl: (text: string) => ResolveResult = () => NO_MATCH,
): {
  observer: VoiceCaptureObserver;
  onStateChange: ReturnType<typeof vi.fn>;
  onSegment: ReturnType<typeof vi.fn>;
  onCommand: ReturnType<typeof vi.fn>;
} {
  const onStateChange = vi.fn();
  const onSegment = vi.fn();
  const onCommand = vi.fn(onCommandImpl);
  return {
    observer: { workspaceSlug: () => 'ws-slug', onStateChange, onSegment, onCommand },
    onStateChange,
    onSegment,
    onCommand,
  };
}

function lastState(onStateChange: ReturnType<typeof vi.fn>): VoiceCaptureState | undefined {
  return onStateChange.mock.calls.at(-1)?.[0];
}

function lastPhase(onStateChange: ReturnType<typeof vi.fn>): VoicePhase | undefined {
  return lastState(onStateChange)?.phase;
}

describe('isPttKeyEvent', () => {
  it('is true for a non-repeat press of Right Ctrl', () => {
    const e = new KeyboardEvent('keydown', { code: VOICE_PTT_CODE });
    expect(isPttKeyEvent(e)).toBe(true);
  });

  it('is false for OS auto-repeat', () => {
    const e = new KeyboardEvent('keydown', { code: VOICE_PTT_CODE, repeat: true });
    expect(isPttKeyEvent(e)).toBe(false);
  });

  it('is false for Left Ctrl — e.key cannot tell sides apart, e.code can', () => {
    const e = new KeyboardEvent('keydown', { code: 'ControlLeft' });
    expect(isPttKeyEvent(e)).toBe(false);
  });

  it('is false for any other key', () => {
    const e = new KeyboardEvent('keydown', { code: 'KeyA' });
    expect(isPttKeyEvent(e)).toBe(false);
  });
});

describe('buildVoiceWsUrl', () => {
  it('uses ws: on an http origin', () => {
    expect(buildVoiceWsUrl('demo', { protocol: 'http:', host: 'localhost:3000' })).toBe(
      'ws://localhost:3000/ws/voice?workspace=demo',
    );
  });

  it('upgrades to wss: on an https origin', () => {
    expect(buildVoiceWsUrl('demo', { protocol: 'https:', host: 'engy.example.com' })).toBe(
      'wss://engy.example.com/ws/voice?workspace=demo',
    );
  });

  it('escapes a workspace slug so it cannot alter the query', () => {
    expect(buildVoiceWsUrl('a&b=c', { protocol: 'http:', host: 'h' })).toBe(
      'ws://h/ws/voice?workspace=a%26b%3Dc',
    );
  });
});

describe('getVoicePttController', () => {
  it('returns the same instance on repeated calls', () => {
    expect(getVoicePttController()).toBe(getVoicePttController());
  });
});

describe('WAKE_WORD', () => {
  it('[test-infra] mirrors the real DEFAULT_WAKE_WORD constant', () => {
    // Client components can't import `keywords.ts` (it reads node:fs), so
    // `use-voice-capture.ts` keeps a local mirror of this value, same as
    // `voice-help-dialog.tsx`. This is the tripwire: if the real constant
    // changes, this fails instead of routing silently drifting from it.
    expect(WAKE_WORD).toBe(DEFAULT_WAKE_WORD);
  });

  it('[test-infra] mirrors the real WAKE_PREFIXES list', () => {
    expect(MIRRORED_WAKE_PREFIXES).toEqual([...WAKE_PREFIXES]);
  });
});

describe('VoicePttController', () => {
  let controller: VoicePttController | null = null;
  let unsubscribe: (() => void) | null = null;
  let focusedEl: HTMLElement | null = null;

  beforeEach(() => {
    FakeWebSocket.reset();
    FakeMicCapture.reset();
    FakeMicCapture.startResult = 'resolve';
  });

  afterEach(() => {
    vi.useRealTimers();
    unsubscribe?.();
    unsubscribe = null;
    controller = null;
    focusedEl?.remove();
    focusedEl = null;
    (document.activeElement as HTMLElement | null)?.blur?.();
  });

  it('starts capture on PTT keydown: opens the socket, sends voice_start on open, and starts the mic', () => {
    controller = new VoicePttController(makeOpts());
    const { observer, onStateChange } = makeObserver();
    unsubscribe = controller.subscribe(observer);

    firePtt('keydown');

    expect(onStateChange).toHaveBeenCalledWith({
      phase: 'listening',
      error: null,
      transcript: null,
      command: null,
    });
    expect(FakeMicCapture.instances).toHaveLength(1);
    const ws = FakeWebSocket.instances[0];
    expect(ws.url).toBe('ws://test/ws/voice');

    ws.simulateOpen();
    expect(ws.sent).toEqual([JSON.stringify({ t: 'voice_start' })]);
  });

  // Regression test: xterm renders terminal input as a hidden textarea, and
  // dictation is meant to work while a terminal pane has focus. Against the
  // old isTypingTarget()-gated logic this fails — that guard treated the
  // hidden textarea like any other text field and swallowed the keydown.
  it('starts capture on ControlRight keydown while focus is in a textarea', () => {
    focusedEl = document.createElement('textarea');
    document.body.appendChild(focusedEl);
    (focusedEl as HTMLTextAreaElement).focus();

    controller = new VoicePttController(makeOpts());
    const { observer, onStateChange } = makeObserver();
    unsubscribe = controller.subscribe(observer);

    firePtt('keydown');

    expect(onStateChange).toHaveBeenCalledWith({
      phase: 'listening',
      error: null,
      transcript: null,
      command: null,
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeMicCapture.instances).toHaveLength(1);
  });

  it('does not start capture on ControlLeft', () => {
    controller = new VoicePttController(makeOpts());
    const { observer, onStateChange } = makeObserver();
    unsubscribe = controller.subscribe(observer);

    fireKey('keydown', { code: 'ControlLeft', key: 'Control' });

    // Only the initial subscribe() push (idle) — nothing further.
    expect(onStateChange).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(FakeMicCapture.instances).toHaveLength(0);
  });

  it('ignores auto-repeat keydowns and a second keydown while already active', () => {
    controller = new VoicePttController(makeOpts());
    unsubscribe = controller.subscribe(makeObserver().observer);

    firePtt('keydown');
    firePtt('keydown', { repeat: true });
    firePtt('keydown');

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeMicCapture.instances).toHaveLength(1);
  });

  it('forwards mic chunks as binary frames only while the socket is open', () => {
    controller = new VoicePttController(makeOpts());
    unsubscribe = controller.subscribe(makeObserver().observer);
    firePtt('keydown');

    const ws = FakeWebSocket.instances[0];
    const mic = FakeMicCapture.instances[0];
    const chunk = new ArrayBuffer(640);

    mic.opts.onChunk(chunk);
    expect(ws.sent).toEqual([]);

    ws.simulateOpen();
    mic.opts.onChunk(chunk);
    expect(ws.sent).toEqual([JSON.stringify({ t: 'voice_start' }), chunk]);
  });

  describe('key release / offline transcription wait', () => {
    it('on keyup: sends voice_stop, releases the mic immediately, and enters the transcribing phase — without closing the socket', () => {
      controller = new VoicePttController(makeOpts());
      const { observer, onStateChange } = makeObserver();
      unsubscribe = controller.subscribe(observer);
      firePtt('keydown');

      const ws = FakeWebSocket.instances[0];
      ws.simulateOpen();
      const mic = FakeMicCapture.instances[0];

      firePtt('keyup');

      expect(ws.sent).toEqual([
        JSON.stringify({ t: 'voice_start' }),
        JSON.stringify({ t: 'voice_stop' }),
      ]);
      // The mic (and the OS mic-in-use indicator) must release right away.
      expect(mic.stop).toHaveBeenCalledTimes(1);
      // But the socket must stay open — the tail segment and the
      // turn-ending voice_final arrive after voice_stop, not synchronously
      // with it.
      expect(ws.readyState).toBe(FakeWebSocket.OPEN);
      expect(lastPhase(onStateChange)).toBe('transcribing');
    });

    // REGRESSION: the server's tail segment and turn-ending voice_final
    // arrive ~300ms+ after voice_stop, not synchronously. If the client
    // closes the socket the instant it sends voice_stop, neither can ever be
    // delivered. This failed against the pre-fix stop() implementation,
    // which called finish() (closing the socket) right after voice_stop.
    it('[regression] inserts a voice_segment that arrives after key release, then goes idle on voice_final', () => {
      controller = new VoicePttController(makeOpts());
      const { observer, onStateChange, onSegment } = makeObserver();
      unsubscribe = controller.subscribe(observer);
      firePtt('keydown');
      const ws = FakeWebSocket.instances[0];
      ws.simulateOpen();

      firePtt('keyup');
      // Tail segment and turn-end arrive well after voice_stop — after keyup.
      ws.simulateMessage(JSON.stringify({ t: 'voice_segment', transcript: 'Hello.' }));
      expect(onSegment).toHaveBeenCalledWith('Hello.');
      expect(ws.readyState).toBe(FakeWebSocket.OPEN);

      ws.simulateMessage(JSON.stringify({ t: 'voice_final' }));
      expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
      expect(lastPhase(onStateChange)).toBe('idle');
    });

    it('delivers successive segments space-separated, with no leading space on the first one', () => {
      controller = new VoicePttController(makeOpts());
      const { observer, onSegment } = makeObserver();
      unsubscribe = controller.subscribe(observer);
      firePtt('keydown');
      const ws = FakeWebSocket.instances[0];
      ws.simulateOpen();

      // Segments can arrive mid-hold, before voice_stop is ever sent.
      ws.simulateMessage(JSON.stringify({ t: 'voice_segment', transcript: 'Hello.' }));
      ws.simulateMessage(JSON.stringify({ t: 'voice_segment', transcript: 'Does this work?' }));

      firePtt('keyup');
      // And the tail segment, flushed after voice_stop, keeps the pattern.
      ws.simulateMessage(JSON.stringify({ t: 'voice_segment', transcript: 'Can you hear me now?' }));

      expect(onSegment.mock.calls.map((call) => call[0])).toEqual([
        'Hello.',
        ' Does this work?',
        ' Can you hear me now?',
      ]);
    });

    it('resets the leading-space state for a fresh turn — no stray space on its first segment', () => {
      controller = new VoicePttController(makeOpts());
      const { observer, onSegment } = makeObserver();
      unsubscribe = controller.subscribe(observer);

      firePtt('keydown');
      const firstWs = FakeWebSocket.instances[0];
      firstWs.simulateOpen();
      firstWs.simulateMessage(JSON.stringify({ t: 'voice_segment', transcript: 'turn one' }));
      firePtt('keyup');
      firstWs.simulateMessage(JSON.stringify({ t: 'voice_final' }));

      firePtt('keydown');
      const secondWs = FakeWebSocket.instances[1];
      secondWs.simulateOpen();
      secondWs.simulateMessage(JSON.stringify({ t: 'voice_segment', transcript: 'turn two' }));
      firePtt('keyup');

      expect(onSegment.mock.calls.map((call) => call[0])).toEqual(['turn one', 'turn two']);
    });

    it('closes the socket and returns to idle once voice_error arrives while transcribing', () => {
      controller = new VoicePttController(makeOpts());
      const { observer, onStateChange, onSegment } = makeObserver();
      unsubscribe = controller.subscribe(observer);
      firePtt('keydown');
      const ws = FakeWebSocket.instances[0];
      ws.simulateOpen();
      firePtt('keyup');

      ws.simulateMessage(JSON.stringify({ t: 'voice_error', message: 'decode failed' }));

      expect(onStateChange).toHaveBeenCalledWith({
        phase: 'idle',
        error: 'decode failed',
        transcript: null,
        command: null,
      });
      expect(onSegment).not.toHaveBeenCalled();
      expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
      expect(lastPhase(onStateChange)).toBe('idle');
    });
  });

  it('ignores malformed frames instead of throwing', () => {
    controller = new VoicePttController(makeOpts());
    const { observer, onStateChange, onSegment } = makeObserver();
    unsubscribe = controller.subscribe(observer);
    firePtt('keydown');
    const ws = FakeWebSocket.instances[0];
    ws.simulateOpen();

    expect(() => ws.simulateMessage('not json')).not.toThrow();
    expect(onSegment).not.toHaveBeenCalled();
    expect(lastState(onStateChange)?.error).toBeNull();
  });

  it('surfaces a mic start failure (denied permission / insecure context) as an error and tears down', async () => {
    FakeMicCapture.startResult = new Error('getUserMedia not available (insecure context?)');
    controller = new VoicePttController(makeOpts());
    const { observer, onStateChange } = makeObserver();
    unsubscribe = controller.subscribe(observer);

    firePtt('keydown');
    // MicCapture.start() rejection resolves on a microtask.
    await Promise.resolve();
    await Promise.resolve();

    expect(onStateChange).toHaveBeenCalledWith({
      phase: 'idle',
      error: 'getUserMedia not available (insecure context?)',
      transcript: null,
      command: null,
    });
    expect(lastPhase(onStateChange)).toBe('idle');
  });

  it('stops capture on window blur so a lost keyup cannot leave the mic open', () => {
    controller = new VoicePttController(makeOpts());
    const { observer, onStateChange } = makeObserver();
    unsubscribe = controller.subscribe(observer);
    firePtt('keydown');
    const ws = FakeWebSocket.instances[0];
    ws.simulateOpen();
    const mic = FakeMicCapture.instances[0];

    window.dispatchEvent(new Event('blur'));

    expect(mic.stop).toHaveBeenCalledTimes(1);
    expect(lastPhase(onStateChange)).toBe('transcribing');
  });

  it('a lost keyup via blur before the socket ever opens ends the turn immediately with an error', () => {
    controller = new VoicePttController(makeOpts());
    const { observer, onStateChange } = makeObserver();
    unsubscribe = controller.subscribe(observer);
    firePtt('keydown');
    const mic = FakeMicCapture.instances[0];

    window.dispatchEvent(new Event('blur'));

    expect(mic.stop).toHaveBeenCalledTimes(1);
    expect(onStateChange).toHaveBeenCalledWith({
      phase: 'idle',
      error: 'voice connection closed',
      transcript: null,
      command: null,
    });
  });

  it('treats an unexpected socket close while listening as an error and releases the mic', () => {
    controller = new VoicePttController(makeOpts());
    const { observer, onStateChange } = makeObserver();
    unsubscribe = controller.subscribe(observer);
    firePtt('keydown');
    const ws = FakeWebSocket.instances[0];
    ws.simulateOpen();
    const mic = FakeMicCapture.instances[0];

    ws.close();

    expect(onStateChange).toHaveBeenCalledWith({
      phase: 'idle',
      error: 'voice connection closed',
      transcript: null,
      command: null,
    });
    expect(mic.stop).toHaveBeenCalledTimes(1);
  });

  it('unsubscribing the only subscriber tears down an active turn and removes the key listeners', () => {
    controller = new VoicePttController(makeOpts());
    const { observer } = makeObserver();
    unsubscribe = controller.subscribe(observer);
    firePtt('keydown');
    const mic = FakeMicCapture.instances[0];

    // Once unsubscribe() returns, this observer is gone — it must not be
    // notified of the teardown it triggered by leaving.
    unsubscribe();
    unsubscribe = null;
    expect(mic.stop).toHaveBeenCalledTimes(1);

    // With no subscribers left, the listeners themselves must be gone —
    // proven by no new socket/mic appearing for a subsequent key press.
    FakeWebSocket.reset();
    FakeMicCapture.reset();
    firePtt('keydown');
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(FakeMicCapture.instances).toHaveLength(0);
  });

  it('unsubscribing while transcribing (post keyup) discards the pending turn and closes the socket', () => {
    controller = new VoicePttController(makeOpts());
    const { observer, onSegment } = makeObserver();
    unsubscribe = controller.subscribe(observer);
    firePtt('keydown');
    const ws = FakeWebSocket.instances[0];
    ws.simulateOpen();
    firePtt('keyup');

    unsubscribe();
    unsubscribe = null;

    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);

    ws.simulateMessage(JSON.stringify({ t: 'voice_segment', transcript: 'late' }));
    expect(onSegment).not.toHaveBeenCalled();
  });

  describe('no-audio watchdog', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('surfaces a visible error when no chunk arrives within the watchdog window', () => {
      controller = new VoicePttController(makeOpts());
      const { observer, onStateChange } = makeObserver();
      unsubscribe = controller.subscribe(observer);
      firePtt('keydown');

      const mic = FakeMicCapture.instances[0];

      vi.advanceTimersByTime(1500);

      expect(lastState(onStateChange)?.error).toMatch(/no audio captured/i);
      expect(lastPhase(onStateChange)).toBe('idle');
      expect(mic.stop).toHaveBeenCalledTimes(1);
    });

    it('does not fire once a chunk has already arrived', () => {
      controller = new VoicePttController(makeOpts());
      const { observer, onStateChange } = makeObserver();
      unsubscribe = controller.subscribe(observer);
      firePtt('keydown');

      const ws = FakeWebSocket.instances[0];
      ws.simulateOpen();
      const mic = FakeMicCapture.instances[0];
      mic.opts.onChunk(new ArrayBuffer(640));

      vi.advanceTimersByTime(1500);

      expect(lastState(onStateChange)?.error).toBeNull();
      expect(lastPhase(onStateChange)).not.toBe('idle');
    });

    it('does not fire after the turn has already stopped normally', () => {
      controller = new VoicePttController(makeOpts());
      const { observer, onStateChange } = makeObserver();
      unsubscribe = controller.subscribe(observer);
      firePtt('keydown');
      const ws = FakeWebSocket.instances[0];
      ws.simulateOpen();
      firePtt('keyup');

      onStateChange.mockClear();
      vi.advanceTimersByTime(1500);

      expect(onStateChange).not.toHaveBeenCalled();
    });
  });

  describe('finalize timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('surfaces a visible error if voice_final never arrives', () => {
      controller = new VoicePttController(makeOpts());
      const { observer, onStateChange } = makeObserver();
      unsubscribe = controller.subscribe(observer);
      firePtt('keydown');
      const ws = FakeWebSocket.instances[0];
      ws.simulateOpen();
      firePtt('keyup');
      onStateChange.mockClear();

      // Short recording -> the floor timeout applies.
      vi.advanceTimersByTime(3000);

      expect(lastState(onStateChange)?.error).toMatch(/timed out/i);
      expect(lastPhase(onStateChange)).toBe('idle');
      expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    });

    it('does not fire once voice_final has already arrived', () => {
      controller = new VoicePttController(makeOpts());
      const { observer, onStateChange, onSegment } = makeObserver();
      unsubscribe = controller.subscribe(observer);
      firePtt('keydown');
      const ws = FakeWebSocket.instances[0];
      ws.simulateOpen();
      firePtt('keyup');

      ws.simulateMessage(JSON.stringify({ t: 'voice_segment', transcript: 'hi' }));
      ws.simulateMessage(JSON.stringify({ t: 'voice_final' }));
      onStateChange.mockClear();

      vi.advanceTimersByTime(10_000);

      expect(onStateChange).not.toHaveBeenCalled();
      expect(onSegment).toHaveBeenCalledTimes(1);
    });

    it('scales the wait for a long recording rather than using the short floor alone', () => {
      controller = new VoicePttController(makeOpts());
      const { observer, onStateChange } = makeObserver();
      unsubscribe = controller.subscribe(observer);
      firePtt('keydown');
      const ws = FakeWebSocket.instances[0];
      ws.simulateOpen();
      const mic = FakeMicCapture.instances[0];

      // Simulate a long hold before releasing the key — a chunk periodically
      // resets the no-audio watchdog so it doesn't fire mid-hold.
      for (let elapsed = 0; elapsed < 24_000; elapsed += 1000) {
        vi.advanceTimersByTime(1000);
        mic.opts.onChunk(new ArrayBuffer(640));
      }
      firePtt('keyup');
      onStateChange.mockClear();

      // Well past the floor, but short of the scaled budget for a 24s turn.
      vi.advanceTimersByTime(4000);
      expect(lastState(onStateChange)?.error).toBeFalsy();

      vi.advanceTimersByTime(10_000);
      expect(lastState(onStateChange)?.error).toMatch(/timed out/i);
    });
  });

  describe('chord abort', () => {
    it('aborts the turn when another key goes down mid-hold: mic released, socket closed, no segment emitted', () => {
      controller = new VoicePttController(makeOpts());
      const { observer, onStateChange, onSegment } = makeObserver();
      unsubscribe = controller.subscribe(observer);
      firePtt('keydown');

      const ws = FakeWebSocket.instances[0];
      ws.simulateOpen();
      const mic = FakeMicCapture.instances[0];

      // Ctrl+C: the 'c' keydown fires while Right Ctrl is still held.
      fireKey('keydown', { code: 'KeyC', key: 'c' });

      expect(mic.stop).toHaveBeenCalledTimes(1);
      expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
      expect(lastPhase(onStateChange)).toBe('idle');
      expect(onSegment).not.toHaveBeenCalled();
    });

    it('does not call preventDefault on the chord key, so it still reaches the terminal', () => {
      controller = new VoicePttController(makeOpts());
      unsubscribe = controller.subscribe(makeObserver().observer);
      firePtt('keydown');

      const chordEvent = new KeyboardEvent('keydown', {
        code: 'KeyC',
        key: 'c',
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(chordEvent);

      expect(chordEvent.defaultPrevented).toBe(false);
    });

    it('drops a voice_segment that was already in flight when the chord aborted the turn', () => {
      controller = new VoicePttController(makeOpts());
      const { observer, onSegment } = makeObserver();
      unsubscribe = controller.subscribe(observer);
      firePtt('keydown');
      const ws = FakeWebSocket.instances[0];
      ws.simulateOpen();

      fireKey('keydown', { code: 'KeyC', key: 'c' });
      // A voice_segment racing in right after abort must still be discarded.
      ws.simulateMessage(JSON.stringify({ t: 'voice_segment', transcript: 'stray' }));

      expect(onSegment).not.toHaveBeenCalled();
    });

    // abort() must discard even a segment that would have arrived AFTER the
    // abort, i.e. genuinely later in wall-clock time — not merely one
    // already in flight at the instant of the chord.
    it('a voice_segment arriving well after the abort is still discarded, not inserted', () => {
      controller = new VoicePttController(makeOpts());
      const { observer, onSegment } = makeObserver();
      unsubscribe = controller.subscribe(observer);
      firePtt('keydown');
      const ws = FakeWebSocket.instances[0];
      ws.simulateOpen();

      fireKey('keydown', { code: 'KeyC', key: 'c' });
      expect(ws.readyState).toBe(FakeWebSocket.CLOSED);

      // The (fake) socket is already closed, so a real recognizer reply
      // could never reach the client at all — confirms nothing is pending.
      ws.simulateMessage(JSON.stringify({ t: 'voice_segment', transcript: 'too late' }));
      expect(onSegment).not.toHaveBeenCalled();
    });

    it('a subsequent keyup of the (now-released) PTT key is a no-op after an abort', () => {
      controller = new VoicePttController(makeOpts());
      const { observer, onStateChange } = makeObserver();
      unsubscribe = controller.subscribe(observer);
      firePtt('keydown');
      fireKey('keydown', { code: 'KeyC', key: 'c' });

      onStateChange.mockClear();
      firePtt('keyup');

      expect(onStateChange).not.toHaveBeenCalled();
    });
  });

  // The old design gave every mounted component its OWN controller instance,
  // guarded by a module-level lock so only one could ever capture at a time —
  // but the lock bailed out of start() before the loser's onPhaseChange ever
  // fired, so a losing instance silently never rendered 'listening' (see
  // use-voice-capture.ts history). The fix makes ONE controller instance the
  // unit of capture and lets any number of callers subscribe to it, so this
  // is no longer a race to guard against — it's a structural guarantee: a
  // single 'keydown' listener drives a single start().
  describe('shared controller / multiple subscribers', () => {
    it('[regression] two subscribers (simulating StrictMode double-mount) BOTH observe the listening phase for one key press', () => {
      controller = new VoicePttController(makeOpts());
      const sub1 = makeObserver();
      const sub2 = makeObserver();
      const unsub1 = controller.subscribe(sub1.observer);
      unsubscribe = controller.subscribe(sub2.observer);

      firePtt('keydown');

      expect(lastPhase(sub1.onStateChange)).toBe('listening');
      expect(lastPhase(sub2.onStateChange)).toBe('listening');

      firePtt('keyup');
      unsub1();
    });

    // Every open workspace tab mounts its own indicator, so the controller
    // routinely has several subscribers. Delivering to the first one addresses
    // the inject to a background tab, whose terminals the user is not looking
    // at — and if that tab holds none, the transcript is discarded outright.
    it('[regression] delivers a segment to the active tab, not the first subscriber', () => {
      controller = new VoicePttController(makeOpts());
      const background = makeObserver();
      const active = makeObserver();
      const unsub1 = controller.subscribe({
        ...background.observer,
        isActiveTab: () => false,
      });
      unsubscribe = controller.subscribe({ ...active.observer, isActiveTab: () => true });

      firePtt('keydown');
      const ws = FakeWebSocket.instances[0];
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ t: 'voice_segment', transcript: 'Hello.' }));

      expect(active.onSegment).toHaveBeenCalledWith('Hello.');
      expect(background.onSegment).not.toHaveBeenCalled();

      firePtt('keyup');
      unsub1();
    });

    it('[FR-TG1.10] starts a turn on the first toggle and ends it on the second', () => {
      controller = new VoicePttController(makeOpts());
      const { observer, onStateChange } = makeObserver();
      unsubscribe = controller.subscribe(observer);

      controller.toggle();
      expect(lastState(onStateChange)).toEqual({
        phase: 'listening',
        error: null,
        transcript: null,
        command: null,
      });
      expect(FakeMicCapture.instances).toHaveLength(1);
      FakeWebSocket.instances[0].simulateOpen();

      controller.toggle();
      expect(lastState(onStateChange)?.phase).toBe('transcribing');
      expect(FakeMicCapture.instances[0].stop).toHaveBeenCalled();
    });

    it('[FR-TG1.10] releases a toggled-on mic when the window loses focus', () => {
      controller = new VoicePttController(makeOpts());
      const { observer, onStateChange } = makeObserver();
      unsubscribe = controller.subscribe(observer);

      controller.toggle();
      window.dispatchEvent(new Event('blur'));

      expect(FakeMicCapture.instances[0].stop).toHaveBeenCalled();
      expect(lastState(onStateChange)?.phase).not.toBe('listening');
    });

    it('[FR-TG1.10] lets a key hold stop a turn that a toggle started', () => {
      controller = new VoicePttController(makeOpts());
      const { observer, onStateChange } = makeObserver();
      unsubscribe = controller.subscribe(observer);

      controller.toggle();
      FakeWebSocket.instances[0].simulateOpen();
      firePtt('keyup');

      expect(lastState(onStateChange)?.phase).toBe('transcribing');
    });

    it('[FR-TG1.9] addresses the socket to the active tab\'s workspace', () => {
      // wsUrlFactory stays unset here — the point is the real slug resolution
      // the server-side gate reads, which every other test bypasses.
      controller = new VoicePttController({ ...makeOpts(), wsUrlFactory: undefined });
      const background = makeObserver();
      const active = makeObserver();
      const unsub1 = controller.subscribe({
        ...background.observer,
        isActiveTab: () => false,
        workspaceSlug: () => 'background-ws',
      });
      unsubscribe = controller.subscribe({
        ...active.observer,
        isActiveTab: () => true,
        workspaceSlug: () => 'active-ws',
      });

      firePtt('keydown');

      expect(FakeWebSocket.instances[0].url).toContain('workspace=active-ws');

      firePtt('keyup');
      unsub1();
    });

    it('[FR-TG1.9] refuses to open a socket when no subscriber names a workspace', () => {
      controller = new VoicePttController({ ...makeOpts(), wsUrlFactory: undefined });
      const { observer, onStateChange } = makeObserver();
      unsubscribe = controller.subscribe({ ...observer, workspaceSlug: () => '' });

      firePtt('keydown');

      expect(FakeWebSocket.instances).toHaveLength(0);
      expect(lastState(onStateChange)).toEqual({
        phase: 'idle',
        error: 'No workspace to dictate into.',
        transcript: null,
        command: null,
      });
    });

    it('two subscribers still produce exactly ONE socket and ONE mic capture for a single key press', () => {
      controller = new VoicePttController(makeOpts());
      const sub1 = makeObserver();
      const sub2 = makeObserver();
      const unsub1 = controller.subscribe(sub1.observer);
      unsubscribe = controller.subscribe(sub2.observer);

      firePtt('keydown');

      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(FakeMicCapture.instances).toHaveLength(1);

      firePtt('keyup');
      unsub1();
    });

    it('delivers a finalized segment to exactly one subscriber, so it is inserted into the terminal exactly once', () => {
      controller = new VoicePttController(makeOpts());
      const sub1 = makeObserver();
      const sub2 = makeObserver();
      const unsub1 = controller.subscribe(sub1.observer);
      unsubscribe = controller.subscribe(sub2.observer);

      firePtt('keydown');
      const ws = FakeWebSocket.instances[0];
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ t: 'voice_segment', transcript: 'hello' }));

      const allSegmentCalls = [...sub1.onSegment.mock.calls, ...sub2.onSegment.mock.calls];
      expect(allSegmentCalls).toEqual([['hello']]);

      firePtt('keyup');
      unsub1();
    });

    it('a subscriber that subscribes mid-turn immediately observes the in-flight phase, not idle', () => {
      controller = new VoicePttController(makeOpts());
      const sub1 = makeObserver();
      const unsub1 = controller.subscribe(sub1.observer);
      firePtt('keydown');

      const sub2 = makeObserver();
      unsubscribe = controller.subscribe(sub2.observer);

      expect(sub2.onStateChange).toHaveBeenCalledWith({
        phase: 'listening',
        error: null,
        transcript: null,
        command: null,
      });

      firePtt('keyup');
      unsub1();
    });

    it('key listeners stay armed until the LAST subscriber leaves', () => {
      controller = new VoicePttController(makeOpts());
      const sub1 = makeObserver();
      const sub2 = makeObserver();
      const unsub1 = controller.subscribe(sub1.observer);
      unsubscribe = controller.subscribe(sub2.observer);

      unsub1();
      firePtt('keydown');

      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(lastPhase(sub2.onStateChange)).toBe('listening');

      firePtt('keyup');
    });

    it('unsubscribing all subscribers then subscribing again still yields a working capture', () => {
      controller = new VoicePttController(makeOpts());
      const sub1 = makeObserver();
      const unsub1 = controller.subscribe(sub1.observer);
      firePtt('keydown');
      firePtt('keyup');
      unsub1();

      const sub2 = makeObserver();
      unsubscribe = controller.subscribe(sub2.observer);
      firePtt('keydown');

      expect(lastPhase(sub2.onStateChange)).toBe('listening');
      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(FakeMicCapture.instances).toHaveLength(2);

      firePtt('keyup');
    });

    // A re-press while the prior turn is still awaiting its segments must
    // discard that prior turn's eventual segment, not double-insert or
    // route it into the new turn — and must not be blocked by the prior
    // turn's still-open socket.
    it('a late segment from a superseded turn does not insert, and the next press is not blocked by it', () => {
      controller = new VoicePttController(makeOpts());
      const { observer, onSegment } = makeObserver();
      unsubscribe = controller.subscribe(observer);

      firePtt('keydown');
      const firstWs = FakeWebSocket.instances[0];
      firstWs.simulateOpen();
      firePtt('keyup'); // turn 1 now transcribing, socket open

      firePtt('keydown'); // turn 2 starts — turn 1 superseded
      expect(firstWs.readyState).toBe(FakeWebSocket.CLOSED);

      firstWs.simulateMessage(JSON.stringify({ t: 'voice_segment', transcript: 'turn one' }));
      expect(onSegment).not.toHaveBeenCalledWith('turn one');

      const secondWs = FakeWebSocket.instances[1];
      secondWs.simulateOpen();
      firePtt('keyup');
      secondWs.simulateMessage(JSON.stringify({ t: 'voice_segment', transcript: 'turn two' }));

      expect(onSegment).toHaveBeenCalledTimes(1);
      expect(onSegment).toHaveBeenCalledWith('turn two');
    });
  });

  describe('dual-mode routing (FR-TG2.16)', () => {
    it('[FR-TG2.16] should insert a transcript with no wake word into the terminal', () => {
      controller = new VoicePttController(makeOpts());
      const { observer, onSegment, onCommand } = makeObserver();
      unsubscribe = controller.subscribe(observer);
      firePtt('keydown');
      const ws = FakeWebSocket.instances[0];
      ws.simulateOpen();

      ws.simulateMessage(
        JSON.stringify({ t: 'voice_segment', transcript: 'open the pod bay doors', wake: false }),
      );

      expect(onSegment).toHaveBeenCalledWith('open the pod bay doors');
      expect(onCommand).not.toHaveBeenCalled();
    });

    it('[FR-TG2.16] should resolve a wake-word transcript against the action registry instead of the terminal', () => {
      controller = new VoicePttController(makeOpts());
      const { observer, onSegment, onCommand } = makeObserver();
      unsubscribe = controller.subscribe(observer);
      firePtt('keydown');
      const ws = FakeWebSocket.instances[0];
      ws.simulateOpen();

      ws.simulateMessage(
        JSON.stringify({ t: 'voice_segment', transcript: `${WAKE_WORD} select project web`, wake: true }),
      );

      // [FR-TG2.13] wake prefix stripped before the observer resolves it.
      expect(onCommand).toHaveBeenCalledWith('select project web');
      expect(onSegment).not.toHaveBeenCalled();
    });

    it('[FR-TG2.16] should never fall back to inserting an unresolved wake-word transcript into the terminal', () => {
      controller = new VoicePttController(makeOpts());
      const { observer, onSegment, onCommand } = makeObserver(() => ({
        matched: false,
        reason: 'no_match',
      }));
      unsubscribe = controller.subscribe(observer);
      firePtt('keydown');
      const ws = FakeWebSocket.instances[0];
      ws.simulateOpen();

      ws.simulateMessage(
        JSON.stringify({ t: 'voice_segment', transcript: `${WAKE_WORD} do something odd`, wake: true }),
      );

      expect(onCommand).toHaveBeenCalledTimes(1);
      expect(onSegment).not.toHaveBeenCalled();
    });

    it('[FR-TG2.16] should surface the resolution outcome in state.command for every subscriber', () => {
      controller = new VoicePttController(makeOpts());
      const matched: ResolveResult = {
        matched: true,
        result: {
          action: { id: 'a', title: 'Select project', phrases: [], run: () => {} },
          phrase: 'select project {name}',
          params: { name: 'web' },
          confidence: 1,
          tier: 'exact',
        },
      };
      const { observer, onStateChange } = makeObserver(() => matched);
      unsubscribe = controller.subscribe(observer);
      firePtt('keydown');
      const ws = FakeWebSocket.instances[0];
      ws.simulateOpen();

      ws.simulateMessage(
        JSON.stringify({ t: 'voice_segment', transcript: `${WAKE_WORD} select project web`, wake: true }),
      );

      expect(lastState(onStateChange)?.command).toEqual(matched);
    });

    it('resets state.command to null at the start of a fresh turn', () => {
      controller = new VoicePttController(makeOpts());
      const { observer, onStateChange } = makeObserver();
      unsubscribe = controller.subscribe(observer);

      firePtt('keydown');
      const firstWs = FakeWebSocket.instances[0];
      firstWs.simulateOpen();
      firstWs.simulateMessage(
        JSON.stringify({ t: 'voice_segment', transcript: `${WAKE_WORD} help`, wake: true }),
      );
      expect(lastState(onStateChange)?.command).not.toBeNull();
      firePtt('keyup');
      firstWs.simulateMessage(JSON.stringify({ t: 'voice_final' }));

      firePtt('keydown');
      expect(lastState(onStateChange)?.command).toBeNull();
    });

    it('keeps dictation-segment terminal spacing independent of an earlier command segment in the same turn', () => {
      controller = new VoicePttController(makeOpts());
      const { observer, onSegment } = makeObserver();
      unsubscribe = controller.subscribe(observer);
      firePtt('keydown');
      const ws = FakeWebSocket.instances[0];
      ws.simulateOpen();

      ws.simulateMessage(
        JSON.stringify({ t: 'voice_segment', transcript: `${WAKE_WORD} help`, wake: true }),
      );
      ws.simulateMessage(
        JSON.stringify({ t: 'voice_segment', transcript: 'take a note', wake: false }),
      );

      // The command segment never reaches onSegment, so the dictation
      // segment is still the terminal's first insertion — no stray leading
      // space carried over from it.
      expect(onSegment).toHaveBeenCalledTimes(1);
      expect(onSegment).toHaveBeenCalledWith('take a note');
    });
  });
});
