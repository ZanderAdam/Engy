'use client';

import { useRef, useState, type DragEvent } from 'react';
import {
  RiAddLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCloseLine,
  RiFolderLine,
  RiGitBranchLine,
  RiLayoutGridLine,
  RiListUnordered,
  RiTerminalLine,
} from '@remixicon/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { CloseTerminalDialog } from './close-terminal-dialog';
import { useCanHover } from '@/hooks/use-can-hover';
import { cn } from '@/lib/utils';
import { useTabId } from '@/components/tabs/tab-context';
import { useTerminalScope } from './use-terminal-scope';
import { useTerminalSessions, terminalRailKey } from './terminal-session-store';
import { useTerminalNumber } from './use-terminal-number';
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
import { cloneScopeForNewTerminal } from './command-center/new-terminal-scope';
import {
  getTerminalRailBoxStyle,
  type TerminalDropdownGroup,
  type TerminalScope,
  type TerminalRailGroup,
  type TerminalTab,
} from './types';
import type { TerminalWorktreeGroup } from './worktree-grouping';
import {
  railItems,
  railSections,
  type TerminalRailGroupItem,
  type TerminalRailSection,
} from './rail-order';
import {
  planGroupHeaderDrop,
  planTerminalDrop,
  railDropZone,
  type RailDropPlan,
  type RailDropZone,
} from './rail-drop';
import {
  RailDropLine,
  TerminalRailGroupHeader,
  type RailDropHandlers,
} from './terminal-rail-group-header';
import { toggleRailGroupCollapsed, useCollapsedRailGroups } from './use-collapsed-rail-groups';
import { setWorktreeGrouping, useWorktreeGrouping } from './use-worktree-grouping';
import { randomId } from '@/lib/random-id';

interface RailDragHandlers extends RailDropHandlers {
  draggable: boolean;
  onDragStart: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}

interface RailDropTarget {
  id: string;
  zone: RailDropZone;
}

const NEW_GROUP_NAME = 'Group';

function groupDropId(groupId: string): string {
  return `group:${groupId}`;
}

// Dots mode stays focus-and-sort only: grouping happens in the expanded list.
function dropZoneAt(e: DragEvent<HTMLElement>, groupable: boolean): RailDropZone {
  const rect = e.currentTarget.getBoundingClientRect();
  const offsetY = e.clientY - rect.top;
  if (!groupable) return offsetY < rect.height / 2 ? 'before' : 'after';
  return railDropZone(offsetY, rect.height);
}

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
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<RailDropTarget | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const byWorktree = useWorktreeGrouping();
  const collapsedGroups = useCollapsedRailGroups();
  const canHover = useCanHover();

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

  const sections = railSections(tabs, commandCenter, byWorktree);

  function setRailGroup(sessionIds: string[], group: TerminalRailGroup | null) {
    window.dispatchEvent(
      new CustomEvent('terminal:group', { detail: { sessionIds, group, tabId } }),
    );
  }

  function commitGroupRename(item: TerminalRailGroupItem, value: string | null) {
    setEditingGroupId(null);
    const name = value?.trim();
    if (!name || name === item.group.name) return;
    const members = tabs.filter((t) => t.railGroup?.id === item.group.id);
    setRailGroup(
      members.map((t) => t.sessionId),
      { id: item.group.id, name },
    );
  }

  // The rail only asks the dock to move the panel; the reordered list comes
  // back through the session store, so the list and the tab strip cannot drift
  // apart (see terminal:reorder in TerminalManager).
  function applyDropPlan(sessionId: string, plan: RailDropPlan) {
    if (plan.regroup) setRailGroup(plan.regroup.sessionIds, plan.regroup.group);
    if (plan.reorder) {
      window.dispatchEvent(
        new CustomEvent('terminal:reorder', { detail: { sessionId, ...plan.reorder, tabId } }),
      );
    }
  }

  function endDrag() {
    draggingIdRef.current = null;
    setDropTarget(null);
  }

  function dropHandlers(
    id: string,
    groupable: boolean,
    plan: (dragged: TerminalTab, zone: RailDropZone) => RailDropPlan,
  ): RailDropHandlers {
    return {
      onDragOver: (e) => {
        if (!draggingIdRef.current || draggingIdRef.current === id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const zone = dropZoneAt(e, groupable);
        setDropTarget((current) =>
          current?.id === id && current.zone === zone ? current : { id, zone },
        );
      },
      onDragLeave: (e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDropTarget((current) => (current?.id === id ? null : current));
      },
      onDrop: (e) => {
        e.preventDefault();
        const dragged = tabs.find((t) => t.sessionId === draggingIdRef.current);
        const zone = dropZoneAt(e, groupable);
        endDrag();
        if (dragged) applyDropPlan(dragged.sessionId, plan(dragged, zone));
      },
    };
  }

  function dragProps(tab: TerminalTab, groupable: boolean): RailDragHandlers {
    return {
      draggable: true,
      onDragStart: (e: DragEvent<HTMLElement>) => {
        draggingIdRef.current = tab.sessionId;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', tab.sessionId);
      },
      onDragEnd: endDrag,
      ...dropHandlers(tab.sessionId, groupable, (dragged, zone) =>
        planTerminalDrop(dragged, tab, zone, {
          byWorktree,
          newGroup: () => ({ id: randomId(), name: NEW_GROUP_NAME }),
        }),
      ),
    };
  }

  function dropZoneFor(id: string): RailDropZone | undefined {
    return dropTarget?.id === id ? dropTarget.zone : undefined;
  }

  function renderGroup(item: TerminalRailGroupItem) {
    const collapsedGroup = collapsedGroups.has(item.group.id);
    const dropId = groupDropId(item.group.id);
    return (
      <div key={dropId} className="flex flex-col gap-0.5">
        <TerminalRailGroupHeader
          group={item.group}
          count={item.tabs.length}
          collapsed={collapsedGroup}
          editing={editingGroupId === item.group.id}
          dropZone={dropZoneFor(dropId)}
          dropHandlers={dropHandlers(dropId, true, (dragged, zone) =>
            planGroupHeaderDrop(dragged, item, zone, { byWorktree }),
          )}
          onToggle={() => toggleRailGroupCollapsed(item.group.id)}
          onStartRename={() => setEditingGroupId(item.group.id)}
          onRename={(name) => commitGroupRename(item, name)}
        />
        {!collapsedGroup && (
          <div className="ml-3 flex flex-col gap-0.5 border-l border-border/60 pl-1">
            {item.tabs.map(renderExpandedRow)}
          </div>
        )}
      </div>
    );
  }

  function renderExpandedItems(groupTabs: TerminalTab[]) {
    return railItems(groupTabs).map((item) =>
      item.kind === 'group' ? renderGroup(item) : renderExpandedRow(item.tab),
    );
  }

  function renderDotItems(groupTabs: TerminalTab[]) {
    return railItems(groupTabs).flatMap((item) => {
      if (item.kind === 'terminal') return [renderDot(item.tab)];
      return [
        <Tooltip key={groupDropId(item.group.id)}>
          <TooltipTrigger asChild>
            <span
              className="flex size-5 items-center justify-center text-muted-foreground"
              aria-label={`Group ${item.group.name}`}
            >
              <RiFolderLine className="size-3" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            {item.group.name}
          </TooltipContent>
        </Tooltip>,
        ...(collapsedGroups.has(item.group.id) ? [] : item.tabs.map(renderDot)),
      ];
    });
  }

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
        {renderWorktreeTabs(group.tabs, showHeader, dots)}
      </div>
    );
  }

  function renderWorktreeTabs(groupTabs: TerminalTab[], indented: boolean, dots: boolean) {
    if (dots) return renderDotItems(groupTabs);
    if (!indented) return renderExpandedItems(groupTabs);
    return (
      <div className="ml-3 flex flex-col gap-0.5 border-l border-border/60 pl-1">
        {renderExpandedItems(groupTabs)}
      </div>
    );
  }

  function renderSection(section: TerminalRailSection, dots: boolean) {
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
                <span className="block max-w-8 truncate text-[9px] font-semibold uppercase text-muted-foreground">
                  {section.projectLabel}
                </span>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">
                {section.workspaceSlug
                  ? `${section.workspaceSlug} / ${section.projectLabel}`
                  : section.projectLabel}
              </TooltipContent>
            </Tooltip>
          ) : (
            <div className="group/section flex items-center gap-1 pr-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="flex min-w-0 flex-1 items-baseline gap-1 truncate px-2 pt-1.5 pb-0.5 text-xs font-semibold text-foreground/80">
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
              {section.isProject && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => {
                        const cloned = cloneScopeForNewTerminal(section.worktreeGroups);
                        if (cloned) openTerminalFromRail(cloned);
                      }}
                      aria-label={`New terminal in ${section.projectLabel}`}
                      className={cn(
                        'mt-1 shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground',
                        canHover ? 'opacity-0 group-hover/section:opacity-100' : 'opacity-100',
                      )}
                    >
                      <RiAddLine className="size-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    New terminal in {section.projectLabel}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
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
          if (e.key === 'Enter')
            commitRename(tab.sessionId, e.currentTarget.value, tab.scope.scopeLabel);
          else if (e.key === 'Escape') setEditingId(null);
        }}
        onBlur={(e) => commitRename(tab.sessionId, e.currentTarget.value, tab.scope.scopeLabel)}
      />
    ) : (
      <div
        key={tab.sessionId}
        {...dragProps(tab, true)}
        className={cn(
          'group relative flex items-start rounded-sm hover:bg-muted',
          tab.sessionId === activeId && 'bg-muted',
          dropZoneFor(tab.sessionId) === 'into' && 'ring-1 ring-inset ring-primary',
        )}
      >
        <RailDropLine zone={dropZoneFor(tab.sessionId)} />
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
            canHover ? 'opacity-0 group-hover:opacity-100' : 'opacity-100',
          )}
        >
          <RiCloseLine className="size-3" />
        </button>
      </div>
    );
  }

  function renderDot(tab: TerminalTab) {
    return (
      <TerminalRailDot
        key={tab.sessionId}
        tab={tab}
        active={tab.sessionId === activeId}
        dropZone={dropZoneFor(tab.sessionId)}
        dragProps={dragProps(tab, false)}
        onFocus={() => focusSession(tab.sessionId)}
      />
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
        <div
          className={cn(
            'flex gap-1',
            listExpanded ? 'flex-row items-center px-1' : 'flex-col items-center',
          )}
        >
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
            <TooltipContent side="left">
              {collapsed ? 'Show panel' : 'Collapse panel'}
            </TooltipContent>
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

          {commandCenter ? (
            // The generic "+" is scoped to the CURRENT project, which would
            // silently bypass the Command Center's per-project creation —
            // disable it and point at the project groups' own "+" instead.
            <Tooltip>
              <TooltipTrigger asChild>
                {/* Disabled buttons swallow pointer events; the span keeps the
                    tooltip hoverable. */}
                <span className="inline-flex">
                  <button
                    type="button"
                    disabled
                    aria-label="New terminal (disabled in Command Center)"
                    className={cn(
                      ctrlButton,
                      'opacity-40 hover:bg-transparent hover:text-muted-foreground',
                    )}
                  >
                    <RiAddLine className="size-3.5" />
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="left">
                In Command Center, use a project group&apos;s + in the expanded list
              </TooltipContent>
            </Tooltip>
          ) : (
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
              <DropdownMenuContent
                side="left"
                align="start"
                className="max-h-[70vh] overflow-y-auto"
              >
                <TerminalNewMenuContent
                  openTerminal={openTerminalFromRail}
                  extraDropdownGroups={extraDropdownGroups}
                  containerEnabled={containerEnabled}
                  defaultScope={scope}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          )}

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

          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex size-7 items-center justify-center">
                <Checkbox
                  checked={byWorktree}
                  onCheckedChange={(checked) => setWorktreeGrouping(checked === true)}
                  aria-label="Group terminals by worktree"
                />
              </span>
            </TooltipTrigger>
            <TooltipContent side="left">Group by worktree</TooltipContent>
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

      <CloseTerminalDialog
        open={closingTab !== null}
        onOpenChange={(open) => {
          if (!open) setClosingTab(null);
        }}
        label={closingTab?.scope.scopeLabel ?? ''}
        onConfirm={() => closeSession(closingTab!.sessionId)}
      />
    </TooltipProvider>
  );
}

// A dot is its own component so it can call useTerminalNumber — the same
// hook the expanded list gets its number from via TerminalSessionLabel. The
// collapsed dot swaps the glyph for the number rather than adding a badge:
// the glyph is identical on every dot, so it carries nothing the number does
// not.
function TerminalRailDot({
  tab,
  active,
  dropZone,
  dragProps,
  onFocus,
}: {
  tab: TerminalTab;
  active: boolean;
  dropZone: RailDropZone | undefined;
  dragProps: RailDragHandlers;
  onFocus: () => void;
}) {
  const terminalNumber = useTerminalNumber(tab.sessionId);
  const spoken = terminalNumber === null ? '' : `${terminalNumber} `;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onFocus}
          {...dragProps}
          aria-label={`Focus terminal ${spoken}${tab.scope.scopeLabel}${tab.oscTitle ? `: ${tab.oscTitle}` : ''}`}
          aria-current={active || undefined}
          className={cn(
            'relative flex size-6 items-center justify-center rounded-[5px] transition-colors',
            getTerminalRailBoxStyle(tab),
            active && 'ring-1 ring-inset ring-foreground/60',
          )}
        >
          <RailDropLine zone={dropZone} />
          {terminalNumber === null ? (
            <RiTerminalLine className="size-3" />
          ) : (
            <span className="text-[11px] font-medium tabular-nums">{terminalNumber}</span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-72">
        <TerminalSessionLabel tab={tab} />
      </TooltipContent>
    </Tooltip>
  );
}
