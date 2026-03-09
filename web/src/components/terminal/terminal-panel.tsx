'use client';

import { useTerminalScope } from './use-terminal-scope';
import { TerminalManager } from './terminal-manager';

interface TerminalPanelProps {
  onCollapse?: () => void;
}

const noop = () => {};

export function TerminalPanel({ onCollapse }: TerminalPanelProps) {
  const scope = useTerminalScope();

  return (
    <div className="flex flex-1 min-h-0 flex-col bg-[#0a0a0a]">
      <TerminalManager onCollapse={onCollapse ?? noop} defaultScope={scope} />
    </div>
  );
}
