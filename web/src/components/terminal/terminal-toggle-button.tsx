'use client';

import { useMemo } from 'react';
import { RiArrowUpSLine, RiArrowDownSLine, RiTerminalLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { shortcutKeys, type ShortcutDef } from '@/components/layout/three-panel-layout';

const BOTTOM_TERMINAL_SHORTCUT: ShortcutDef = { ctrl: true, key: 'j' };

interface TerminalToggleButtonProps {
  collapsed: boolean;
  onToggle: () => void;
  variant?: 'floating' | 'inline';
}

export function TerminalToggleButton({
  collapsed,
  onToggle,
  variant = 'floating',
}: TerminalToggleButtonProps) {
  const keys = useMemo(() => shortcutKeys(BOTTOM_TERMINAL_SHORTCUT), []);

  if (variant === 'inline') {
    return (
      <Button
        variant="outline"
        size="icon-sm"
        aria-pressed={!collapsed}
        aria-label={collapsed ? 'Show terminal' : 'Collapse terminal'}
        onClick={onToggle}
      >
        <RiTerminalLine className="size-3.5" />
      </Button>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="sm" onClick={onToggle} className="h-8 w-8 p-0">
            {collapsed ? (
              <RiArrowUpSLine className="size-4" />
            ) : (
              <RiArrowDownSLine className="size-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <span className="flex items-center gap-1.5">
            {collapsed ? 'Show terminal' : 'Collapse terminal'}
            <KbdGroup>
              {keys.map((k, i) => (
                <span key={k} className="flex items-center gap-0.5">
                  {i > 0 && <span className="text-[10px] opacity-60">+</span>}
                  <Kbd>{k}</Kbd>
                </span>
              ))}
            </KbdGroup>
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
