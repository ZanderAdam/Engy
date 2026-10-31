import type { AppState } from '../trpc/context';
import { parseGroupKey } from '@/components/terminal/group-key';
import { getHistoryRow } from './terminal-session-history';

interface TerminalLinkTarget {
  status: 'live' | 'dormant' | 'closed';
  workspaceSlug: string;
  projectSlug?: string;
  worktreeBranch?: string;
  shell?: true;
}

interface TerminalLocation {
  workspaceSlug?: string | null;
  projectSlug?: string | null;
  worktreeBranch?: string | null;
}

function toTarget(
  status: TerminalLinkTarget['status'],
  location: TerminalLocation,
): TerminalLinkTarget | null {
  if (!location.workspaceSlug) return null;
  return {
    status,
    workspaceSlug: location.workspaceSlug,
    ...(location.projectSlug ? { projectSlug: location.projectSlug } : {}),
    ...(location.worktreeBranch ? { worktreeBranch: location.worktreeBranch } : {}),
  };
}

export function resolveTerminalLinkTarget(
  state: Pick<AppState, 'terminalSessionMeta'>,
  sessionId: string,
): TerminalLinkTarget | null {
  const meta = state.terminalSessionMeta.get(sessionId);
  if (meta) {
    const status = meta.dormant === true ? 'dormant' : 'live';
    const fromGroup = meta.groupKey ? parseGroupKey(meta.groupKey) : undefined;
    if (!fromGroup) return toTarget(status, meta);
    const target = toTarget(status, fromGroup);
    return target && fromGroup.shell ? { ...target, shell: true } : target;
  }

  const row = getHistoryRow(sessionId);
  return row ? toTarget('closed', row) : null;
}
