"use client";

import dynamic from "next/dynamic";
import { useState, useCallback, useEffect, useRef } from "react";
import { RiTerminalLine } from "@remixicon/react";
import { TerminalTabBar } from "./terminal-tab-bar";
import type { TerminalTab, TerminalScope } from "./types";
import type { TerminalActions } from "./terminal";

interface InjectEvent {
  context: string;
  terminalId?: string;
}

// Lazy-load the terminal instance (no SSR — xterm uses browser APIs)
const TerminalInstance = dynamic(
  () => import('./terminal').then((m) => m.TerminalInstance),
  { ssr: false },
);

interface TerminalManagerProps {
  onCollapse: () => void;
  defaultScope?: TerminalScope;
}

interface SessionListItem {
  sessionId: string;
  scopeType: string;
  scopeLabel: string;
  workingDir: string;
  command?: string;
}

export function TerminalManager({ onCollapse, defaultScope }: TerminalManagerProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Store WS refs per tab for inject + kill — keyed by sessionId
  const tabWsRefs = useRef<Map<string, TerminalActions>>(new Map());

  // Restore sessions from server on mount
  useEffect(() => {
    if (!defaultScope?.workingDir) {
      setLoading(false);
      return;
    }

    const params = new URLSearchParams({
      scopeType: defaultScope.scopeType,
      scopeLabel: defaultScope.scopeLabel,
    });

    fetch(`/api/terminal/sessions?${params}`)
      .then((res) => res.json())
      .then((data: { sessions: SessionListItem[] }) => {
        if (data.sessions.length > 0) {
          const restored: TerminalTab[] = data.sessions.map((s) => ({
            sessionId: s.sessionId,
            scope: {
              scopeType: s.scopeType as TerminalScope['scopeType'],
              scopeLabel: s.scopeLabel,
              workingDir: s.workingDir,
              command: s.command,
            },
            status: 'connecting' as const,
          }));
          setTabs(restored);
          setActiveTabId(restored[0].sessionId);
        }
      })
      .catch(() => {}) // Silently fail — show empty state
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  const openTerminal = useCallback((scope?: TerminalScope) => {
    const finalScope = scope ?? defaultScope;
    if (!finalScope) return;

    const sessionId = crypto.randomUUID();
    const newTab: TerminalTab = {
      sessionId,
      scope: finalScope,
      status: 'connecting',
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(sessionId);
  }, [defaultScope]);

  const closeTerminal = useCallback((sessionId: string) => {
    // Send kill to server+daemon before removing tab
    tabWsRefs.current.get(sessionId)?.kill();

    setTabs((prev) => {
      const remaining = prev.filter((t) => t.sessionId !== sessionId);
      setActiveTabId((active) => {
        if (active !== sessionId) return active;
        return remaining.length > 0 ? remaining[remaining.length - 1].sessionId : null;
      });
      return remaining;
    });
    tabWsRefs.current.delete(sessionId);
  }, []);

  const handleStatusChange = useCallback(
    (sessionId: string, status: TerminalTab['status']) => {
      setTabs((prev) =>
        prev.map((t) => (t.sessionId === sessionId ? { ...t, status } : t)),
      );
    },
    [],
  );

  const handleReady = useCallback(
    (sessionId: string, actions: TerminalActions | null) => {
      if (actions) {
        tabWsRefs.current.set(sessionId, actions);
      } else {
        tabWsRefs.current.delete(sessionId);
      }
    },
    [],
  );

  // Listen for terminal:inject custom events
  useEffect(() => {
    function onInject(e: Event) {
      const { context, terminalId } = (e as CustomEvent<InjectEvent>).detail;

      const targetId = terminalId ?? activeTabId;
      if (!targetId) return;

      const handler = tabWsRefs.current.get(targetId);
      handler?.write(context);
    }

    window.addEventListener('terminal:inject', onInject);
    return () => window.removeEventListener('terminal:inject', onInject);
  }, [activeTabId]);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center">
        <p className="text-xs text-muted-foreground">Loading terminals...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <TerminalTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={setActiveTabId}
        onClose={closeTerminal}
        onAdd={() => openTerminal()}
        onCollapse={onCollapse}
      />
      {tabs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="text-xs text-muted-foreground">No terminals open</p>
          <button
            onClick={() => openTerminal()}
            className="flex items-center gap-1.5 border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted"
          >
            <RiTerminalLine className="size-3" />
            Open Terminal
          </button>
        </div>
      ) : (
        <div className="relative flex-1 min-h-0">
          {tabs.map((tab) => (
            <TerminalInstance
              key={tab.sessionId}
              tab={tab}
              visible={tab.sessionId === activeTabId}
              onStatusChange={handleStatusChange}
              onReady={handleReady}
            />
          ))}
        </div>
      )}
    </div>
  );
}
