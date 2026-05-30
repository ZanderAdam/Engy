'use client';

import { useMemo } from 'react';
import { RiArrowUpSLine, RiArrowDownSLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { shortcutKeys, type ShortcutDef } from '@/components/layout/three-panel-layout';

const BOTTOM_TERMINAL_SHORTCUT: ShortcutDef = { ctrl: true, key: 'j' };

interface TerminalToggleButtonProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function TerminalToggleButton({ collapsed, onToggle }: TerminalToggleButtonProps) {
  const keys = useMemo(() => shortcutKeys(BOTTOM_TERMINAL_SHORTCUT), []);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            onClick={onToggle}
            aria-pressed={!collapsed}
            aria-label={collapsed ? 'Show terminal' : 'Collapse terminal'}
            className="h-9 w-9 p-0 shadow-md"
          >
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
