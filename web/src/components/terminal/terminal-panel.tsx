'use client';

import { useTerminalScope } from './use-terminal-scope';
import { TerminalManager } from './terminal-manager';
import type { TerminalDropdownGroup } from './types';

interface TerminalPanelProps {
  onCollapse?: () => void;
  extraDropdownGroups?: TerminalDropdownGroup[];
}

const noop = () => {};

export function TerminalPanel({ onCollapse, extraDropdownGroups }: TerminalPanelProps) {
  const scope = useTerminalScope();
  const scopeKey = `${scope.scopeType}:${scope.scopeLabel}`;

  return (
    <div className="flex flex-1 min-h-0 flex-col bg-[#0a0a0a]">
      <TerminalManager
        key={scopeKey}
        onCollapse={onCollapse ?? noop}
        defaultScope={scope}
        extraDropdownGroups={extraDropdownGroups}
      />
    </div>
  );
}
