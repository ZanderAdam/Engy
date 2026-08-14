'use client';

import { RiRestartLine } from '@remixicon/react';
import type { TerminalTab } from './types';

interface TerminalDormantPanelProps {
  tab: TerminalTab;
  onRestore: () => void;
}

/**
 * Placeholder for a session whose PTY died with the daemon while nobody was
 * attached. The tab survives so the session is not lost, but nothing is
 * respawned until the user asks: restoring starts a fresh PTY that resumes the
 * agent conversation, which is not something to do behind their back for every
 * terminal they ever left open.
 */
export function TerminalDormantPanel({ tab, onRestore }: TerminalDormantPanelProps) {
  const { scopeLabel, workingDir } = tab.scope;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="space-y-1">
        <p className="text-sm text-foreground">{tab.oscTitle ?? scopeLabel}</p>
        <p className="text-xs text-muted-foreground">
          Stopped when the daemon restarted &middot; {workingDir}
        </p>
      </div>
      <button
        onClick={onRestore}
        className="flex h-8 items-center gap-2 rounded border border-border px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <RiRestartLine className="size-3.5" />
        Restore session
      </button>
    </div>
  );
}
