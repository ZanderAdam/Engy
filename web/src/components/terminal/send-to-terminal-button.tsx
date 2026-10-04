'use client';

import { RiTerminalLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface SendToTerminalButtonProps {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

export function SendToTerminalButton({ onClick, disabled, className }: SendToTerminalButtonProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClick}
            disabled={disabled}
            aria-label="Send new comments to terminal"
            className={className ?? 'h-6 w-6 p-0'}
          >
            <RiTerminalLine className="size-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Send new comments to terminal</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
