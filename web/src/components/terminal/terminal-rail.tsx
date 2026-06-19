'use client';

import { useState } from 'react';
import {
  RiAddLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiGitBranchLine,
  RiListUnordered,
  RiTerminalLine,
} from '@remixicon/react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useTabId } from '@/components/tabs/tab-context';
import { useTerminalScope } from './use-terminal-scope';
import { useTerminalSessions, terminalRailKey } from './terminal-session-store';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TerminalSessionLabel } from './terminal-session-label';
import { TerminalNewMenuContent } from './terminal-new-menu';
import {
  getTerminalRailBoxStyle,
  type TerminalDropdownGroup,
  type TerminalScope,
  type TerminalTab,
} from './types';
import { groupTabsByWorktree } from './worktree-grouping';

interface TerminalRailProps {
  // Collapse state of the terminal dock (owned by ThreePanelLayout). The rail
  // hosts the collapse control so the dock's controls + the rail share one
  // column.
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  // Same per-repo/worktree groups the dock's new-terminal menu uses, so the
  // rail's "+" offers the identical unified menu.
  extraDropdownGroups?: TerminalDropdownGroup[];
  containerEnabled?: boolean;
}

// Persistent rail of terminal status dots, immediately left of the terminal
// dock (so it lands at the screen edge when the dock collapses to zero width).
// Each dot is a filled box coloured by activity (idle/active/waiting/done);
// clicking it dispatches terminal:focus, which focuses the session and
// auto-expands the dock. The list toggle widens the rail into a labelled list
// that stays open until toggled (it does not close on outside clicks and
// survives dock collapse). A "+" opens a new terminal.
export function TerminalRail({
  collapsed,
  setCollapsed,
  extraDropdownGroups,
  containerEnabled,
}: TerminalRailProps) {
  const scope = useTerminalScope();
  const tabId = useTabId();
  const { tabs, activeId } = useTerminalSessions(terminalRailKey(tabId, scope.groupKey));
  const [listExpanded, setListExpanded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  function focusSession(sessionId: string) {
    window.dispatchEvent(new CustomEvent('terminal:focus', { detail: { sessionId, tabId } }));
  }

  // The rail lives outside the dockview, so it opens terminals the same way the
  // manager's own controls do — by dispatching terminal:open (falling back to
  // the default scope for the plain "New Terminal" item). Split has no meaning
  // here (no reference panel), so it's omitted from the menu.
  function openTerminalFromRail(chosen?: TerminalScope) {
    window.dispatchEvent(
      new CustomEvent('terminal:open', { detail: { scope: chosen ?? scope, tabId } }),
    );
  }

  function commitRename(sessionId: string, value: string, currentLabel: string) {
    setEditingId(null);
    const trimmed = value.trim();
    if (trimmed && trimmed !== currentLabel) {
      window.dispatchEvent(
        new CustomEvent('terminal:rename', { detail: { sessionId, newLabel: trimmed, tabId } }),
      );
    }
  }

  const ctrlButton =
    'flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground';

  // Group terminals by worktree (combined mode). Headers/dividers only appear
  // once more than one worktree is in play, so split mode looks unchanged.
  const groups = groupTabsByWorktree(tabs);
  const showGroupHeaders = groups.length > 1;

  function renderExpandedRow(tab: TerminalTab) {
    return editingId === tab.sessionId ? (
      <input
        key={tab.sessionId}
        className="rounded-sm border border-border bg-transparent px-2 py-1.5 text-xs font-mono outline-none"
        defaultValue={tab.scope.scopeLabel}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitRename(tab.sessionId, e.currentTarget.value, tab.scope.scopeLabel);
          else if (e.key === 'Escape') setEditingId(null);
        }}
        onBlur={(e) => commitRename(tab.sessionId, e.currentTarget.value, tab.scope.scopeLabel)}
      />
    ) : (
      <button
        key={tab.sessionId}
        type="button"
        onClick={() => focusSession(tab.sessionId)}
        onDoubleClick={() => setEditingId(tab.sessionId)}
        aria-current={tab.sessionId === activeId || undefined}
        title="Double-click to rename"
        className={cn(
          'flex items-start rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted',
          tab.sessionId === activeId && 'bg-muted',
        )}
      >
        <TerminalSessionLabel tab={tab} />
      </button>
    );
  }

  function renderDot(tab: TerminalTab) {
    return (
      <Tooltip key={tab.sessionId}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => focusSession(tab.sessionId)}
            aria-label={`Focus terminal ${tab.scope.scopeLabel}${tab.oscTitle ? `: ${tab.oscTitle}` : ''}`}
            aria-current={tab.sessionId === activeId || undefined}
            className={cn(
              'flex size-6 items-center justify-center rounded-[5px] transition-colors',
              getTerminalRailBoxStyle(tab),
              tab.sessionId === activeId && 'ring-1 ring-inset ring-foreground/60',
            )}
          >
            <RiTerminalLine className="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-72">
          <TerminalSessionLabel tab={tab} />
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          'flex shrink-0 flex-col gap-1.5 border-l border-border bg-background py-1.5 transition-[width] duration-200 ease-in-out',
          listExpanded ? 'w-60' : 'w-10 items-center',
        )}
      >
        {/* Controls — vertical icons when narrow, a header row when expanded. */}
        <div className={cn('flex gap-1', listExpanded ? 'flex-row items-center px-1' : 'flex-col items-center')}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setCollapsed(!collapsed)}
                aria-label={collapsed ? 'Show terminal panel' : 'Collapse terminal panel'}
                className={ctrlButton}
              >
                {collapsed ? (
                  <RiArrowLeftSLine className="size-4" />
                ) : (
                  <RiArrowRightSLine className="size-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">{collapsed ? 'Show panel' : 'Collapse panel'}</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="New terminal"
                title="New terminal"
                className={ctrlButton}
              >
                <RiAddLine className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="left" align="start" className="max-h-[70vh] overflow-y-auto">
              <TerminalNewMenuContent
                openTerminal={openTerminalFromRail}
                extraDropdownGroups={extraDropdownGroups}
                containerEnabled={containerEnabled}
                defaultScope={scope}
              />
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setListExpanded((v) => !v)}
                aria-label={listExpanded ? 'Collapse terminal list' : 'Expand terminal list'}
                aria-expanded={listExpanded}
                className={cn(ctrlButton, listExpanded && 'bg-muted text-foreground')}
              >
                <RiListUnordered className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">Terminal list</TooltipContent>
          </Tooltip>
        </div>

        {/* Sessions — colour-coded dots when narrow, labelled rows when expanded.
            Grouped by worktree when more than one worktree has terminals. */}
        {listExpanded ? (
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1">
            {tabs.length === 0 ? (
              <p className="px-2 py-1.5 text-[11px] text-muted-foreground">No terminals</p>
            ) : (
              groups.map((group) => (
                <div key={group.branch ?? '__default__'} className="flex flex-col gap-0.5">
                  {showGroupHeaders && (
                    <p className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-xs font-semibold text-foreground/80">
                      <RiGitBranchLine className="size-3 shrink-0 text-muted-foreground" />
                      <span className="truncate font-mono">{group.label}</span>
                    </p>
                  )}
                  {showGroupHeaders ? (
                    <div className="ml-3 flex flex-col gap-0.5 border-l border-border/60 pl-1">
                      {group.tabs.map(renderExpandedRow)}
                    </div>
                  ) : (
                    group.tabs.map(renderExpandedRow)
                  )}
                </div>
              ))
            )}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.branch ?? '__default__'} className="flex flex-col items-center gap-1.5">
              {showGroupHeaders && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={`Worktree ${group.label}`}
                    >
                      <RiGitBranchLine className="size-3" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="font-mono text-xs">
                    {group.label}
                  </TooltipContent>
                </Tooltip>
              )}
              {group.tabs.map(renderDot)}
            </div>
          ))
        )}
      </div>
    </TooltipProvider>
  );
}
