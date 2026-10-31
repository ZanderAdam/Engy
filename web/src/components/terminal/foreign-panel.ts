import { sessionToTab, type SessionListItem } from './session-to-tab';
import type { TerminalActivityState, TerminalTab } from './types';

export function foreignTab(session: SessionListItem, fallbackGroupKey: string): TerminalTab {
  return { ...sessionToTab(session, fallbackGroupKey), foreign: true };
}

export function tabsForRail(tabs: TerminalTab[], hiddenSessionId?: string): TerminalTab[] {
  return tabs.filter((tab) => !tab.foreign && tab.sessionId !== hiddenSessionId);
}

export function staleForeignId(
  tabs: Iterable<TerminalTab>,
  pinnedSessionId: string | undefined,
): string | null {
  for (const tab of tabs) {
    if (tab.foreign && tab.sessionId !== pinnedSessionId) return tab.sessionId;
  }
  return null;
}

interface PanelSessionState {
  tabs: Map<string, TerminalTab>;
  actions: Map<string, { kill: () => void }>;
  discardDormant: (sessionId: string) => void;
}

export function releasePanelSession(sessionId: string, state: PanelSessionState): void {
  const tab = state.tabs.get(sessionId);
  if (!tab?.foreign) {
    // A dormant tab holds no socket, so no kill reaches the server, which would
    // list the session again on the next load.
    if (tab?.status === 'dormant') state.discardDormant(sessionId);
    state.actions.get(sessionId)?.kill();
  }
  state.tabs.delete(sessionId);
  state.actions.delete(sessionId);
}

export function planPinnedOpen(params: {
  global: boolean;
  sessionGroupKey: string | undefined;
  dockGroupKey: string | undefined;
  hasPanel: boolean;
}): 'focus' | 'attach' {
  const ownsSession = params.global || params.sessionGroupKey === params.dockGroupKey;
  return params.hasPanel || ownsSession ? 'focus' : 'attach';
}

export function shouldHandleSessionChange(params: {
  global: boolean;
  payloadGroupKey: string | undefined;
  dockGroupKey: string;
  known: boolean;
}): boolean {
  if (params.global || params.known || !params.payloadGroupKey) return true;
  return params.payloadGroupKey === params.dockGroupKey;
}

export function injectFallbackPanelId(
  activePanelId: string | undefined,
  tabs: Map<string, TerminalTab>,
): string | undefined {
  if (activePanelId === undefined || tabs.get(activePanelId)?.foreign) return undefined;
  return activePanelId;
}

export function closeNeedsConfirm(tab: TerminalTab): boolean {
  return !tab.foreign;
}

export function tabWithPinnedState(
  tab: TerminalTab,
  session: { activityState?: string; needsAttention?: boolean },
): TerminalTab | null {
  const activityState = (session.activityState ?? 'idle') as TerminalActivityState;
  const needsAttention = session.needsAttention;
  if (tab.activityState === activityState && tab.needsAttention === needsAttention) return null;
  return { ...tab, activityState, needsAttention };
}
