import { useSyncExternalStore } from 'react';

interface ViewportMetrics {
  height: number;
  offsetTop: number;
}

/**
 * Pixels the on-screen keyboard covers at the bottom of the window.
 *
 * Reads 0 whenever the browser honours `interactive-widget: resizes-content`
 * (set globally in `app/layout.tsx`), because there the layout viewport shrinks
 * with the keyboard and `windowHeight` has already accounted for it. The
 * non-zero case is the fallback: engines that ignore that hint — notably iOS
 * Safari before 17.4 — shrink only the visual viewport, leaving the difference
 * as keyboard.
 */
export function keyboardInsetOf(windowHeight: number, viewport: ViewportMetrics): number {
  return Math.max(0, Math.round(windowHeight - viewport.height - viewport.offsetTop));
}

function subscribe(callback: () => void): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  viewport.addEventListener('resize', callback);
  viewport.addEventListener('scroll', callback);
  return () => {
    viewport.removeEventListener('resize', callback);
    viewport.removeEventListener('scroll', callback);
  };
}

function getSnapshot(): number {
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  return keyboardInsetOf(window.innerHeight, viewport);
}

function getServerSnapshot(): number {
  return 0;
}

/**
 * How much to pad a bottom-anchored control by to keep it above the keyboard.
 *
 * Measured against the bottom of the *window*, so callers must themselves be
 * anchored there. A caller whose own bottom edge sits higher is over-padded
 * rather than under-padded — safe, never hidden.
 */
export function useKeyboardInset(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
