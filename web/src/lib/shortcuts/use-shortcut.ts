'use client';

import { useEffect, useRef } from 'react';
import { useOptionalTab } from '@/components/tabs/tab-context';
import { registerShortcut } from './dispatcher';
import type { ShortcutId } from './registry';

/** Every workspace tab stays mounted, so a handler counts only while its tab
 * is on screen. */
export function useShortcut(id: ShortcutId, handler: () => void, enabled = true): void {
  const isActive = useOptionalTab()?.isActive ?? true;
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });

  useEffect(() => {
    if (!enabled || !isActive) return;
    return registerShortcut(id, () => latest.current());
  }, [id, enabled, isActive]);
}
