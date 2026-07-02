'use client';

import { useState } from 'react';
import {
  RiAddLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCloseLine,
  RiGitBranchLine,
  RiLayoutGridLine,
  RiListUnordered,
  RiTerminalLine,
} from '@remixicon/react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useIsMobile } from '@/hooks/use-mobile';
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
  useCommandCenterMode,
  setCommandCenterMode,
  COMMAND_CENTER_GROUP_KEY,
} from './command-center/use-command-center-mode';
import { groupTabsByProject } from './command-center/grouping';
import {
  getTerminalRailBoxStyle,
  type TerminalDropdownGroup,
  type TerminalScope,
  type TerminalTab,
} from './types';
import { groupTabsByWorktree, type TerminalWorktreeGroup } from './worktree-grouping';

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
  const commandCenter = useCommandCenterMode();
  const { tabs, activeId } = useTerminalSessions(
    terminalRailKey(tabId, commandCenter ? COMMAND_CENTER_GROUP_KEY : scope.groupKey),
  );
  const [listExpanded, setListExpanded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [closingTab, setClosingTab] = useState<TerminalTab | null>(null);
  const isMobile = useIsMobile();

  function focusSession(sessionId: string) {
    window.dispatchEvent(new CustomEvent('terminal:focus', { detail: { sessionId, tabId } }));
  }

  // Closing from the rail mirrors the dock tab's close: dispatch terminal:close
  // so the manager removes the dockview panel, triggering the same
  // onDidRemovePanel cleanup (which kills the session).
  function closeSession(sessionId: string) {
    window.dispatchEvent(new CustomEvent('terminal:close', { detail: { sessionId, tabId } }));
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

  // Command Center mode lists terminals from every project, so group by
  // project → worktree with a project header. The per-project rail just groups
  // by worktree (headers only when more than one worktree is in play).
  const sections = commandCenter
    ? groupTabsByProject(tabs).map((pg) => ({
        key: pg.key,
        projectLabel: pg.label as string | undefined,
        workspaceSlug: pg.workspaceSlug,
        worktreeGroups: pg.worktreeGroups,
      }))
    : [
        {
          key: '__all__',
          projectLabel: undefined as string | undefined,
          workspaceSlug: undefined as string | undefined,
          worktreeGroups: groupTabsByWorktree(tabs),
        },
      ];

  function renderWorktreeGroup(group: TerminalWorktreeGroup, showHeader: boolean, dots: boolean) {
    return (
      <div
        key={group.branch ?? '__default__'}
        className={cn('flex flex-col gap-0.5', dots && 'items-center gap-1.5')}
      >
        {showHeader &&
          (dots ? (
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
          ) : (
            <p className="flex items-center gap-1.5 px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground">
              <RiGitBranchLine className="size-3 shrink-0" />
              <span className="truncate font-mono">{group.label}</span>
            </p>
          ))}
        {showHeader && !dots ? (
          <div className="ml-3 flex flex-col gap-0.5 border-l border-border/60 pl-1">
            {group.tabs.map(renderExpandedRow)}
          </div>
        ) : (
          group.tabs.map(dots ? renderDot : renderExpandedRow)
        )}
      </div>
    );
  }

  function renderSection(section: (typeof sections)[number], dots: boolean) {
    const showWorktreeHeaders = section.worktreeGroups.length > 1;
    return (
      <div
        key={section.key}
        className={cn('flex flex-col gap-0.5', dots ? 'items-center gap-1.5' : 'pb-1')}
      >
        {section.projectLabel &&
          (dots ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-[9px] font-semibold uppercase text-muted-foreground">
                  {section.projectLabel.slice(0, 3)}
                </span>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">
                {section.workspaceSlug ? `${section.workspaceSlug} / ${section.projectLabel}` : section.projectLabel}
              </TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="flex items-baseline gap-1 truncate px-2 pt-1.5 pb-0.5 text-xs font-semibold text-foreground/80">
                  {section.workspaceSlug && (
                    <span className="max-w-[45%] shrink-0 truncate font-normal text-muted-foreground">
                      {section.workspaceSlug} /
                    </span>
                  )}
                  <span className="truncate">{section.projectLabel}</span>
                </p>
              </TooltipTrigger>
              <TooltipContent side="left">
                {section.workspaceSlug
                  ? `${section.workspaceSlug} / ${section.projectLabel}`
                  : section.projectLabel}
              </TooltipContent>
            </Tooltip>
          ))}
        {section.worktreeGroups.map((g) => renderWorktreeGroup(g, showWorktreeHeaders, dots))}
      </div>
    );
  }

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
      <div
        key={tab.sessionId}
        className={cn(
          'group flex items-start rounded-sm hover:bg-muted',
          tab.sessionId === activeId && 'bg-muted',
        )}
      >
        <button
          type="button"
          onClick={() => focusSession(tab.sessionId)}
          onDoubleClick={() => setEditingId(tab.sessionId)}
          aria-current={tab.sessionId === activeId || undefined}
          title="Double-click to rename"
          className="flex min-w-0 flex-1 items-start px-2 py-1.5 text-left text-xs"
        >
          <TerminalSessionLabel tab={tab} iconBox />
        </button>
        <button
          type="button"
          onClick={() => setClosingTab(tab)}
          aria-label={`Close terminal ${tab.scope.scopeLabel}`}
          className={cn(
            'mr-1 mt-1 shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground',
            isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          <RiCloseLine className="size-3" />
        </button>
      </div>
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

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => {
                  const next = !commandCenter;
                  setCommandCenterMode(next);
                  if (next) setCollapsed(false);
                }}
                aria-label="Command Center — all terminals"
                aria-pressed={commandCenter}
                className={cn(ctrlButton, commandCenter && 'bg-muted text-foreground')}
              >
                <RiLayoutGridLine className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {commandCenter ? 'Exit Command Center' : 'Command Center — all terminals'}
            </TooltipContent>
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

        {/* Sessions — colour-coded dots when narrow, labelled rows when
            expanded. Grouped by worktree, and by project in Command Center mode. */}
        {listExpanded ? (
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1">
            {tabs.length === 0 ? (
              <p className="px-2 py-1.5 text-[11px] text-muted-foreground">No terminals</p>
            ) : (
              sections.map((section) => renderSection(section, false))
            )}
          </div>
        ) : (
          sections.map((section) => renderSection(section, true))
        )}
      </div>

      <AlertDialog
        open={closingTab !== null}
        onOpenChange={(open) => {
          if (!open) setClosingTab(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close terminal?</AlertDialogTitle>
            <AlertDialogDescription>
              This will end the session for{' '}
              <span className="font-mono">{closingTab?.scope.scopeLabel}</span> and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              // dispatchEvent is synchronous, so without this defer the panel
              // removal + session kill would run inside Radix's click handler.
              // queueMicrotask lets the dialog finish its own close/cleanup
              // (focus restore, pointer-events unlock) first.
              onClick={() => {
                const sessionId = closingTab!.sessionId;
                queueMicrotask(() => closeSession(sessionId));
              }}
            >
              Close terminal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}
