'use client';

import { useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { RiGitBranchLine, RiTerminalBoxLine } from '@remixicon/react';
import { cn } from '@/lib/utils';
import { useXtermTheme } from '@/hooks/use-xterm-theme';
import type { TerminalTab } from '../types';
import { TerminalSessionLabel } from '../terminal-session-label';
import { useAllTerminalSessions } from './use-all-terminal-sessions';
import { commandCenterSessionToTab } from './types';
import { groupTabsByProject, type CommandCenterProjectGroup } from './grouping';

// xterm only runs in the browser — defer the live instance like the dock panel.
const TerminalInstance = dynamic(
  () => import('../terminal').then((m) => m.TerminalInstance),
  { ssr: false },
);

// One place to see every active terminal across all projects and worktrees.
// Left: a grouped, live-updating list (project → worktree → terminals) whose
// activity dots follow the daemon — so a terminal nobody is viewing still shows
// what it's doing. Right: the selected terminal, rendered live and fully
// interactive. Self-contained; it never navigates the surrounding tab.
export function CommandCenter() {
  const { sessions, loading, error, retry } = useAllTerminalSessions();
  const xtermTheme = useXtermTheme();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const tabs = useMemo(() => sessions.map(commandCenterSessionToTab), [sessions]);
  const projectGroups = useMemo(() => groupTabsByProject(tabs), [tabs]);

  // Derive the effective selection during render (no setState-in-effect): honour
  // the user's pick while it stays live, otherwise fall back to the first
  // terminal so the right pane is never blank while terminals exist — and the
  // selection self-heals when the chosen terminal closes or expires.
  const selected = useMemo(() => {
    if (selectedId) {
      const match = tabs.find((t) => t.sessionId === selectedId);
      if (match) return match;
    }
    return tabs[0] ?? null;
  }, [tabs, selectedId]);

  // TerminalInstance requires onStatusChange; it manages its own xterm, so the
  // status is only surfaced in the right-pane header. Stored with its sessionId
  // so a stale status never bleeds onto a newly selected terminal.
  const [liveStatus, setLiveStatus] = useState<{
    sessionId: string;
    status: TerminalTab['status'];
  } | null>(null);
  const handleStatusChange = useCallback((sessionId: string, status: TerminalTab['status']) => {
    setLiveStatus({ sessionId, status });
  }, []);
  const selectedStatus =
    selected && liveStatus?.sessionId === selected.sessionId ? liveStatus.status : 'connecting';

  function renderRow(tab: TerminalTab) {
    const isSelected = tab.sessionId === selected?.sessionId;
    return (
      <button
        key={tab.sessionId}
        type="button"
        onClick={() => setSelectedId(tab.sessionId)}
        aria-current={isSelected || undefined}
        className={cn(
          'flex w-full items-start rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted',
          isSelected && 'bg-muted',
        )}
      >
        <TerminalSessionLabel tab={tab} iconBox />
      </button>
    );
  }

  function renderProjectGroup(group: CommandCenterProjectGroup) {
    const showWorktreeHeaders = group.worktreeGroups.length > 1;
    return (
      <div key={group.key} className="flex flex-col gap-0.5 px-1 pb-2">
        <div className="flex items-baseline gap-1.5 px-2 pt-2 pb-1">
          <span className="truncate text-xs font-semibold text-foreground/80">{group.label}</span>
          {group.workspaceSlug && (
            <span className="truncate font-mono text-[10px] text-muted-foreground">
              {group.workspaceSlug}
            </span>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">{group.count}</span>
        </div>
        {group.worktreeGroups.map((wt) => (
          <div key={wt.branch ?? '__default__'} className="flex flex-col gap-0.5">
            {showWorktreeHeaders && (
              <p className="flex items-center gap-1.5 px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground">
                <RiGitBranchLine className="size-3 shrink-0" />
                <span className="truncate font-mono">{wt.label}</span>
              </p>
            )}
            <div className={cn('flex flex-col gap-0.5', showWorktreeHeaders && 'ml-3 border-l border-border/60 pl-1')}>
              {wt.tabs.map(renderRow)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-72 shrink-0 flex-col border-r border-border">
        <header className="border-b border-border px-3 py-2.5">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold">
            <RiTerminalBoxLine className="size-4" />
            Command Center
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {tabs.length} active terminal{tabs.length === 1 ? '' : 's'}
            {projectGroups.length > 0 && ` · ${projectGroups.length} group${projectGroups.length === 1 ? '' : 's'}`}
          </p>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {error ? (
            <div className="flex flex-col items-start gap-1.5 px-3 py-2">
              <p className="text-[11px] text-destructive">{error}</p>
              <button
                type="button"
                onClick={retry}
                className="rounded-sm border border-border px-2 py-1 text-[11px] hover:bg-muted"
              >
                Retry
              </button>
            </div>
          ) : loading ? (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">Loading terminals…</p>
          ) : tabs.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">
              No active terminals. Open a terminal in any project and it will appear here.
            </p>
          ) : (
            projectGroups.map(renderProjectGroup)
          )}
        </div>
      </aside>

      <section className="flex min-h-0 flex-1 flex-col">
        {selected ? (
          <>
            <header className="flex items-center gap-2 border-b border-border px-3 py-2">
              <TerminalSessionLabel tab={selected} className="text-xs" />
              <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">
                {selected.scope.workingDir}
              </span>
              {selectedStatus === 'exited' && (
                <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  exited
                </span>
              )}
            </header>
            <div className="min-h-0 flex-1">
              <TerminalInstance
                key={selected.sessionId}
                tab={selected}
                xtermTheme={xtermTheme}
                onStatusChange={handleStatusChange}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <RiTerminalBoxLine className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">No terminal selected</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Select a terminal on the left to view and interact with it. Activity from every
              project and worktree shows up here in real time.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
