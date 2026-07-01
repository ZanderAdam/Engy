'use client';

import { useTerminalScope } from './use-terminal-scope';
import { TerminalManager } from './terminal-manager';
import { CommandCenter } from './command-center/command-center';
import { useCommandCenterMode } from './command-center/use-command-center-mode';
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
//
// When Command Center mode is on, the global view overlays this panel while the
// project's TerminalManager stays mounted underneath — so terminal creation and
// the terminal:open/inject events keep working, and new terminals show up in the
// Command Center list immediately.
export function TerminalPanel({ onCollapse, extraDropdownGroups, containerEnabled }: TerminalPanelProps) {
  const scope = useTerminalScope();
  const scopeKey = scope.groupKey;
  const commandCenter = useCommandCenterMode();

  return (
    <div className="relative flex flex-1 min-h-0 flex-col bg-[#0a0a0a]">
      <TerminalManager
        key={scopeKey}
        onCollapse={onCollapse ?? noop}
        defaultScope={scope}
        extraDropdownGroups={extraDropdownGroups}
        containerEnabled={containerEnabled}
        publishKey={scope.groupKey}
      />
      {commandCenter && (
        <div className="absolute inset-0 z-10 flex flex-col bg-background">
          <CommandCenter />
        </div>
      )}
    </div>
  );
}
