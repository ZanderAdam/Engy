'use client';

import { useOptionalMobileOverlay } from '@/components/layout/mobile-overlay-context';
import { useBottomTerminal } from '@/components/layout/workspace-terminal-context';
import { useIsMobile } from '@/hooks/use-mobile';
import { TerminalToggleButton } from './terminal-toggle-button';

// Floating toggle for the BOTTOM terminal (plain shell), shown on both mobile
// and desktop. Desktop drives the BottomTerminalSplit collapsed state. Mobile
// drives the 'shell' overlay (MobileShellTerminalSheet) and only renders while
// that sheet is closed — the open sheet covers the screen and has its own
// close control. The mobile header opens the separate RIGHT (Claude) terminal.
export function BottomTerminalToggle() {
  const isMobile = useIsMobile();
  const bottom = useBottomTerminal();
  const overlay = useOptionalMobileOverlay();

  if (isMobile) {
    if (!overlay || overlay.overlay === 'shell') return null;
    return (
      <div className="fixed bottom-4 right-4 z-30">
        <TerminalToggleButton collapsed onToggle={() => overlay.openOverlay('shell')} />
      </div>
    );
  }

  if (!bottom) return null;
  return (
    <div className="fixed bottom-4 right-4 z-30">
      <TerminalToggleButton
        collapsed={bottom.collapsed}
        onToggle={() => bottom.setCollapsed(!bottom.collapsed)}
      />
    </div>
  );
}
