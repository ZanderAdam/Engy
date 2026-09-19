'use client';

import { RiAlertLine } from '@remixicon/react';
import { MAGNITUDE_COLOR } from './chart-palette';
import { formatMoneyCompact } from './format';
import type { UsageCacheEfficiency, UsageSessionRow } from './types';

const MAX_FLAGGED = 6;

interface CacheTtlPanelProps {
  efficiency: UsageCacheEfficiency;
  sessions: UsageSessionRow[];
  onSelectSession: (sessionId: string) => void;
}

function Meter({ value, breakEven }: { value: number; breakEven: number }) {
  const scale = Math.max(breakEven * 2, value * 1.1, 1);
  const fill = Math.min((value / scale) * 100, 100);
  const marker = Math.min((breakEven / scale) * 100, 100);

  return (
    <div className="relative h-3 w-full bg-muted">
      <div className="h-full" style={{ width: `${fill}%`, backgroundColor: MAGNITUDE_COLOR }} />
      <div
        className="absolute inset-y-0 w-0.5 bg-foreground"
        style={{ left: `${marker}%` }}
        aria-hidden
      />
    </div>
  );
}

export function CacheTtlPanel({ efficiency, sessions, onSelectSession }: CacheTtlPanelProps) {
  const { readsPerWrite, breakEven } = efficiency;
  const healthy = readsPerWrite >= breakEven;
  const flagged = sessions
    .filter((s) => s.readsPerWrite > 0 && s.readsPerWrite < breakEven)
    .sort((a, b) => b.costCents - a.costCents);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-3xl font-medium leading-none tabular-nums">
          {readsPerWrite.toFixed(2)}×
        </span>
        <span className="text-xs text-muted-foreground">
          realized cache reads per write · break-even {breakEven.toFixed(2)}×
        </span>
      </div>

      <Meter value={readsPerWrite} breakEven={breakEven} />

      <p className="text-xs text-muted-foreground">
        {healthy
          ? 'Cache writes are read back often enough to pay for themselves.'
          : 'Cache writes are expiring before they are read back often enough to pay for themselves.'}
      </p>

      {flagged.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <div className="flex items-center gap-1.5 text-xs">
            <RiAlertLine className="size-3.5 text-[#fab219]" />
            <span className="text-foreground">
              {flagged.length} {flagged.length === 1 ? 'session is' : 'sessions are'} below
              break-even
            </span>
          </div>
          <ul className="flex flex-col gap-1">
            {flagged.slice(0, MAX_FLAGGED).map((session) => (
              <li key={session.sessionId}>
                <button
                  type="button"
                  onClick={() => onSelectSession(session.sessionId)}
                  className="flex w-full cursor-pointer items-baseline justify-between gap-3 text-left text-xs transition-colors hover:text-foreground"
                >
                  <span className="truncate text-muted-foreground">{session.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {session.readsPerWrite.toFixed(2)}× · {formatMoneyCompact(session.costCents)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {flagged.length > MAX_FLAGGED && (
            <span className="text-xs text-muted-foreground">
              +{flagged.length - MAX_FLAGGED} more
            </span>
          )}
        </div>
      )}
    </div>
  );
}
