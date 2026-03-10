'use client';

import { useEffect, useState } from 'react';
import {
  RiFolderLine,
  RiLayoutGridLine,
  RiFileTextLine,
  RiFileCodeLine,
  RiFolderOpenLine,
  RiTerminalLine,
  RiCloseLine,
} from '@remixicon/react';
import type { IDockviewPanelHeaderProps } from 'dockview';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { TerminalPanelParams, TerminalTab } from './types';

function collapseLabel(label: string): string {
  const parts = label.split('/').filter(Boolean);
  if (parts.length <= 2) return label;
  return `/${parts[0]}/.../${parts[parts.length - 1]}`;
}

const SCOPE_ICONS: Record<string, React.ElementType> = {
  project: RiFolderLine,
  workspace: RiLayoutGridLine,
  docs: RiFileTextLine,
  spec: RiFileCodeLine,
  dir: RiFolderOpenLine,
};

export function TerminalDockTab({ api, params }: IDockviewPanelHeaderProps<TerminalPanelParams>) {
  const [tab, setTab] = useState<TerminalTab>(params.tab);

  useEffect(() => {
    const disposable = api.onDidParametersChange(() => {
      const updated = api.getParameters() as TerminalPanelParams;
      if (updated?.tab) setTab(updated.tab);
    });
    return () => disposable.dispose();
  }, [api]);

  const ScopeIcon = SCOPE_ICONS[tab.scope.scopeType] ?? RiTerminalLine;
  const label = tab.scope.scopeLabel;
  const isDir = tab.scope.scopeType === 'dir';

  return (
    <div
      className={cn(
        'group flex h-full max-w-[180px] items-center gap-1.5 px-2.5 text-xs',
        tab.status === 'exited' && 'opacity-50',
      )}
    >
      <ScopeIcon className="size-[11px] shrink-0" />
      {isDir ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="min-w-0 truncate">{collapseLabel(label)}</span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="font-mono">{label}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <span className="min-w-0 truncate">{label}</span>
      )}
      {tab.status === 'exited' && (
        <span className="shrink-0 text-[9px] text-muted-foreground">[exited]</span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          api.close();
        }}
        className="ml-auto shrink-0 rounded-sm p-0.5 opacity-0 hover:bg-muted group-hover:opacity-100"
        aria-label="Close terminal"
      >
        <RiCloseLine className="size-[10px]" />
      </button>
    </div>
  );
}
