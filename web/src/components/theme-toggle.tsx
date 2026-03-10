'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { useThemeFlavor } from './theme-provider';
import { RiSunLine, RiMoonLine, RiPaletteLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const { flavor, setFlavor } = useThemeFlavor();
  const [mounted, setMounted] = useState(false);
  const isCyberpunk = flavor === 'cyberpunk';
  const isDark = resolvedTheme === 'dark';

  // Needed to avoid hydration mismatch with next-themes
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return <div className="flex items-center gap-1 w-14" />;

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              disabled={isCyberpunk}
              aria-label="Toggle light/dark mode"
            >
              {isDark ? (
                <RiSunLine className="size-4" />
              ) : (
                <RiMoonLine className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {isCyberpunk ? 'Dark mode only in Cyberpunk' : 'Toggle light/dark mode'}
          </TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label="Select theme">
                  <RiPaletteLine className="size-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">Theme</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={flavor}
              onValueChange={(v) => setFlavor(v as 'default' | 'cyberpunk')}
            >
              <DropdownMenuRadioItem value="default">Default</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="cyberpunk">Cyberpunk</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </TooltipProvider>
  );
}
