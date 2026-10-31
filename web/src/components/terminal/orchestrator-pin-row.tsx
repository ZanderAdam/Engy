'use client';

import { RiRobot2Line } from '@remixicon/react';
import { cn } from '@/lib/utils';
import { useTabId } from '@/components/tabs/tab-context';
import { useOrchestratorPin } from './use-orchestrator-pin';

type OrchestratorPinVariant = 'row' | 'dot';

export function orchestratorStateLabel(session: {
  dormant?: boolean;
  activityState?: string;
  needsAttention?: boolean;
}): string {
  if (session.dormant) return 'dormant';
  if (session.needsAttention || session.activityState === 'waiting') return 'waiting';
  return session.activityState ?? 'idle';
}

export function pinVisibleInSheet(
  overlayKind: 'terminal' | 'shell',
  managerMounted: boolean,
): boolean {
  return overlayKind === 'terminal' && managerMounted;
}

export function OrchestratorPinRow({
  variant,
  activeId,
  onOpen,
}: {
  variant: OrchestratorPinVariant;
  activeId: string | null;
  onOpen?: () => void;
}) {
  const tabId = useTabId();
  const pin = useOrchestratorPin();
  if (!pin) return null;

  const { session, waitingCount } = pin;
  const active = activeId === session.sessionId;
  const name = session.renamedLabel ?? session.scopeLabel;
  const state = orchestratorStateLabel(session);
  const waitingText = waitingCount > 0 ? `, ${waitingCount} waiting for you` : '';

  function open() {
    onOpen?.();
    window.dispatchEvent(new CustomEvent('terminal:open-pinned', { detail: { session, tabId } }));
  }

  return (
    <button
      type="button"
      onClick={open}
      aria-label={`Orchestrator ${name}, ${state}${waitingText}`}
      aria-current={active || undefined}
      title={`Orchestrator: ${name} (${state})`}
      className={cn(
        'relative flex items-center rounded-sm border border-amber-400/40 text-amber-400 hover:bg-muted',
        variant === 'dot' ? 'size-6 justify-center' : 'w-full gap-2 px-2 py-1.5 text-left text-xs',
        active && 'bg-muted ring-1 ring-inset ring-amber-400/60',
      )}
    >
      <RiRobot2Line className="size-3.5 shrink-0" />
      {variant === 'row' && (
        <>
          <span className="min-w-0 flex-1 truncate text-foreground">{name}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{state}</span>
        </>
      )}
      {waitingCount > 0 && (
        <span
          data-testid="orchestrator-waiting-count"
          className={cn(
            'flex min-w-4 shrink-0 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-medium leading-4 text-black',
            variant === 'dot' && 'absolute -right-1 -top-1',
          )}
        >
          {waitingCount}
        </span>
      )}
    </button>
  );
}
