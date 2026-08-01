'use client';

import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import {
  RiArrowUpSLine,
  RiArrowDownSLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiMoreLine,
} from '@remixicon/react';
import { cn } from '@/lib/utils';

interface MobileTerminalControlsProps {
  onKey: (data: string) => void;
  /** Compose overlay is up — the extra-key column must not be open over it. */
  composing?: boolean;
}

/**
 * Whether a pointer press landed outside the control area, and so should collapse
 * the extra-key column. A target that is not a `Node` (or a missing root) counts
 * as outside: there is nothing to prove it was ours.
 */
export function isOutsidePress(target: EventTarget | null, root: Node | null): boolean {
  if (!root || !(target instanceof Node)) return true;
  return !root.contains(target);
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

export const MOBILE_TERMINAL_EXTRA_BUTTONS: ControlButton[] = [
  { id: '4', label: '4', ariaLabel: 'Send 4', data: '4' },
  { id: '5', label: '5', ariaLabel: 'Send 5', data: '5' },
  { id: 'ctrl-c', label: '^C', ariaLabel: 'Send Ctrl+C', data: '\x03' },
  // Labelled ^V, never "Paste": the CLI reads the clipboard of the machine it
  // runs on, which is not the phone's.
  { id: 'ctrl-v', label: '^V', ariaLabel: 'Send Ctrl+V', data: '\x16' },
  { id: 'left', label: '←', ariaLabel: 'Send Left Arrow', data: '\x1b[D', icon: RiArrowLeftSLine },
  {
    id: 'right',
    label: '→',
    ariaLabel: 'Send Right Arrow',
    data: '\x1b[C',
    icon: RiArrowRightSLine,
  },
];

const EXTRA_KEYS_ID = 'mobile-terminal-extra-keys';

const KEY_BUTTON_CLASS = cn(
  'h-9 w-10 flex items-center justify-center',
  'rounded text-xs font-medium text-zinc-200',
  'select-none touch-manipulation',
);

function KeyButton({ btn, onKey }: { btn: ControlButton; onKey: (data: string) => void }) {
  const handlePointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    onKey(btn.data);
  };
  const Icon = btn.icon;
  return (
    <button
      type="button"
      aria-label={btn.ariaLabel}
      onPointerDown={handlePointerDown}
      className={cn(KEY_BUTTON_CLASS, 'bg-zinc-800/80 active:bg-zinc-700')}
    >
      {Icon ? <Icon className="size-4" aria-hidden /> : btn.label}
    </button>
  );
}

export function MobileTerminalControls({ onKey, composing = false }: MobileTerminalControlsProps) {
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // The composer is a modal over the same pane, and the rail sits outside the area
  // it covers. An open column would land on the composer's Send button and swallow
  // that tap, so compose suppresses the column outright — derived rather than
  // mirrored into state, and the toggle is disabled so it cannot be reopened.
  const open = expanded && !composing;

  // The column stays open across keypresses — several ← in a row is the point —
  // so only a press outside the whole control area closes it. Capture phase, and
  // deliberately not swallowed: the tap still reaches the terminal.
  useEffect(() => {
    if (!open) return;
    const collapse = (e: globalThis.PointerEvent) => {
      if (isOutsidePress(e.target, rootRef.current)) setExpanded(false);
    };
    document.addEventListener('pointerdown', collapse, true);
    return () => document.removeEventListener('pointerdown', collapse, true);
  }, [open]);

  const handleTogglePointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setExpanded((wasExpanded) => !wasExpanded);
  };

  return (
    <div
      ref={rootRef}
      className="relative flex flex-col justify-end gap-1 shrink-0 p-1 border-l border-zinc-800 bg-zinc-900/80"
      role="toolbar"
      aria-label="Terminal keys"
    >
      {/* Overlays the terminal rather than sharing the flex row: an inline column
          would shrink the pane and force a PTY resize on every open/close. */}
      {open && (
        <div
          id={EXTRA_KEYS_ID}
          className="absolute right-full bottom-1 z-20 flex flex-col gap-1 p-1 rounded-l border-y border-l border-zinc-800 bg-zinc-900/95 backdrop-blur-sm"
          role="group"
          aria-label="More terminal keys"
        >
          {MOBILE_TERMINAL_EXTRA_BUTTONS.map((btn) => (
            <KeyButton key={btn.id} btn={btn} onKey={onKey} />
          ))}
        </div>
      )}
      {/* Above Esc, not below Enter — appending would shift every existing key
          away from the thumb. */}
      <button
        type="button"
        aria-label="More keys"
        aria-expanded={open}
        aria-controls={EXTRA_KEYS_ID}
        disabled={composing}
        onPointerDown={handleTogglePointerDown}
        className={cn(
          KEY_BUTTON_CLASS,
          open ? 'bg-zinc-600 text-zinc-50' : 'bg-zinc-800/80 active:bg-zinc-700',
          'disabled:opacity-40',
        )}
      >
        <RiMoreLine className="size-4" aria-hidden />
      </button>
      {MOBILE_TERMINAL_BUTTONS.map((btn) => (
        <KeyButton key={btn.id} btn={btn} onKey={onKey} />
      ))}
    </div>
  );
}
