'use client';

import { useEffect, useReducer, useState } from 'react';
import { RiFileTextLine, RiCloseLine } from '@remixicon/react';
import type { IDockviewPanelHeaderProps } from 'dockview';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { TabCloseMenu } from '@/components/tabs/tab-close-menu';
import { activeLast, panelsToClose, type TabCloseScope } from './doc-tab-close';
import type { DocPanelParams, DocTab } from './types';

function basename(filePath: string): string {
  const parts = filePath.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? filePath;
}

export function DocDockTab({
  api,
  containerApi,
  params,
}: IDockviewPanelHeaderProps<DocPanelParams>) {
  const [tab, setTab] = useState<DocTab>(params.tab);
  const [, refreshGroupPanels] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const disposables = [
      containerApi.onDidAddPanel(refreshGroupPanels),
      containerApi.onDidRemovePanel(refreshGroupPanels),
      containerApi.onDidMovePanel(refreshGroupPanels),
    ];
    return () => disposables.forEach((d) => d.dispose());
  }, [containerApi]);

  useEffect(() => {
    const disposable = api.onDidParametersChange(() => {
      const updated = api.getParameters() as DocPanelParams;
      if (updated?.tab) setTab(updated.tab);
    });
    return () => disposable.dispose();
  }, [api]);

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      api.close();
    }
  }

  const groupPanels = api.group.panels;
  const index = groupPanels.findIndex((p) => p.id === api.id);

  function closePanels(scope: TabCloseScope) {
    const panels = panelsToClose(groupPanels, api.id, scope);
    if (panels.some((p) => p.id === api.group.activePanel?.id)) api.setActive();
    for (const panel of panels) panel.api.close();
  }

  return (
    <TabCloseMenu
      tabCount={groupPanels.length}
      isLast={index === groupPanels.length - 1}
      onClose={() => api.close()}
      onCloseOthers={() => closePanels('others')}
      onCloseToRight={() => closePanels('right')}
      onCloseAll={() => {
        for (const panel of activeLast(groupPanels, api.group.activePanel?.id)) {
          panel.api.close();
        }
      }}
    >
      <div
        className="group flex h-full max-w-[180px] items-center gap-1.5 px-2.5 text-xs"
        onMouseDown={handleMouseDown}
      >
        <RiFileTextLine className="size-[11px] shrink-0" />
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="min-w-0 truncate">{basename(tab.filePath)}</span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="font-mono">{tab.filePath}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <button
          onClick={(e) => {
            e.stopPropagation();
            api.close();
          }}
          className="ml-auto shrink-0 rounded-sm p-0.5 opacity-0 hover:bg-muted group-hover:opacity-100"
          aria-label="Close document"
        >
          <RiCloseLine className="size-[10px]" />
        </button>
      </div>
    </TabCloseMenu>
  );
}
