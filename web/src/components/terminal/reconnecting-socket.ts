// Backoff mirrors the daemon's implementation in client/src/ws/client.ts —
// keep both in sync if constants change.
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const JITTER_FACTOR = 0.2;

export function computeBackoff(attempt: number): number {
  const base = Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  const jitter = base * JITTER_FACTOR * (2 * Math.random() - 1);
  return Math.max(0, base + jitter);
}

interface ReconnectingSocketCallbacks {
  onOpen: (ws: WebSocket) => void;
  onMessage: (event: MessageEvent) => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
}

interface ReconnectingSocketOptions {
  urlFactory: () => string;
  callbacks: ReconnectingSocketCallbacks;
  WebSocketImpl?: typeof WebSocket;
  computeBackoff?: (attempt: number) => number;
}

export class ReconnectingSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isFinal = false;
  private isClosed = false;
  private readonly urlFactory: () => string;
  private readonly callbacks: ReconnectingSocketCallbacks;
  private readonly WebSocketImpl: typeof WebSocket;
  private readonly backoff: (attempt: number) => number;
  private readonly onVisibilityChange: () => void;
  private readonly onOnline: () => void;

  constructor(opts: ReconnectingSocketOptions) {
    this.urlFactory = opts.urlFactory;
    this.callbacks = opts.callbacks;
    this.WebSocketImpl = opts.WebSocketImpl ?? WebSocket;
    this.backoff = opts.computeBackoff ?? computeBackoff;

    this.onVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        this.handleWake();
      }
    };
    this.onOnline = () => this.handleWake();

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
    }

    this.connect();
  }

  send(data: string): void {
    if (this.ws?.readyState === this.WebSocketImpl.OPEN) {
      this.ws.send(data);
    }
  }

  get readyState(): number {
    return this.ws?.readyState ?? this.WebSocketImpl.CLOSED;
  }

  /** Mark the session as permanently ended. No more reconnect attempts. */
  markFinal(): void {
    this.isFinal = true;
    this.clearReconnectTimer();
  }

  /** Tear down: remove listeners, close the socket, and prevent future reconnects. */
  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.clearReconnectTimer();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
    }
    try {
      this.ws?.close();
    } catch {
      // ignore — already closing/closed
    }
    this.ws = null;
  }

  private connect(): void {
    if (this.isClosed || this.isFinal) return;

    const ws = new this.WebSocketImpl(this.urlFactory());
    this.ws = ws;

    ws.onopen = () => {
      if (this.isClosed || this.isFinal || this.ws !== ws) return;
      this.attempt = 0;
      this.callbacks.onOpen(ws);
    };
    ws.onmessage = (event) => {
      if (this.isClosed || this.isFinal || this.ws !== ws) return;
      this.callbacks.onMessage(event);
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.callbacks.onClose?.(event);
      if (this.isClosed || this.isFinal) return;
      this.scheduleReconnect();
    };
    ws.onerror = (event) => {
      if (this.ws !== ws) return;
      this.callbacks.onError?.(event);
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = this.backoff(this.attempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private handleWake(): void {
    if (this.isClosed || this.isFinal) return;
    const ws = this.ws;

    // A connection attempt is in flight — let it complete naturally.
    if (
      ws &&
      (ws.readyState === this.WebSocketImpl.CONNECTING ||
        ws.readyState === this.WebSocketImpl.CLOSING)
    ) {
      return;
    }

    this.attempt = 0;
    this.clearReconnectTimer();

    // Zombie sockets (post-sleep TCP half-close) may never fire onclose, so do not
    // rely on it: detach the old socket, close it best-effort, and start a fresh
    // connection immediately. The server keys reconnect off sessionId (see
    // terminal-server.ts), so this transparently re-attaches and replays the buffer.
    if (ws && ws.readyState === this.WebSocketImpl.OPEN) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      try {
        ws.close(4000, 'wake-recover');
      } catch {
        // ignore
      }
      this.ws = null;
    }

    this.connect();
  }
}
