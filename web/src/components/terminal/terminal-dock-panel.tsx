'use client';

import dynamic from 'next/dynamic';
import type { IDockviewPanelProps } from 'dockview';
import { useTerminalDock } from './terminal-dock-context';
import { useXtermTheme } from '@/hooks/use-xterm-theme';
import type { TerminalPanelParams } from './types';

const TerminalInstance = dynamic(
  () => import('./terminal').then((m) => m.TerminalInstance),
  { ssr: false },
);

export function TerminalDockPanel({ params }: IDockviewPanelProps<TerminalPanelParams>) {
  const { handleStatusChange, handleReady } = useTerminalDock();
  const xtermTheme = useXtermTheme();

  return (
    <TerminalInstance
      tab={params.tab}
      xtermTheme={xtermTheme}
      onStatusChange={handleStatusChange}
      onReady={handleReady}
    />
  );
}
