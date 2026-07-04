'use client';

import { useTerminalScope } from './use-terminal-scope';
import { TerminalManager } from './terminal-manager';
import {
  useCommandCenterMode,
  COMMAND_CENTER_GROUP_KEY,
} from './command-center/use-command-center-mode';
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
// Command Center mode flips this same dock into a global one (`global`): it
// lists every terminal across all projects/worktrees and publishes them to the
// rail under a shared key. Remounting on the toggle (via `key`) swaps the dock
// between the project's sessions and the global set cleanly.
export function TerminalPanel({ onCollapse, extraDropdownGroups, containerEnabled }: TerminalPanelProps) {
  const scope = useTerminalScope();
  const scopeKey = scope.groupKey;
  const commandCenter = useCommandCenterMode();

  return (
    <div className="flex flex-1 min-h-0 flex-col bg-[#0a0a0a]">
      <TerminalManager
        key={commandCenter ? COMMAND_CENTER_GROUP_KEY : scopeKey}
        onCollapse={onCollapse ?? noop}
        defaultScope={scope}
        extraDropdownGroups={extraDropdownGroups}
        containerEnabled={containerEnabled}
        publishKey={commandCenter ? COMMAND_CENTER_GROUP_KEY : scope.groupKey}
        global={commandCenter}
      />
    </div>
  );
}
