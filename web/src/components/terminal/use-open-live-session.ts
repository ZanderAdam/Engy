'use client';

import {
  useVirtualNavigate,
  useVirtualParams,
  useVirtualSearchParams,
} from '@/components/tabs/tab-context';
import { trpc } from '@/lib/trpc';
import { normalizeWtParam, worktreeFromGroupKey } from './group-key';
import { useSendToTerminal } from './use-send-to-terminal';

interface LiveSessionTarget {
  sessionId: string;
  groupKey: string | null;
  workspaceSlug: string | null;
  projectSlug: string | null;
}

interface CurrentPage {
  workspaceSlug: string | undefined;
  projectSlug: string | undefined;
  worktree: string | undefined;
  combinedWorktrees: boolean;
}

export function liveSessionPath(target: LiveSessionTarget): string | null {
  if (!target.workspaceSlug) return null;
  const base = target.projectSlug
    ? `/w/${target.workspaceSlug}/projects/${target.projectSlug}`
    : `/w/${target.workspaceSlug}`;
  const worktree = worktreeFromGroupKey(target.groupKey ?? undefined);
  return worktree ? `${base}?wt=${encodeURIComponent(worktree)}` : base;
}

export function isOnSessionPage(target: LiveSessionTarget, page: CurrentPage): boolean {
  if (target.workspaceSlug !== page.workspaceSlug) return false;
  if ((target.projectSlug ?? undefined) !== page.projectSlug) return false;
  if (page.combinedWorktrees) return true;
  return worktreeFromGroupKey(target.groupKey ?? undefined) === page.worktree;
}

export function useOpenLiveSession() {
  const nav = useVirtualNavigate();
  const params = useVirtualParams<{ workspace: string; project: string }>();
  const searchParams = useVirtualSearchParams();
  const { focusTerminal } = useSendToTerminal();
  const { data: workspace } = trpc.workspace.get.useQuery(
    { slug: params.workspace ?? '' },
    { enabled: !!params.workspace },
  );

  return (target: LiveSessionTarget) => {
    const page: CurrentPage = {
      workspaceSlug: params.workspace,
      projectSlug: params.project,
      worktree: normalizeWtParam(searchParams.get('wt')),
      combinedWorktrees: workspace?.combinedWorktrees ?? false,
    };
    const path = isOnSessionPage(target, page) ? null : liveSessionPath(target);
    if (path) {
      nav.push(path);
      return;
    }
    focusTerminal(target.sessionId, target.groupKey ?? undefined);
  };
}
