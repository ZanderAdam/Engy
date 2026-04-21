// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReconnectingSocket, computeBackoff } from './reconnecting-socket';

type CloseOpts = { code?: number; reason?: string; wasClean?: boolean };

class FakeWebSocket {
  static CONNECTING = 0 as const;
  static OPEN = 1 as const;
  static CLOSING = 2 as const;
  static CLOSED = 3 as const;

  readyState: number = FakeWebSocket.CONNECTING;
  url: string;
  sent: string[] = [];
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

  send(data: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) {
      throw new Error('Not open');
    }
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code: code ?? 1000, reason: reason ?? '', wasClean: true } as CloseEvent);
  }

  simulateOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  simulateMessage(data: string): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  simulateClose(opts: CloseOpts = {}): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({
      code: opts.code ?? 1006,
      reason: opts.reason ?? '',
      wasClean: opts.wasClean ?? false,
    } as CloseEvent);
  }
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

function fireVisibilityChange(): void {
  document.dispatchEvent(new Event('visibilitychange'));
}

function fireOnline(): void {
  window.dispatchEvent(new Event('online'));
}

function makeHandlers() {
  return {
    onOpen: vi.fn(),
    onMessage: vi.fn(),
    onClose: vi.fn(),
    onError: vi.fn(),
  };
}

const deterministicBackoff = (attempt: number): number => {
  const table = [1000, 2000, 4000, 8000, 16000];
  return table[attempt] ?? 30_000;
};

const activeSubjects: ReconnectingSocket[] = [];

function createSubject(overrides: Partial<ConstructorParameters<typeof ReconnectingSocket>[0]> = {}) {
  const handlers = makeHandlers();
  const urlFactory = vi.fn(() => 'ws://test/ws/terminal?sessionId=abc');
  const socket = new ReconnectingSocket({
    urlFactory,
    callbacks: handlers,
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    computeBackoff: deterministicBackoff,
    ...overrides,
  });
  activeSubjects.push(socket);
  return { socket, handlers, urlFactory };
}

describe('ReconnectingSocket', () => {
  beforeEach(() => {
    FakeWebSocket.reset();
    setVisibility('visible');
    vi.useFakeTimers();
  });

  afterEach(() => {
    while (activeSubjects.length > 0) {
      activeSubjects.pop()?.close();
    }
    vi.useRealTimers();
  });

  describe('basic lifecycle', () => {
    it('opens a WebSocket on construction via urlFactory', () => {
      const { urlFactory } = createSubject();
      expect(urlFactory).toHaveBeenCalledOnce();
      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(FakeWebSocket.instances[0].url).toBe('ws://test/ws/terminal?sessionId=abc');
    });

    it('calls onOpen with the raw WebSocket when it opens', () => {
      const { handlers } = createSubject();
      FakeWebSocket.instances[0].simulateOpen();
      expect(handlers.onOpen).toHaveBeenCalledOnce();
      expect(handlers.onOpen).toHaveBeenCalledWith(FakeWebSocket.instances[0]);
    });

    it('forwards message events to onMessage', () => {
      const { handlers } = createSubject();
      FakeWebSocket.instances[0].simulateOpen();
      FakeWebSocket.instances[0].simulateMessage('payload');
      expect(handlers.onMessage).toHaveBeenCalledOnce();
      expect(handlers.onMessage.mock.calls[0][0].data).toBe('payload');
    });

    it('forwards close events to onClose', () => {
      const { handlers } = createSubject();
      FakeWebSocket.instances[0].simulateClose({ code: 1006, reason: 'lost' });
      expect(handlers.onClose).toHaveBeenCalledOnce();
      expect(handlers.onClose.mock.calls[0][0].code).toBe(1006);
    });

    it('send() forwards data when the socket is OPEN', () => {
      const { socket } = createSubject();
      FakeWebSocket.instances[0].simulateOpen();
      socket.send('hello');
      expect(FakeWebSocket.instances[0].sent).toEqual(['hello']);
    });

    it('send() is a no-op when the socket is not OPEN', () => {
      const { socket } = createSubject();
      expect(() => socket.send('hello')).not.toThrow();
      expect(FakeWebSocket.instances[0].sent).toEqual([]);
    });

    it('readyState reflects the underlying socket state', () => {
      const { socket } = createSubject();
      expect(socket.readyState).toBe(FakeWebSocket.CONNECTING);
      FakeWebSocket.instances[0].simulateOpen();
      expect(socket.readyState).toBe(FakeWebSocket.OPEN);
      FakeWebSocket.instances[0].simulateClose();
      expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
    });
  });

  describe('reconnect on unintended close', () => {
    it('schedules a reconnect after the socket closes', () => {
      createSubject();
      FakeWebSocket.instances[0].simulateOpen();
      FakeWebSocket.instances[0].simulateClose({ code: 1006 });
      expect(FakeWebSocket.instances).toHaveLength(1);
      vi.advanceTimersByTime(999);
      expect(FakeWebSocket.instances).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('carries the sessionId via urlFactory so the server treats it as a reconnect', () => {
      const { urlFactory } = createSubject();
      FakeWebSocket.instances[0].simulateOpen();
      FakeWebSocket.instances[0].simulateClose({ code: 1006 });
      vi.advanceTimersByTime(1000);
      expect(urlFactory).toHaveBeenCalledTimes(2);
      expect(FakeWebSocket.instances[1].url).toBe(FakeWebSocket.instances[0].url);
    });

    it('uses exponential backoff across consecutive failed attempts', () => {
      createSubject();
      FakeWebSocket.instances[0].simulateClose({ code: 1006 });
      vi.advanceTimersByTime(1000);
      expect(FakeWebSocket.instances).toHaveLength(2);

      FakeWebSocket.instances[1].simulateClose({ code: 1006 });
      vi.advanceTimersByTime(1999);
      expect(FakeWebSocket.instances).toHaveLength(2);
      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances).toHaveLength(3);

      FakeWebSocket.instances[2].simulateClose({ code: 1006 });
      vi.advanceTimersByTime(3999);
      expect(FakeWebSocket.instances).toHaveLength(3);
      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances).toHaveLength(4);
    });

    it('resets the attempt counter after a successful open', () => {
      createSubject();
      FakeWebSocket.instances[0].simulateClose({ code: 1006 });
      vi.advanceTimersByTime(1000);
      FakeWebSocket.instances[1].simulateOpen();
      FakeWebSocket.instances[1].simulateClose({ code: 1006 });
      vi.advanceTimersByTime(999);
      expect(FakeWebSocket.instances).toHaveLength(2);
      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances).toHaveLength(3);
    });

    it('does not reconnect after close()', () => {
      const { socket } = createSubject();
      FakeWebSocket.instances[0].simulateOpen();
      socket.close();
      vi.advanceTimersByTime(60_000);
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('does not reconnect after markFinal()', () => {
      const { socket } = createSubject();
      FakeWebSocket.instances[0].simulateOpen();
      socket.markFinal();
      FakeWebSocket.instances[0].simulateClose({ code: 1000 });
      vi.advanceTimersByTime(60_000);
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('close() closes the current underlying socket', () => {
      const { socket } = createSubject();
      FakeWebSocket.instances[0].simulateOpen();
      const ws = FakeWebSocket.instances[0];
      socket.close();
      expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    });

    it('does not invoke callbacks after close() even if the socket fires open later', () => {
      const { socket, handlers } = createSubject();
      socket.close();
      // Simulate the browser firing onopen for a CONNECTING socket that got closed
      FakeWebSocket.instances[0].simulateOpen();
      FakeWebSocket.instances[0].simulateMessage('data');
      expect(handlers.onOpen).not.toHaveBeenCalled();
      expect(handlers.onMessage).not.toHaveBeenCalled();
    });

    it('treats a clean close (code 1000) as a reconnect trigger when not final', () => {
      createSubject();
      FakeWebSocket.instances[0].simulateOpen();
      FakeWebSocket.instances[0].simulateClose({ code: 1000, wasClean: true });
      vi.advanceTimersByTime(1000);
      expect(FakeWebSocket.instances).toHaveLength(2);
    });
  });

  describe('wake-up handling', () => {
    it('reconnects immediately on visibilitychange(visible) when CLOSED with a pending reconnect timer', () => {
      createSubject();
      FakeWebSocket.instances[0].simulateClose({ code: 1006 });
      expect(FakeWebSocket.instances).toHaveLength(1);
      setVisibility('visible');
      fireVisibilityChange();
      expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('reconnects on online event when CLOSED', () => {
      createSubject();
      FakeWebSocket.instances[0].simulateClose({ code: 1006 });
      fireOnline();
      expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('force-closes a stale OPEN socket on wake and reconnects immediately', () => {
      createSubject();
      FakeWebSocket.instances[0].simulateOpen();
      const closeSpy = vi.spyOn(FakeWebSocket.instances[0], 'close');
      setVisibility('visible');
      fireVisibilityChange();
      expect(closeSpy).toHaveBeenCalledWith(4000, 'wake-recover');
      // Zombie sockets may never fire onclose — the wake path must connect directly,
      // not wait for onclose → scheduleReconnect.
      expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('reconnects on wake even when the old OPEN socket never fires onclose', () => {
      createSubject();
      const old = FakeWebSocket.instances[0];
      old.simulateOpen();
      // Detach the fake's internal close-to-onclose wiring to mimic a zombie socket.
      // The wake path must still create a new connection — it does not rely on
      // the old socket's onclose handler.
      const oldOnClose = old.onclose;
      old.onclose = null;
      fireVisibilityChange();
      expect(FakeWebSocket.instances).toHaveLength(2);
      // Advance time — no additional instances should appear from a stale timer.
      vi.advanceTimersByTime(10_000);
      expect(FakeWebSocket.instances).toHaveLength(2);
      // Restore to let cleanup proceed normally
      old.onclose = oldOnClose;
    });

    it('no-ops on visibilitychange(hidden)', () => {
      createSubject();
      FakeWebSocket.instances[0].simulateOpen();
      setVisibility('hidden');
      fireVisibilityChange();
      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(FakeWebSocket.instances[0].readyState).toBe(FakeWebSocket.OPEN);
    });

    it('no-ops when the current socket is still CONNECTING', () => {
      createSubject();
      expect(FakeWebSocket.instances[0].readyState).toBe(FakeWebSocket.CONNECTING);
      fireVisibilityChange();
      expect(FakeWebSocket.instances).toHaveLength(1);
      fireOnline();
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('wake resets the attempt counter so retries do not keep compounding', () => {
      createSubject();
      FakeWebSocket.instances[0].simulateClose({ code: 1006 });
      vi.advanceTimersByTime(1000);
      FakeWebSocket.instances[1].simulateClose({ code: 1006 });
      vi.advanceTimersByTime(2000);
      FakeWebSocket.instances[2].simulateClose({ code: 1006 });
      // attempt is now 3 — next delay would be 8000. Wake resets to 0.
      fireOnline();
      expect(FakeWebSocket.instances).toHaveLength(4);
      FakeWebSocket.instances[3].simulateClose({ code: 1006 });
      vi.advanceTimersByTime(999);
      expect(FakeWebSocket.instances).toHaveLength(4);
      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances).toHaveLength(5);
    });

    it('does not reconnect on wake after close()', () => {
      const { socket } = createSubject();
      FakeWebSocket.instances[0].simulateOpen();
      socket.close();
      setVisibility('visible');
      fireVisibilityChange();
      fireOnline();
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('does not reconnect on wake after markFinal()', () => {
      const { socket } = createSubject();
      FakeWebSocket.instances[0].simulateOpen();
      socket.markFinal();
      FakeWebSocket.instances[0].simulateClose({ code: 1000 });
      setVisibility('visible');
      fireVisibilityChange();
      fireOnline();
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('close() removes the visibility and online listeners', () => {
      const docRemove = vi.spyOn(document, 'removeEventListener');
      const winRemove = vi.spyOn(window, 'removeEventListener');
      const { socket } = createSubject();
      socket.close();
      expect(docRemove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
      expect(winRemove).toHaveBeenCalledWith('online', expect.any(Function));
    });
  });
});

describe('computeBackoff', () => {
  it('grows exponentially and caps at 30s', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5); // zero jitter
    try {
      expect(computeBackoff(0)).toBeCloseTo(1000, 0);
      expect(computeBackoff(1)).toBeCloseTo(2000, 0);
      expect(computeBackoff(2)).toBeCloseTo(4000, 0);
      expect(computeBackoff(5)).toBeCloseTo(30_000, 0);
      expect(computeBackoff(10)).toBeCloseTo(30_000, 0);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('applies jitter within ±20%', () => {
    const randomMin = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      expect(computeBackoff(2)).toBeCloseTo(4000 - 800, 0); // 3200
    } finally {
      randomMin.mockRestore();
    }
    const randomMax = vi.spyOn(Math, 'random').mockReturnValue(1);
    try {
      expect(computeBackoff(2)).toBeCloseTo(4000 + 800, 0); // 4800
    } finally {
      randomMax.mockRestore();
    }
  });

  it('never returns a negative value', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      for (let i = 0; i < 20; i++) {
        expect(computeBackoff(i)).toBeGreaterThanOrEqual(0);
      }
    } finally {
      randomSpy.mockRestore();
    }
  });
});
