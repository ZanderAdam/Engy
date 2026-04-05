'use client';

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';

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
}

interface ServerEventMap {
  FILE_CHANGE: FileChangePayload;
  TASK_CHANGE: TaskChangePayload;
  QUESTION_CHANGE: QuestionChangePayload;
  TERMINAL_SESSIONS_CHANGE: TerminalSessionsChangePayload;
}

type ServerEventType = keyof ServerEventMap;

// ── Context ─────────────────────────────────────────────────────────

type EventCallback<T extends ServerEventType> = (payload: ServerEventMap[T]) => void;

interface EventsContextValue {
  subscribe: <T extends ServerEventType>(
    type: T,
    cb: EventCallback<T>,
  ) => () => void;
}

const EventsContext = createContext<EventsContextValue | null>(null);

// ── Provider ────────────────────────────────────────────────────────

interface EventsProviderProps {
  workspaceSlug: string;
  children: ReactNode;
}

export function EventsProvider({ workspaceSlug, children }: EventsProviderProps) {
  const subscribersRef = useRef(new Map<string, Set<EventCallback<ServerEventType>>>());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/events`);
      wsRef.current = ws;

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
        wsRef.current = null;
        reconnectTimer.current = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [workspaceSlug]);

  const contextValue = useMemo<EventsContextValue>(() => ({
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
  }), []);

  return (
    <EventsContext.Provider value={contextValue}>
      {children}
    </EventsContext.Provider>
  );
}

// ── Hooks ───────────────────────────────────────────────────────────

export function useOnServerEvent<T extends ServerEventType>(
  type: T,
  callback: EventCallback<T>,
): void {
  const ctx = useContext(EventsContext);
  const callbackRef = useRef(callback);
  useEffect(() => { callbackRef.current = callback; });

  useEffect(() => {
    if (!ctx) return;

    const stable: EventCallback<T> = (payload) => {
      callbackRef.current(payload);
    };

    return ctx.subscribe(type, stable);
  }, [ctx, type]);
}

// ── Backward Compatibility ──────────────────────────────────────────

type FileChangeCallback = (filePath: string, eventType: FileChangeEventType) => void;

export function useOnFileChange(callback: FileChangeCallback): void {
  useOnServerEvent('FILE_CHANGE', (payload) => {
    callback(payload.path, payload.eventType);
  });
}
