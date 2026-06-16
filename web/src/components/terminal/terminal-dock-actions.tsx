'use client';

import { Fragment, useEffect, useState } from 'react';
import {
  RiAddLine,
  RiArrowRightSLine,
  RiBox3Line,
  RiListUnordered,
  RiSplitCellsHorizontal,
  RiSplitCellsVertical,
  RiTerminalLine,
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
import { toContainerScope, type TerminalPanelParams } from './types';
import { TerminalSessionLabel } from './terminal-session-label';
import { useTerminalActivities } from '@/hooks/use-terminal-activity';

export function TerminalDockActions({ activePanel, panels }: IDockviewHeaderActionsProps) {
  const { openTerminal, onCollapse, extraDropdownGroups, containerEnabled, defaultScope } =
    useTerminalDock();
  const activities = useTerminalActivities(panels.map((p) => p.id));
  const [, forceRender] = useState(0);

  useEffect(() => {
    const disposables = panels.map((panel) =>
      panel.api.onDidParametersChange(() => forceRender((n) => n + 1)),
    );
    return () => {
      for (const d of disposables) d.dispose();
    };
  }, [panels]);

  return (
    <div className="flex shrink-0 items-center border-l border-border">
      {panels.length > 1 && (
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
            {panels.map((panel) => {
              const { tab } = panel.params as TerminalPanelParams;
              const liveTab = { ...tab, activityState: activities[panel.id] ?? tab.activityState };
              const isExited = tab.status === 'exited';
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
          </DropdownMenuContent>
        </DropdownMenu>
      )}
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
          <DropdownMenuItem
            onClick={() =>
              containerEnabled && defaultScope
                ? openTerminal({ ...defaultScope, containerMode: 'host' })
                : openTerminal()
            }
          >
            <RiAddLine className="size-3" />
            New Terminal
          </DropdownMenuItem>
          {containerEnabled && defaultScope && (
            <DropdownMenuItem
              onClick={() =>
                openTerminal(toContainerScope(defaultScope))
              }
            >
              <RiBox3Line className="size-3" />
              New Terminal (Container)
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() =>
              openTerminal(undefined, { referencePanel: activePanel!.id, direction: 'right' })
            }
            disabled={!activePanel}
          >
            <RiSplitCellsHorizontal className="size-3" />
            Split Right
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              openTerminal(undefined, { referencePanel: activePanel!.id, direction: 'below' })
            }
            disabled={!activePanel}
          >
            <RiSplitCellsVertical className="size-3" />
            Split Down
          </DropdownMenuItem>

          {extraDropdownGroups?.map((group, gi) => (
            <Fragment key={gi}>
              <DropdownMenuSeparator />
              {group.label && (
                <DropdownMenuLabel className="text-[10px]">{group.label}</DropdownMenuLabel>
              )}
              {group.entries.map((entry) => {
                const Icon = entry.icon ?? RiTerminalLine;
                return (
                  <DropdownMenuItem
                    key={entry.id}
                    onClick={() => openTerminal(entry.scope)}
                    title={entry.tooltip}
                  >
                    <Icon className="size-3" />
                    <span className="truncate">{entry.label}</span>
                  </DropdownMenuItem>
                );
              })}
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        onClick={onCollapse}
        className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground border-l border-border"
        aria-label="Collapse terminal panel"
        title="Collapse (Ctrl+`)"
      >
        <RiArrowRightSLine className="size-3" />
      </button>
    </div>
  );
}
