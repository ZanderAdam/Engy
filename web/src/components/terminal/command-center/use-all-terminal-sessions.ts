'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOnServerEvent } from '@/contexts/events-context';
import type { CommandCenterSession } from './types';

interface UseAllTerminalSessionsResult {
  sessions: CommandCenterSession[];
  loading: boolean;
  error: string | null;
  retry: () => void;
}

const REFETCH_DEBOUNCE_MS = 150;

// Only these actions change which sessions exist; attached/detached fire on
// every command-center selection switch (the live pane re-attaches) and would
// otherwise refetch the whole list for no structural change.
const STRUCTURAL_ACTIONS = new Set(['created', 'destroyed', 'renamed']);

/**
 * Live, cross-project list of every active terminal for the command center.
 *
 * Source of truth is the server's global session registry, fetched via
 * `?all=1`. Structural changes (created/destroyed/renamed) trigger a debounced
 * refetch so the list stays authoritative without racing partial payloads.
 * High-frequency activity deltas update the matching session's `activityState`
 * in place — the daemon tracks activity for every session, so dots stay live
 * even for terminals nobody is currently viewing.
 */
export function useAllTerminalSessions(): UseAllTerminalSessionsResult {
  const [sessions, setSessions] = useState<CommandCenterSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchAll = useCallback(() => {
    // Abort any in-flight request so a slow earlier response can't overwrite a
    // newer one (or a fresher in-place activity update) after it resolves.
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    fetch('/api/terminal/sessions?all=1', { signal: ctrl.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to list terminals: ${res.status}`);
        return res.json();
      })
      .then((data: { sessions: CommandCenterSession[] }) => {
        setSessions(data.sessions);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('Failed to load command center terminals:', err);
        setError('Failed to load terminals.');
        setLoading(false);
      });
  }, []);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(fetchAll, REFETCH_DEBOUNCE_MS);
  }, [fetchAll]);

  useEffect(() => {
    fetchAll();
    return () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      abortRef.current?.abort();
    };
  }, [fetchAll]);

  const onSessionsChange = useCallback(
    (payload: { action: string }) => {
      if (STRUCTURAL_ACTIONS.has(payload.action)) scheduleRefetch();
    },
    [scheduleRefetch],
  );
  useOnServerEvent('TERMINAL_SESSIONS_CHANGE', onSessionsChange);

  const onActivityChange = useCallback(
    (payload: { sessionId: string; state?: CommandCenterSession['activityState']; removed?: boolean }) => {
      if (payload.removed) {
        setSessions((prev) => prev.filter((s) => s.sessionId !== payload.sessionId));
        return;
      }
      if (!payload.state) return;
      const next = payload.state;
      setSessions((prev) =>
        prev.map((s) => (s.sessionId === payload.sessionId ? { ...s, activityState: next } : s)),
      );
    },
    [],
  );
  useOnServerEvent('TERMINAL_ACTIVITY_CHANGE', onActivityChange);

  return { sessions, loading, error, retry: fetchAll };
}
