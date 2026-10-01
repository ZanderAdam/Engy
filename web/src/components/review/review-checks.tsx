'use client';

import { RiExternalLinkLine } from '@remixicon/react';
import { CheckIcon } from '@/components/prs/pr-badges';
import { summarizeChecks } from '@/components/prs/pr-helpers';
import type { GhPrCheck } from '@engy/common';

export function ReviewChecks({ checks }: { checks: GhPrCheck[] }) {
  if (checks.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-xs text-muted-foreground">No checks reported</p>
    );
  }
  const summary = summarizeChecks(checks);
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-4">
      <p className="mb-2 text-xs text-muted-foreground">
        {summary.passing}/{summary.total} passed
      </p>
      <ul className="divide-y divide-border border border-border">
        {checks.map((check, i) => (
          <li key={`${check.name}-${i}`} className="flex items-center gap-2 px-3 py-2">
            <CheckIcon status={check.status} conclusion={check.conclusion} />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{check.name}</span>
            <span className="shrink-0 text-xs capitalize text-muted-foreground">
              {(check.conclusion ?? check.status).replace(/_/g, ' ').toLowerCase()}
            </span>
            {check.detailsUrl && (
              <a
                href={check.detailsUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${check.name}`}
                className="text-muted-foreground hover:text-foreground"
              >
                <RiExternalLinkLine className="size-3.5" />
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
