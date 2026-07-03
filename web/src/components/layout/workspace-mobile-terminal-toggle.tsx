'use client';

import { RiTerminalLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { useMobileOverlay } from './mobile-overlay-context';

// Opens the RIGHT terminal (Claude/agent) overlay on mobile workspace pages.
// The project layout exposes this via MobileHeader; the workspace section nav
// has no MobileHeader, so it hosts this toggle directly. Must render inside a
// MobileOverlayProvider (the workspace layout wraps its content in one on mobile).
export function WorkspaceMobileTerminalToggle() {
  const { overlay, openOverlay, closeOverlay } = useMobileOverlay();
  return (
    <Button
      variant="outline"
      size="icon-sm"
      aria-pressed={overlay === 'terminal'}
      onClick={() => (overlay === 'terminal' ? closeOverlay() : openOverlay('terminal'))}
      aria-label="Toggle Claude terminal"
    >
      <RiTerminalLine className="size-3.5" />
    </Button>
  );
}
