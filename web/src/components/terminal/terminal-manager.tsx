"use client";

import { useCallback, useEffect, useRef, useMemo } from "react";
import { DockviewReact, type DockviewApi, type SerializedDockview } from "dockview";
import type { TerminalActions } from "./terminal";
import type { TerminalTab, TerminalScope, TerminalPanelParams, SplitPosition, TerminalDropdownGroup } from "./types";
import { TerminalDockContext, type TerminalDockContextValue } from "./terminal-dock-context";
import { TerminalDockPanel } from "./terminal-dock-panel";
import { TerminalDockTab } from "./terminal-dock-tab";
import { TerminalDockWatermark } from "./terminal-dock-watermark";
import { TerminalDockActions } from "./terminal-dock-actions";

interface InjectEvent {
  context: string;
  terminalId?: string;
}

interface OpenEvent {
  scope: TerminalScope;
}

interface TerminalManagerProps {
  onCollapse: () => void;
  defaultScope?: TerminalScope;
  extraDropdownGroups?: TerminalDropdownGroup[];
}

interface SessionListItem {
  sessionId: string;
  scopeType: string;
  scopeLabel: string;
  workingDir: string;
  command?: string;
}

const ENGY_THEME = {
  name: 'engy',
  className: 'dockview-theme-engy',
};

const COMPONENTS = { terminal: TerminalDockPanel };
const TAB_COMPONENTS = { 'terminal-tab': TerminalDockTab };

function getLayoutKey(scope: TerminalScope): string {
  return `terminal-layout:${scope.scopeType}:${scope.scopeLabel}`;
}

function saveLayout(api: DockviewApi, scope: TerminalScope): void {
  try {
    const json = api.toJSON();
    localStorage.setItem(getLayoutKey(scope), JSON.stringify(json));
  } catch {
    // localStorage may be full or unavailable
  }
}

function loadLayout(scope: TerminalScope): SerializedDockview | null {
  try {
    const raw = localStorage.getItem(getLayoutKey(scope));
    if (!raw) return null;
    return JSON.parse(raw) as SerializedDockview;
  } catch {
    return null;
  }
}

function clearLayout(scope: TerminalScope): void {
  try {
    localStorage.removeItem(getLayoutKey(scope));
  } catch {
    // ignore
  }
}

function sessionToTab(s: SessionListItem): TerminalTab {
  return {
    sessionId: s.sessionId,
    scope: {
      scopeType: s.scopeType as TerminalScope['scopeType'],
      scopeLabel: s.scopeLabel,
      workingDir: s.workingDir,
      command: s.command,
    },
    status: 'connecting',
  };
}

export function TerminalManager({ onCollapse, defaultScope, extraDropdownGroups }: TerminalManagerProps) {
  const tabsRef = useRef<Map<string, TerminalTab>>(new Map());
  const tabWsRefs = useRef<Map<string, TerminalActions>>(new Map());
  const dockviewApiRef = useRef<DockviewApi | null>(null);
  const restoringRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const defaultScopeRef = useRef(defaultScope);
  useEffect(() => {
    defaultScopeRef.current = defaultScope;
  }, [defaultScope]);

  const openTerminal = useCallback((scope?: TerminalScope, position?: SplitPosition) => {
    const finalScope = scope ?? defaultScopeRef.current;
    if (!finalScope) return;

    const api = dockviewApiRef.current;
    if (!api) return;

    const sessionId = crypto.randomUUID();
    const newTab: TerminalTab = {
      sessionId,
      scope: finalScope,
      status: 'connecting',
    };
    tabsRef.current.set(sessionId, newTab);

    api.addPanel({
      id: sessionId,
      component: 'terminal',
      tabComponent: 'terminal-tab',
      title: finalScope.scopeLabel,
      params: { tab: newTab } satisfies TerminalPanelParams,
      renderer: 'always',
      ...(position && { position }),
    });
  }, []);

  const cleanupTerminal = useCallback((sessionId: string) => {
    tabWsRefs.current.get(sessionId)?.kill();
    tabsRef.current.delete(sessionId);
    tabWsRefs.current.delete(sessionId);
  }, []);

  const broadcastActive = useCallback(() => {
    const api = dockviewApiRef.current;
    const activeId = api?.activePanel?.id;
    const tab = activeId != null ? tabsRef.current.get(activeId) : undefined;
    const hasActiveTab = tab != null && tab.status !== 'exited';
    window.__engy_terminal_active = hasActiveTab;
    window.dispatchEvent(
      new CustomEvent('terminal:active-changed', { detail: { hasActiveTab } }),
    );
  }, []);

  const handleStatusChange = useCallback(
    (sessionId: string, status: TerminalTab['status']) => {
      const existing = tabsRef.current.get(sessionId);
      if (!existing) return;
      const updated = { ...existing, status };
      tabsRef.current.set(sessionId, updated);

      const api = dockviewApiRef.current;
      const panel = api?.getPanel(sessionId);
      panel?.api.updateParameters({ tab: updated } satisfies TerminalPanelParams);

      if (status === 'exited') broadcastActive();
    },
    [broadcastActive],
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

  useEffect(() => {
    return () => {
      window.__engy_terminal_active = false;
      window.dispatchEvent(
        new CustomEvent('terminal:active-changed', { detail: { hasActiveTab: false } }),
      );
    };
  }, []);

  useEffect(() => {
    function onInject(e: Event) {
      const { context, terminalId } = (e as CustomEvent<InjectEvent>).detail;
      const api = dockviewApiRef.current;
      const targetId = terminalId ?? api?.activePanel?.id;
      if (!targetId) return;

      const handler = tabWsRefs.current.get(targetId);
      handler?.write(context);
    }

    window.addEventListener('terminal:inject', onInject);
    return () => window.removeEventListener('terminal:inject', onInject);
  }, []);

  useEffect(() => {
    function onOpen(e: Event) {
      const { scope } = (e as CustomEvent<OpenEvent>).detail;
      openTerminal(scope);
    }

    window.addEventListener('terminal:open', onOpen);
    return () => window.removeEventListener('terminal:open', onOpen);
  }, [openTerminal]);

  const scheduleLayoutSave = useCallback(() => {
    if (restoringRef.current) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const api = dockviewApiRef.current;
      const scope = defaultScopeRef.current;
      if (!api || !scope) return;

      if (api.panels.length === 0) {
        clearLayout(scope);
      } else {
        saveLayout(api, scope);
      }
    }, 200);
  }, []);

  const handleDockviewReady = useCallback(
    (event: { api: DockviewApi }) => {
      const api = event.api;
      dockviewApiRef.current = api;

      api.onDidActivePanelChange(() => broadcastActive());
      api.onDidRemovePanel((panel) => {
        cleanupTerminal(panel.id);
        broadcastActive();
        scheduleLayoutSave();
      });
      api.onDidAddPanel(() => scheduleLayoutSave());
      api.onDidMovePanel(() => scheduleLayoutSave());
      api.onDidAddGroup(() => scheduleLayoutSave());
      api.onDidRemoveGroup(() => scheduleLayoutSave());

      if (!defaultScopeRef.current?.workingDir) {
        return;
      }

      const params = new URLSearchParams({
        scopeType: defaultScopeRef.current.scopeType,
        scopeLabel: defaultScopeRef.current.scopeLabel,
      });

      fetch(`/api/terminal/sessions?${params}`)
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`);
          return res.json();
        })
        .then((data: { sessions: SessionListItem[] }) => {
          const activeSessions = new Set(data.sessions.map((s) => s.sessionId));
          const sessionMap = new Map(data.sessions.map((s) => [s.sessionId, s]));

          const savedLayout = loadLayout(defaultScopeRef.current!);
          if (savedLayout) {
            const savedPanelIds = Object.keys(savedLayout.panels);
            const allAlive = savedPanelIds.length > 0
              && savedPanelIds.every((id) => activeSessions.has(id));

            if (allAlive) {
              for (const [id, panel] of Object.entries(savedLayout.panels)) {
                const tab = sessionToTab(sessionMap.get(id)!);
                tabsRef.current.set(id, tab);
                panel.params = { tab } satisfies TerminalPanelParams;
              }

              try {
                restoringRef.current = true;
                api.fromJSON(savedLayout);
                restoringRef.current = false;

                const restoredIds = new Set(savedPanelIds);
                for (const s of data.sessions) {
                  if (!restoredIds.has(s.sessionId)) {
                    const tab = sessionToTab(s);
                    tabsRef.current.set(s.sessionId, tab);
                    api.addPanel({
                      id: s.sessionId,
                      component: 'terminal',
                      tabComponent: 'terminal-tab',
                      title: s.scopeLabel,
                      params: { tab } satisfies TerminalPanelParams,
                      renderer: 'always',
                    });
                  }
                }

                scheduleLayoutSave();
                return;
              } catch (err) {
                restoringRef.current = false;
                console.error('Failed to restore terminal layout:', err);
                tabsRef.current.clear();
              }
            } else {
              clearLayout(defaultScopeRef.current!);
            }
          }

          for (const s of data.sessions) {
            const tab = sessionToTab(s);
            tabsRef.current.set(s.sessionId, tab);
            api.addPanel({
              id: s.sessionId,
              component: 'terminal',
              tabComponent: 'terminal-tab',
              title: s.scopeLabel,
              params: { tab } satisfies TerminalPanelParams,
              renderer: 'always',
            });
          }
        })
        .catch((err: unknown) => console.error('Failed to restore terminal sessions:', err));
    },
    [broadcastActive, cleanupTerminal, scheduleLayoutSave],
  );

  const contextValue = useMemo<TerminalDockContextValue>(
    () => ({
      openTerminal,
      handleStatusChange,
      handleReady,
      onCollapse,
      extraDropdownGroups,
    }),
    [openTerminal, handleStatusChange, handleReady, onCollapse, extraDropdownGroups],
  );

  return (
    <TerminalDockContext.Provider value={contextValue}>
      <DockviewReact
        className="flex-1 min-h-0"
        theme={ENGY_THEME}
        components={COMPONENTS}
        tabComponents={TAB_COMPONENTS}
        watermarkComponent={TerminalDockWatermark}
        rightHeaderActionsComponent={TerminalDockActions}
        onReady={handleDockviewReady}
        disableFloatingGroups
        defaultRenderer="always"
      />
    </TerminalDockContext.Provider>
  );
}
