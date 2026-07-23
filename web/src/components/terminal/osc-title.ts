import { sanitizeOscTitle } from '@/lib/osc-title';
import type { TerminalTab } from './types';

/**
 * Apply an OSC title update to a tab. Returns the updated tab, or null when
 * the title is unchanged after sanitization so callers can skip redundant
 * re-renders.
 */
export function applyOscTitle(tab: TerminalTab, rawTitle: string): TerminalTab | null {
  const oscTitle = sanitizeOscTitle(rawTitle) || undefined;
  if (tab.oscTitle === oscTitle) return null;
  return { ...tab, oscTitle };
}
