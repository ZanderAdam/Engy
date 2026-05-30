'use client';

import dynamic from 'next/dynamic';
import type { IDockviewPanelProps } from 'dockview';
import { useTerminalDock } from './terminal-dock-context';
import { useXtermTheme } from '@/hooks/use-xterm-theme';
import type { TerminalPanelParams } from './types';
import { TerminalTaskBar } from './terminal-task-bar';

const TerminalInstance = dynamic(
  () => import('./terminal').then((m) => m.TerminalInstance),
  { ssr: false },
);

export function TerminalDockPanel({ params, api }: IDockviewPanelProps<TerminalPanelParams>) {
  const { handleStatusChange, handleActivity, handleReady } = useTerminalDock();
  const xtermTheme = useXtermTheme();
  const { taskId, workspaceSlug } = params.tab.scope;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {taskId != null && <TerminalTaskBar taskId={taskId} workspaceSlug={workspaceSlug} />}
      <div className="flex min-h-0 flex-1">
        <TerminalInstance
          tab={params.tab}
          xtermTheme={xtermTheme}
          onStatusChange={handleStatusChange}
          onReady={handleReady}
          onActivity={handleActivity}
          panelApi={api}
        />
      </div>
    </div>
  );
}
