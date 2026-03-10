'use client';

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';

type FileChangeEventType = 'add' | 'change' | 'unlink';
type FileChangeCallback = (filePath: string, eventType: FileChangeEventType) => void;

interface FileChangeContextValue {
  subscribe: (cb: FileChangeCallback) => () => void;
}

const FileChangeContext = createContext<FileChangeContextValue | null>(null);

interface FileChangeProviderProps {
  workspaceSlug: string;
  children: ReactNode;
}

interface FileChangeMessage {
  type: 'FILE_CHANGE';
  payload: {
    workspaceSlug: string;
    path: string;
    eventType: FileChangeEventType;
  };
}

export function FileChangeProvider({ workspaceSlug, children }: FileChangeProviderProps) {
  const subscribersRef = useRef(new Set<FileChangeCallback>());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/events`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        let msg: FileChangeMessage;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (msg.type !== 'FILE_CHANGE') return;
        if (msg.payload.workspaceSlug !== workspaceSlug) return;

        for (const cb of subscribersRef.current) {
          cb(msg.payload.path, msg.payload.eventType);
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

  const contextValue = useMemo<FileChangeContextValue>(() => ({
    subscribe: (cb) => {
      subscribersRef.current.add(cb);
      return () => {
        subscribersRef.current.delete(cb);
      };
    },
  }), []);

  return (
    <FileChangeContext.Provider value={contextValue}>
      {children}
    </FileChangeContext.Provider>
  );
}

export function useOnFileChange(callback: FileChangeCallback): void {
  const ctx = useContext(FileChangeContext);
  const callbackRef = useRef(callback);
  useEffect(() => { callbackRef.current = callback; });

  useEffect(() => {
    if (!ctx) return;

    const stable: FileChangeCallback = (path, eventType) => {
      callbackRef.current(path, eventType);
    };

    return ctx.subscribe(stable);
  }, [ctx]);
}
