'use client';

import { Fragment, useEffect, useState } from 'react';
import {
  RiAddLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiGitBranchLine,
  RiListUnordered,
} from '@remixicon/react';
import type { IDockviewHeaderActionsProps } from 'dockview';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTerminalDock } from './terminal-dock-context';
import { type TerminalPanelParams } from './types';
import { TerminalSessionLabel } from './terminal-session-label';
import { TerminalNewMenuContent } from './terminal-new-menu';
import { groupTabsByWorktree, type TerminalWorktreeGroup } from './worktree-grouping';
import { useCommandCenterMode } from './command-center/use-command-center-mode';
import { groupTabsByProject } from './command-center/grouping';
import { cloneScopeForNewTerminal } from './command-center/new-terminal-scope';
import { useTerminalActivities } from '@/hooks/use-terminal-activity';
import { useIsMobile } from '@/hooks/use-mobile';

export function TerminalDockActions({ activePanel, panels }: IDockviewHeaderActionsProps) {
  const { openTerminal, onCollapse, extraDropdownGroups, containerEnabled, defaultScope } =
    useTerminalDock();
  const isMobile = useIsMobile();
  const activities = useTerminalActivities(panels.map((p) => p.id));
  const [, forceRender] = useState(0);
  // Mobile: the cramped "all terminals" dropdown is replaced by a full-screen
  // worktree-grouped list (the mobile equivalent of the desktop rail).
  const [showList, setShowList] = useState(false);

  useEffect(() => {
    const disposables = panels.map((panel) =>
      panel.api.onDidParametersChange(() => forceRender((n) => n + 1)),
    );
    return () => {
      for (const d of disposables) d.dispose();
    };
  }, [panels]);

  const commandCenter = useCommandCenterMode();
  const panelById = new Map(panels.map((p) => [p.id, p]));
  const liveTabs = panels.map((panel) => {
    const { tab } = panel.params as TerminalPanelParams;
    return { ...tab, activityState: activities[panel.id] ?? tab.activityState };
  });
  const groups = groupTabsByWorktree(liveTabs);
  const showGroupHeaders = groups.length > 1;

  // Command Center mode hosts terminals from every project, so the mobile list
  // groups by project (with a per-project "+"); otherwise a single unlabelled
  // section keeps the plain worktree grouping.
  const mobileSections = commandCenter
    ? groupTabsByProject(liveTabs).map((pg) => ({
        key: pg.key,
        projectLabel: pg.label,
        isProject: pg.isProject,
        workspaceSlug: pg.workspaceSlug,
        worktreeGroups: pg.worktreeGroups,
      }))
    : [
        {
          key: '__all__',
          projectLabel: undefined,
          isProject: false,
          workspaceSlug: undefined,
          worktreeGroups: groups,
        },
      ];

  function focusPanel(sessionId: string) {
    panelById.get(sessionId)?.api.setActive();
    setShowList(false);
  }

  function openClonedTerminal(worktreeGroups: TerminalWorktreeGroup[]) {
    const cloned = cloneScopeForNewTerminal(worktreeGroups);
    if (!cloned) return;
    openTerminal(cloned);
    setShowList(false);
  }

  return (
    <div className="flex shrink-0 items-center border-l border-border">
      {panels.length > 1 &&
        (isMobile ? (
          <button
            className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground border-r border-border"
            aria-label="List terminals"
            onClick={() => setShowList(true)}
          >
            <RiListUnordered className="size-3" />
          </button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground border-r border-border"
                aria-label="List terminals"
                title="All terminals"
              >
                <RiListUnordered className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-96">
              {groups.map((group, gi) => (
                <Fragment key={group.branch ?? '__default__'}>
                  {showGroupHeaders && (
                    <>
                      {gi > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuLabel className="flex items-center gap-1.5 text-xs font-semibold">
                        <RiGitBranchLine className="size-3 text-muted-foreground" />
                        <span className="truncate font-mono">{group.label}</span>
                      </DropdownMenuLabel>
                    </>
                  )}
                  {group.tabs.map((liveTab) => {
                    const panel = panelById.get(liveTab.sessionId)!;
                    const isExited = liveTab.status === 'exited';
                    const isActive = activePanel?.id === panel.id;
                    return (
                      <DropdownMenuItem
                        key={panel.id}
                        onClick={() => panel.api.setActive()}
                        className={cn('items-start', isExited && 'opacity-60')}
                        aria-current={isActive || undefined}
                      >
                        <TerminalSessionLabel tab={liveTab} />
                        {isActive && (
                          <span
                            aria-hidden
                            className="ml-auto mt-1 size-1.5 rounded-full bg-foreground"
                          />
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                </Fragment>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
      {commandCenter ? (
        // The generic "+" targets the CURRENT project, which would silently
        // bypass the Command Center's per-project creation — disable it and
        // point at the project groups' own "+" in the terminal list instead.
        <button
          disabled
          className="flex h-8 w-8 items-center justify-center text-muted-foreground/40"
          aria-label="Add terminal (disabled in Command Center)"
          title="In Command Center, use a project group's + in the terminal list"
        >
          <RiAddLine className="size-3" />
        </button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Add terminal"
              title="New terminal"
            >
              <RiAddLine className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <TerminalNewMenuContent
              openTerminal={openTerminal}
              extraDropdownGroups={extraDropdownGroups}
              containerEnabled={containerEnabled}
              defaultScope={defaultScope}
              inline={isMobile}
              onSplit={(direction) =>
                openTerminal(undefined, { referencePanel: activePanel!.id, direction })
              }
              splitDisabled={!activePanel}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <button
        onClick={onCollapse}
        className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground border-l border-border"
        aria-label="Collapse terminal panel"
        title="Collapse (Ctrl+`)"
      >
        <RiArrowRightSLine className="size-3" />
      </button>

      {/* Rendered inline (NOT portaled to document.body): the manager lives
          inside the mobile sheet's Radix dialog, which disables pointer events
          on everything outside it — a body portal would let taps fall through to
          the terminal (popping the keyboard) instead of hitting the list rows.
          No transformed ancestors, so `fixed` still covers the viewport. */}
      {isMobile && showList && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-background">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-2">
            <button
              onClick={() => setShowList(false)}
              aria-label="Back to terminal"
              className="flex size-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <RiArrowLeftSLine className="size-4" />
            </button>
            <span className="text-xs font-medium text-muted-foreground">Terminals</span>
            {commandCenter ? (
              // Same rule as the header "+": per-project creation only in CC.
              <button
                disabled
                aria-label="New terminal (disabled in Command Center)"
                title="In Command Center, use a project group's +"
                className="flex size-8 items-center justify-center rounded-sm text-muted-foreground/40"
              >
                <RiAddLine className="size-4" />
              </button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label="New terminal"
                    className="flex size-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <RiAddLine className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-[70vh] overflow-y-auto">
                  <TerminalNewMenuContent
                    openTerminal={(scope, position) => {
                      openTerminal(scope, position);
                      setShowList(false);
                    }}
                    extraDropdownGroups={extraDropdownGroups}
                    containerEnabled={containerEnabled}
                    defaultScope={defaultScope}
                    inline
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-1.5">
            {mobileSections.map((section) => {
              const showWorktreeHeaders = section.worktreeGroups.length > 1;
              return (
                <div key={section.key} className="flex flex-col gap-0.5 pb-1.5">
                  {section.projectLabel && (
                    <div className="flex items-center gap-1">
                      <p className="flex min-w-0 flex-1 items-baseline gap-1 truncate px-2 pt-2 pb-1 text-xs font-semibold text-foreground/80">
                        {section.workspaceSlug && (
                          <span className="max-w-[45%] shrink-0 truncate font-normal text-muted-foreground">
                            {section.workspaceSlug} /
                          </span>
                        )}
                        <span className="truncate">{section.projectLabel}</span>
                      </p>
                      {section.isProject && (
                        <button
                          type="button"
                          onClick={() => openClonedTerminal(section.worktreeGroups)}
                          aria-label={`New terminal in ${section.projectLabel}`}
                          className="mr-1 shrink-0 rounded-sm p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <RiAddLine className="size-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                  {section.worktreeGroups.map((group) => (
                    <div key={group.branch ?? '__default__'} className="flex flex-col gap-0.5">
                      {showWorktreeHeaders && (
                        <p className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-xs font-semibold text-foreground/80">
                          <RiGitBranchLine className="size-3 shrink-0 text-muted-foreground" />
                          <span className="truncate font-mono">{group.label}</span>
                        </p>
                      )}
                      <div
                        className={cn(
                          'flex flex-col gap-0.5',
                          showWorktreeHeaders && 'ml-3 border-l border-border/60 pl-1',
                        )}
                      >
                        {group.tabs.map((liveTab) => {
                          const isActive = activePanel?.id === liveTab.sessionId;
                          return (
                            <button
                              key={liveTab.sessionId}
                              onClick={() => focusPanel(liveTab.sessionId)}
                              aria-current={isActive || undefined}
                              className={cn(
                                'flex w-full items-start rounded-sm px-2 py-2.5 text-left hover:bg-muted',
                                isActive && 'bg-muted',
                                liveTab.status === 'exited' && 'opacity-60',
                              )}
                            >
                              <TerminalSessionLabel tab={liveTab} />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
