'use client';

import type { PointerEvent } from 'react';
import { RiArrowUpSLine, RiArrowDownSLine, RiPencilLine } from '@remixicon/react';
import { cn } from '@/lib/utils';

interface MobileTerminalControlsProps {
  onKey: (data: string) => void;
  onCompose: () => void;
}

interface ControlButton {
  id: string;
  label: string;
  ariaLabel: string;
  data: string;
  icon?: typeof RiArrowUpSLine;
}

export const MOBILE_TERMINAL_BUTTONS: ControlButton[] = [
  { id: 'esc', label: 'Esc', ariaLabel: 'Send Escape', data: '\x1b' },
  { id: '1', label: '1', ariaLabel: 'Send 1', data: '1' },
  { id: '2', label: '2', ariaLabel: 'Send 2', data: '2' },
  { id: '3', label: '3', ariaLabel: 'Send 3', data: '3' },
  { id: 'up', label: '↑', ariaLabel: 'Send Up Arrow', data: '\x1b[A', icon: RiArrowUpSLine },
  { id: 'down', label: '↓', ariaLabel: 'Send Down Arrow', data: '\x1b[B', icon: RiArrowDownSLine },
  { id: 'tab', label: 'Tab', ariaLabel: 'Send Tab', data: '\t' },
  { id: 'mode', label: 'Mode', ariaLabel: 'Send Shift+Tab', data: '\x1b[Z' },
  { id: 'enter', label: 'Enter', ariaLabel: 'Send Enter', data: '\r' },
];

const CONTROL_CLASS = cn(
  'h-9 w-10 flex items-center justify-center',
  'rounded text-xs font-medium text-zinc-200',
  'bg-zinc-800/80 active:bg-zinc-700',
  'select-none touch-manipulation',
);

export function MobileTerminalControls({ onKey, onCompose }: MobileTerminalControlsProps) {
  return (
    <div
      className="flex flex-col justify-end gap-1 shrink-0 p-1 border-l border-zinc-800 bg-zinc-900/80"
      role="toolbar"
      aria-label="Terminal keys"
    >
      {/* onClick, unlike the keys below: those suppress pointerdown to keep the
          terminal focused, whereas composing deliberately moves focus away. */}
      <button
        type="button"
        aria-label="Compose message"
        onClick={onCompose}
        className={cn(CONTROL_CLASS, 'mb-2 bg-zinc-700/80 text-zinc-100')}
      >
        <RiPencilLine className="size-4" aria-hidden />
      </button>
      {MOBILE_TERMINAL_BUTTONS.map((btn) => {
        const handlePointerDown = (e: PointerEvent<HTMLButtonElement>) => {
          e.preventDefault();
          onKey(btn.data);
        };
        const Icon = btn.icon;
        return (
          <button
            key={btn.id}
            type="button"
            aria-label={btn.ariaLabel}
            onPointerDown={handlePointerDown}
            className={CONTROL_CLASS}
          >
            {Icon ? <Icon className="size-4" aria-hidden /> : btn.label}
          </button>
        );
      })}
    </div>
  );
}
