'use client';

import { useTerminalScope } from './use-terminal-scope';
import { TerminalManager } from './terminal-manager';
import type { TerminalDropdownGroup } from './types';

interface TerminalPanelProps {
  onCollapse?: () => void;
  extraDropdownGroups?: TerminalDropdownGroup[];
  containerEnabled?: boolean;
}

const noop = () => {};

// RIGHT terminal — the Claude/agent terminal. Its scope (useTerminalScope)
// carries the `claude` command, and it owns the terminal:open/inject events.
// On desktop it's the ThreePanelLayout right panel; on mobile it's the
// MobileTerminalSheet opened from the header. The plain shell lives in
// BottomTerminalSplit (the BOTTOM terminal).
export function TerminalPanel({ onCollapse, extraDropdownGroups, containerEnabled }: TerminalPanelProps) {
  const scope = useTerminalScope();
  const scopeKey = scope.groupKey;

  return (
    <div className="flex flex-1 min-h-0 flex-col bg-[#0a0a0a]">
      <TerminalManager
        key={scopeKey}
        onCollapse={onCollapse ?? noop}
        defaultScope={scope}
        extraDropdownGroups={extraDropdownGroups}
        containerEnabled={containerEnabled}
        publishKey={scope.groupKey}
      />
    </div>
  );
}
