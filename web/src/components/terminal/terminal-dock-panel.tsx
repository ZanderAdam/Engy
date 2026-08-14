'use client';

import dynamic from 'next/dynamic';
import type { IDockviewPanelProps } from 'dockview';
import { useTerminalDock } from './terminal-dock-context';
import { useXtermTheme } from '@/hooks/use-xterm-theme';
import type { TerminalPanelParams } from './types';
import { TerminalTaskBar } from './terminal-task-bar';
import { TerminalDormantPanel } from './terminal-dormant-panel';

const TerminalInstance = dynamic(
  () => import('./terminal').then((m) => m.TerminalInstance),
  { ssr: false },
);

export function TerminalDockPanel({ params, api }: IDockviewPanelProps<TerminalPanelParams>) {
  const { handleStatusChange, handleActivity, handleReady, handleOscTitle } = useTerminalDock();
  const xtermTheme = useXtermTheme();
  const { taskId, workspaceSlug } = params.tab.scope;
  const { sessionId, status } = params.tab;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {taskId != null && <TerminalTaskBar taskId={taskId} workspaceSlug={workspaceSlug} />}
      <div className="flex min-h-0 flex-1">
        {status === 'dormant' ? (
          // Mounting the terminal is what restores the session: its socket
          // connect tells the server to respawn the PTY.
          <TerminalDormantPanel
            tab={params.tab}
            onRestore={() => handleStatusChange(sessionId, 'connecting')}
          />
        ) : (
          <TerminalInstance
            tab={params.tab}
            xtermTheme={xtermTheme}
            onStatusChange={handleStatusChange}
            onReady={handleReady}
            onActivity={handleActivity}
            onOscTitle={handleOscTitle}
            panelApi={api}
          />
        )}
      </div>
    </div>
  );
}
