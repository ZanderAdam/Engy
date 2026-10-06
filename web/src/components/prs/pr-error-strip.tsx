'use client';

import { RiAlertLine } from '@remixicon/react';
import { classifyPrRepoErrors, repoDisplayName } from './pr-errors';

export function PrErrorStrip({ repoErrors }: { repoErrors: Record<string, string> }) {
  const { global, perRepo } = classifyPrRepoErrors(repoErrors);

  if (global) {
    return (
      <div className="flex items-start gap-3 border-b border-amber-400/20 bg-amber-400/5 px-4 py-3 text-xs">
        <RiAlertLine className="mt-0.5 size-4 shrink-0 text-amber-400" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">Daemon not connected</p>
          <p className="text-muted-foreground">
            Start the Engy client daemon to fetch pull requests.
          </p>
        </div>
      </div>
    );
  }

  return perRepo.map((error) => (
    <div
      key={error.repo}
      className="flex items-start gap-3 border-b border-border bg-amber-400/5 px-4 py-2 text-xs"
    >
      <RiAlertLine className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
      <div className="min-w-0 space-y-0.5">
        <p className="truncate font-mono font-medium text-foreground">
          {repoDisplayName(error.repo)}
        </p>
        <p className="break-all font-mono text-muted-foreground">{error.message}</p>
      </div>
    </div>
  ));
}
