'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import type { TerminalActivityState } from '@engy/common';

// ── Event Types ─────────────────────────────────────────────────────

type FileChangeEventType = 'add' | 'change' | 'unlink';

interface FileChangePayload {
  workspaceSlug: string;
  path: string;
  eventType: FileChangeEventType;
}

interface TaskChangePayload {
  action: 'created' | 'updated' | 'deleted';
  taskId: number;
  projectId?: number;
}

interface QuestionChangePayload {
  action: 'created' | 'answered';
  taskId?: number;
  sessionId?: string;
}

interface TerminalSessionsChangePayload {
  action: 'created' | 'destroyed' | 'attached' | 'detached' | 'renamed';
  sessionId: string;
  groupKey?: string;
  newLabel?: string;
  // 'killed' = deliberate teardown (user kill / agent terminal_close) — remove
  // the tab. Absent on natural PTY exit, where the tab stays readable.
  reason?: 'killed';
}

interface MemoryChangePayload {
  action: 'created' | 'updated' | 'deleted' | 'promoted' | 'dismissed' | 'restored';
  workspaceId: number;
  memoryId?: number;
}

interface TerminalActivityChangePayload {
  sessionId: string;
  projectSlug?: string;
  state?: TerminalActivityState;
  removed?: boolean;
}

interface PrChangePayload {
  workspaceId: number;
  repo: string;
}

interface PrAttentionPayload {
  workspaceId: number;
  repo: string;
  prNumber: number;
  reason: string;
}

interface TerminalWorkersChangePayload {
  sessionId: string;
  connected: boolean;
}

interface ServerEventMap {
  FILE_CHANGE: FileChangePayload;
  TASK_CHANGE: TaskChangePayload;
  QUESTION_CHANGE: QuestionChangePayload;
  TERMINAL_SESSIONS_CHANGE: TerminalSessionsChangePayload;
  MEMORY_CHANGE: MemoryChangePayload;
  TERMINAL_ACTIVITY_CHANGE: TerminalActivityChangePayload;
  PR_CHANGE: PrChangePayload;
  PR_ATTENTION: PrAttentionPayload;
  TERMINAL_WORKERS_CHANGE: TerminalWorkersChangePayload;
}

type ServerEventType = keyof ServerEventMap;

// ── Context ─────────────────────────────────────────────────────────

type EventCallback<T extends ServerEventType> = (payload: ServerEventMap[T]) => void;

interface EventsContextValue {
  subscribe: <T extends ServerEventType>(type: T, cb: EventCallback<T>) => () => void;
  subscribeConnect: (cb: () => void) => () => void;
  setWatchPaths: (key: symbol, workspaceSlug: string, paths: string[]) => void;
  clearWatchPaths: (key: symbol) => void;
}

const EventsContext = createContext<EventsContextValue | null>(null);

// ── Provider ────────────────────────────────────────────────────────

interface EventsProviderProps {
  workspaceSlug: string;
  children: ReactNode;
}

const WATCH_FLUSH_DEBOUNCE_MS = 200;

export function EventsProvider({ workspaceSlug, children }: EventsProviderProps) {
  const subscribersRef = useRef(new Map<string, Set<EventCallback<ServerEventType>>>());
  const connectSubscribersRef = useRef(new Set<() => void>());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const watchRegistryRef = useRef(new Map<symbol, { workspaceSlug: string; paths: string[] }>());
  const watchFlushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastWatchSentRef = useRef<string | null>(null);

  // Push this socket's full watch-path snapshot to the server (replace
  // semantics — the server keeps only the latest set per socket).
  const flushWatchPaths = useCallback((force = false) => {
    const bySlug = new Map<string, Set<string>>();
    for (const entry of watchRegistryRef.current.values()) {
      let set = bySlug.get(entry.workspaceSlug);
      if (!set) {
        set = new Set();
        bySlug.set(entry.workspaceSlug, set);
      }
      for (const p of entry.paths) set.add(p);
    }
    const subscriptions = [...bySlug.entries()]
      .map(([slug, paths]) => ({ workspaceSlug: slug, paths: [...paths].sort() }))
      .sort((a, b) => a.workspaceSlug.localeCompare(b.workspaceSlug));

    const serialized = JSON.stringify({ type: 'WATCH_SUBSCRIBE', payload: { subscriptions } });
    if (!force && serialized === lastWatchSentRef.current) return;

    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(serialized);
    lastWatchSentRef.current = serialized;
  }, []);

  const scheduleWatchFlush = useCallback(() => {
    clearTimeout(watchFlushTimer.current);
    watchFlushTimer.current = setTimeout(() => flushWatchPaths(), WATCH_FLUSH_DEBOUNCE_MS);
  }, [flushWatchPaths]);

  useEffect(() => {
    let disposed = false;

    function connect() {
      if (disposed) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/events`);
      wsRef.current = ws;

      // Deltas broadcast while the socket was down are gone for good, so
      // consumers holding derived state re-seed from their snapshot endpoints
      // on every (re)connect.
      ws.onopen = () => {
        lastWatchSentRef.current = null;
        flushWatchPaths(true);
        for (const cb of connectSubscribersRef.current) cb();
      };

      ws.onmessage = (event) => {
        let msg: { type: string; payload: unknown };
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (!msg.type || !msg.payload) return;

        // Filter file changes by workspace
        if (
          msg.type === 'FILE_CHANGE' &&
          (msg.payload as FileChangePayload).workspaceSlug !== workspaceSlug
        ) {
          return;
        }

        const callbacks = subscribersRef.current.get(msg.type);
        if (!callbacks) return;
        for (const cb of callbacks) {
          cb(msg.payload as ServerEventMap[ServerEventType]);
        }
      };

      ws.onclose = () => {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        wsRef.current = null;
        if (!disposed) {
          reconnectTimer.current = setTimeout(connect, 3000);
        }
      };
    }

    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer.current);
      clearTimeout(watchFlushTimer.current);
      const ws = wsRef.current;
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.close();
        wsRef.current = null;
      }
    };
  }, [workspaceSlug, flushWatchPaths]);

  const contextValue = useMemo<EventsContextValue>(
    () => ({
      subscribe: (type, cb) => {
        let set = subscribersRef.current.get(type);
        if (!set) {
          set = new Set();
          subscribersRef.current.set(type, set);
        }
        set.add(cb as EventCallback<ServerEventType>);
        return () => {
          set!.delete(cb as EventCallback<ServerEventType>);
        };
      },
      subscribeConnect: (cb) => {
        connectSubscribersRef.current.add(cb);
        return () => {
          connectSubscribersRef.current.delete(cb);
        };
      },
      setWatchPaths: (key, slug, paths) => {
        watchRegistryRef.current.set(key, { workspaceSlug: slug, paths });
        scheduleWatchFlush();
      },
      clearWatchPaths: (key) => {
        watchRegistryRef.current.delete(key);
        scheduleWatchFlush();
      },
    }),
    [scheduleWatchFlush],
  );

  return <EventsContext.Provider value={contextValue}>{children}</EventsContext.Provider>;
}

// ── Hooks ───────────────────────────────────────────────────────────

export function useOnServerEvent<T extends ServerEventType>(
  type: T,
  callback: EventCallback<T>,
): void {
  const ctx = useContext(EventsContext);
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!ctx) return;

    const stable: EventCallback<T> = (payload) => {
      callbackRef.current(payload);
    };

    return ctx.subscribe(type, stable);
  }, [ctx, type]);
}

/** Fires whenever the events WebSocket (re)connects — the signal to re-seed
 * snapshot-derived state, since deltas broadcast while disconnected are lost. */
export function useOnEventsConnect(callback: () => void): void {
  const ctx = useContext(EventsContext);
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!ctx) return;
    return ctx.subscribeConnect(() => callbackRef.current());
  }, [ctx]);
}

/** Declare the absolute paths this surface is displaying. While mounted, the
 * daemon watches them (and only subscribed paths) for FILE_CHANGE events. */
export function useWatchPaths(workspaceSlug: string, paths: string[]): void {
  const ctx = useContext(EventsContext);
  const keyRef = useRef<symbol | null>(null);
  if (keyRef.current === null) keyRef.current = Symbol('watch-paths');

  // Keyed on content, not array identity, so callers can pass inline arrays.
  // NUL delimiter — the only byte that cannot appear in a filesystem path.
  const pathsKey = paths.join('\0');

  useEffect(() => {
    if (!ctx) return;
    const key = keyRef.current!;
    ctx.setWatchPaths(key, workspaceSlug, pathsKey === '' ? [] : pathsKey.split('\0'));
    return () => ctx.clearWatchPaths(key);
  }, [ctx, workspaceSlug, pathsKey]);
}

// ── Backward Compatibility ──────────────────────────────────────────

type FileChangeCallback = (filePath: string, eventType: FileChangeEventType) => void;

export function useOnFileChange(callback: FileChangeCallback): void {
  useOnServerEvent('FILE_CHANGE', (payload) => {
    callback(payload.path, payload.eventType);
  });
}
