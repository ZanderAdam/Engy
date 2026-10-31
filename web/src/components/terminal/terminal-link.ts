import type { TerminalDropdownGroup, TerminalScope } from './types';

export const TERMINAL_PARAM = 'terminal';

interface TerminalLinkLocation {
  workspaceSlug: string;
  projectSlug?: string;
  worktreeBranch?: string;
}

interface ResolvedTerminalLink extends TerminalLinkLocation {
  status: 'live' | 'dormant' | 'closed';
  shell?: boolean;
}

export type TerminalDock = 'terminal' | 'shell';

export interface TerminalRevealEvent {
  sessionId: string;
  dock: TerminalDock;
  tabId?: string;
}

type TerminalLinkAction =
  | { kind: 'wait' }
  | { kind: 'not-found' }
  | { kind: 'closed'; resumeScope?: TerminalScope }
  | { kind: 'focus'; dock: TerminalDock };

interface TerminalLinkActionInput {
  target: ResolvedTerminalLink | null | undefined;
  sessionId: string;
  resumeGroup: TerminalDropdownGroup | undefined;
  resumeGroupReady: boolean;
}

export function decodeSessionId(segment: string): string | null {
  try {
    return decodeURIComponent(segment) || null;
  } catch {
    return null;
  }
}

export function decideTerminalLinkAction({
  target,
  sessionId,
  resumeGroup,
  resumeGroupReady,
}: TerminalLinkActionInput): TerminalLinkAction {
  if (!target) return { kind: 'not-found' };
  if (target.status !== 'closed') return { kind: 'focus', dock: target.shell ? 'shell' : 'terminal' };
  if (!resumeGroupReady) return { kind: 'wait' };
  return { kind: 'closed', resumeScope: findResumeScope(resumeGroup, sessionId) };
}

export function buildTerminalPageUrl(location: TerminalLinkLocation, sessionId: string): string {
  const base = location.projectSlug
    ? `/w/${location.workspaceSlug}/projects/${location.projectSlug}`
    : `/w/${location.workspaceSlug}`;
  const params = new URLSearchParams({ [TERMINAL_PARAM]: sessionId });
  if (location.worktreeBranch) params.set('wt', location.worktreeBranch);
  return `${base}?${params.toString()}`;
}

export function findResumeScope(
  group: TerminalDropdownGroup | undefined,
  sessionId: string,
): TerminalScope | undefined {
  const targetId = `resume:${sessionId}`;
  for (const dir of group?.entries ?? []) {
    const leaf = dir.children?.find((entry) => entry.id === targetId);
    if (leaf?.scope) return leaf.scope;
  }
  return undefined;
}
