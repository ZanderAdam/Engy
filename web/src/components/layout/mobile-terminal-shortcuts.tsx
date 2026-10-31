'use client';

import { useShortcut } from '@/lib/shortcuts';
import { useMobileOverlay } from './mobile-overlay-context';

/** Phones have no terminal panels, so an external keyboard drives the overlays.
 * Must render inside a MobileOverlayProvider. */
export function MobileTerminalShortcuts() {
  const { overlay, openOverlay, closeOverlay } = useMobileOverlay();

  useShortcut('toggleTerminal', () =>
    overlay === 'terminal' ? closeOverlay() : openOverlay('terminal'),
  );
  useShortcut('toggleBottomTerminal', () =>
    overlay === 'shell' ? closeOverlay() : openOverlay('shell'),
  );

  return null;
}
