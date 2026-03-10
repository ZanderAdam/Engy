'use client';

import dynamic from 'next/dynamic';
import type { IDockviewPanelProps } from 'dockview';
import { useTerminalDock } from './terminal-dock-context';
import type { TerminalPanelParams } from './types';

const TerminalInstance = dynamic(
  () => import('./terminal').then((m) => m.TerminalInstance),
  { ssr: false },
);

export function TerminalDockPanel({ params }: IDockviewPanelProps<TerminalPanelParams>) {
  const { handleStatusChange, handleReady } = useTerminalDock();

  return (
    <TerminalInstance
      tab={params.tab}
      onStatusChange={handleStatusChange}
      onReady={handleReady}
    />
  );
}
