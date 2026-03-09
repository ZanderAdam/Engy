'use client';

import { useCallback } from 'react';
import { RiTerminalLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useSendToTerminal } from './use-send-to-terminal';

interface SendToTerminalButtonProps {
  getContent: () => string;
  className?: string;
}

export function SendToTerminalButton({ getContent, className }: SendToTerminalButtonProps) {
  const { sendToTerminal, terminalActive } = useSendToTerminal();

  const handleClick = useCallback(() => {
    sendToTerminal(getContent());
  }, [getContent, sendToTerminal]);

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClick}
            disabled={!terminalActive}
            className={className ?? 'h-6 w-6 p-0'}
          >
            <RiTerminalLine className="size-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Send comments to terminal</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
