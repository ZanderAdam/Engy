"use client";

import { useCallback, useEffect, useRef, useMemo } from "react";
import { DockviewReact, type DockviewApi, type SerializedDockview } from "dockview";
import type { TerminalActions } from "./terminal";
import type { ActivityEvent, TerminalActivityState, TerminalTab, TerminalScope, TerminalPanelParams, SplitPosition, TerminalDropdownGroup } from "./types";
import { TerminalDockContext, type TerminalDockContextValue } from "./terminal-dock-context";
import { TerminalDockPanel } from "./terminal-dock-panel";
import { TerminalDockTab } from "./terminal-dock-tab";
import { TerminalDockWatermark } from "./terminal-dock-watermark";
import { TerminalDockActions } from "./terminal-dock-actions";
import { useOnServerEvent } from "@/contexts/events-context";

interface InjectEvent {
  context: string;
  terminalId?: string;
}

interface OpenEvent {
  scope: TerminalScope;
}

interface TerminalFocusEvent {
  sessionId: string;
}

interface TerminalManagerProps {
  onCollapse: () => void;
  defaultScope?: TerminalScope;
  extraDropdownGroups?: TerminalDropdownGroup[];
  containerEnabled?: boolean;
  disableExternalEvents?: boolean;
}

interface SessionListItem {
  sessionId: string;
  scopeType: string;
  scopeLabel: string;
  workingDir: string;
  command?: string;
  groupKey?: string;
  workspaceSlug?: string;
  taskId?: number;
  status: 'active' | 'suspended';
  browserCount: number;
}

const ENGY_THEME = {
  name: 'engy',
  className: 'dockview-theme-engy',
};

const COMPONENTS = { terminal: TerminalDockPanel };
const TAB_COMPONENTS = { 'terminal-tab': TerminalDockTab };

function getLayoutKey(scope: TerminalScope): string {
  return `terminal-layout:${scope.groupKey}`;
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

function sessionToTab(s: SessionListItem, fallbackGroupKey: string): TerminalTab {
  return {
    sessionId: s.sessionId,
    scope: {
      scopeType: s.scopeType as TerminalScope['scopeType'],
      scopeLabel: s.scopeLabel,
      workingDir: s.workingDir,
      command: s.command,
      groupKey: s.groupKey ?? fallbackGroupKey,
      workspaceSlug: s.workspaceSlug ?? '',
      taskId: s.taskId,
    },
    status: 'connecting',
  };
}

export function TerminalManager({ onCollapse, defaultScope, extraDropdownGroups, containerEnabled, disableExternalEvents = false }: TerminalManagerProps) {
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
    if (disableExternalEvents) return;
    const api = dockviewApiRef.current;
    const activeId = api?.activePanel?.id;
    const tab = activeId != null ? tabsRef.current.get(activeId) : undefined;
    const hasActiveTab = tab != null && tab.status !== 'exited';
    window.__engy_terminal_active = hasActiveTab;
    window.dispatchEvent(
      new CustomEvent('terminal:active-changed', { detail: { hasActiveTab } }),
    );
  }, [disableExternalEvents]);

  const dispatchActivityEvent = useCallback((sessionId: string, activityState: TerminalActivityState) => {
    if (disableExternalEvents) return;
    window.dispatchEvent(
      new CustomEvent('terminal:activity-changed', { detail: { sessionId, activityState } }),
    );
  }, [disableExternalEvents]);

  const handleStatusChange = useCallback(
    (sessionId: string, status: TerminalTab['status']) => {
      const existing = tabsRef.current.get(sessionId);
      if (!existing) return;
      const updated = { ...existing, status, activityState: status === 'exited' ? 'idle' as const : existing.activityState };
      tabsRef.current.set(sessionId, updated);

      const api = dockviewApiRef.current;
      const panel = api?.getPanel(sessionId);
      panel?.api.updateParameters({ tab: updated } satisfies TerminalPanelParams);

      if (status === 'exited') {
        dispatchActivityEvent(sessionId, 'idle');
        broadcastActive();
      }
    },
    [broadcastActive, dispatchActivityEvent],
  );

  const handleActivity = useCallback(
    (sessionId: string, event: ActivityEvent) => {
      const existing = tabsRef.current.get(sessionId);
      if (!existing) return;

      const activityState: TerminalActivityState = event === 'start' ? 'active' : event;
      if (existing.activityState === activityState) return;

      const updated = { ...existing, activityState };
      tabsRef.current.set(sessionId, updated);

      const api = dockviewApiRef.current;
      const panel = api?.getPanel(sessionId);
      panel?.api.updateParameters({ tab: updated } satisfies TerminalPanelParams);

      dispatchActivityEvent(sessionId, activityState);
    },
    [dispatchActivityEvent],
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
    if (disableExternalEvents) return;
    return () => {
      window.__engy_terminal_active = false;
      window.dispatchEvent(
        new CustomEvent('terminal:active-changed', { detail: { hasActiveTab: false } }),
      );
    };
  }, [disableExternalEvents]);

  useEffect(() => {
    if (disableExternalEvents) return;

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
  }, [disableExternalEvents]);

  useEffect(() => {
    if (disableExternalEvents) return;

    function onOpen(e: Event) {
      const { scope } = (e as CustomEvent<OpenEvent>).detail;
      openTerminal(scope);
    }

    window.addEventListener('terminal:open', onOpen);
    return () => window.removeEventListener('terminal:open', onOpen);
  }, [openTerminal, disableExternalEvents]);

  // terminal:focus is always listened for (not gated by disableExternalEvents)
  // because it's an intentional user action from TaskTerminalButton, not a broadcast
  useEffect(() => {
    function onFocus(e: Event) {
      const { sessionId } = (e as CustomEvent<TerminalFocusEvent>).detail;
      const api = dockviewApiRef.current;
      if (!api) return;
      const panel = api.getPanel(sessionId);
      if (panel) {
        panel.api.setActive();
        // Always broadcast so the right panel expands even if the tab was already active
        broadcastActive();
      }
    }

    window.addEventListener('terminal:focus', onFocus);
    return () => window.removeEventListener('terminal:focus', onFocus);
  }, [broadcastActive]);

  // Cross-browser session sync: when another browser creates a session for this groupKey,
  // fetch updated session list and add any new sessions as tabs
  useOnServerEvent('TERMINAL_SESSIONS_CHANGE', useCallback((payload) => {
    const scope = defaultScopeRef.current;
    if (!scope) return;
    // Only react to events for our groupKey
    if (payload.groupKey && payload.groupKey !== scope.groupKey) return;

    const api = dockviewApiRef.current;
    if (!api) return;

    if (payload.action === 'created') {
      // Skip if we already know this session (e.g. we created it ourselves)
      if (tabsRef.current.has(payload.sessionId)) return;

      // Fetch session details and add as a new tab
      const params = new URLSearchParams({
        groupKey: scope.groupKey,
        scopeType: scope.scopeType,
        scopeLabel: scope.scopeLabel,
      });
      fetch(`/api/terminal/sessions?${params}`)
        .then((res) => res.json())
        .then((data: { sessions: SessionListItem[] }) => {
          for (const s of data.sessions) {
            if (!tabsRef.current.has(s.sessionId)) {
              const tab = sessionToTab(s, scope.groupKey);
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
        })
        .catch((err: unknown) => console.error('Failed to sync terminal sessions:', err));
    }
    // 'destroyed' is handled by the terminal WS exit/error events
    // 'attached'/'detached' are informational — no action needed
  }, []));

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

      api.onDidActivePanelChange(() => {
        broadcastActive();
        scheduleLayoutSave();
      });
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
        groupKey: defaultScopeRef.current.groupKey,
        scopeType: defaultScopeRef.current.scopeType,
        scopeLabel: defaultScopeRef.current.scopeLabel,
      });

      fetch(`/api/terminal/sessions?${params}`)
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`);
          return res.json();
        })
        .then((data: { sessions: SessionListItem[] }) => {
          const fallbackGroupKey = defaultScopeRef.current!.groupKey;
          const activeSessions = new Set(data.sessions.map((s) => s.sessionId));
          const sessionMap = new Map(data.sessions.map((s) => [s.sessionId, s]));

          const savedLayout = loadLayout(defaultScopeRef.current!);
          if (savedLayout) {
            const savedPanelIds = Object.keys(savedLayout.panels);
            const allAlive = savedPanelIds.length > 0
              && savedPanelIds.every((id) => activeSessions.has(id));

            if (allAlive) {
              for (const [id, panel] of Object.entries(savedLayout.panels)) {
                const tab = sessionToTab(sessionMap.get(id)!, fallbackGroupKey);
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
                    const tab = sessionToTab(s, fallbackGroupKey);
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
            const tab = sessionToTab(s, fallbackGroupKey);
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
      handleActivity,
      handleReady,
      onCollapse,
      extraDropdownGroups,
      containerEnabled,
      defaultScope,
    }),
    [openTerminal, handleStatusChange, handleActivity, handleReady, onCollapse, extraDropdownGroups, containerEnabled, defaultScope],
  );

  const dockviewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = dockviewRef.current;
    if (!container) return;

    const tabsContainer = container.querySelector<HTMLElement>('.dv-tabs-container');
    if (!tabsContainer) return;

    function onWheel(e: WheelEvent) {
      if (e.deltaY === 0) return;
      e.preventDefault();
      tabsContainer!.scrollLeft += e.deltaY;
    }

    tabsContainer.addEventListener('wheel', onWheel, { passive: false });
    return () => tabsContainer.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <TerminalDockContext.Provider value={contextValue}>
      <DockviewReact
        ref={dockviewRef}
        className="flex-1 min-h-0"
        theme={ENGY_THEME}
        components={COMPONENTS}
        tabComponents={TAB_COMPONENTS}
        watermarkComponent={TerminalDockWatermark}
        rightHeaderActionsComponent={TerminalDockActions}
        onReady={handleDockviewReady}
        disableFloatingGroups
        defaultRenderer="always"
        scrollbars="native"
      />
    </TerminalDockContext.Provider>
  );
}
