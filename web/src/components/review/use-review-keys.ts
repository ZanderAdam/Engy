'use client';

import { useEffect, useRef } from 'react';
import { useOptionalTab } from '@/components/tabs/tab-context';
import { isTypingTarget } from '@/lib/keyboard';

export type ReviewKeyAction =
  | 'nextFile'
  | 'prevFile'
  | 'nextThread'
  | 'prevThread'
  | 'toggleViewed'
  | 'toggleSplit';

type KeyInput = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>;

const PLAIN_KEYS: Record<string, ReviewKeyAction> = {
  ']': 'nextFile',
  '[': 'prevFile',
  n: 'nextThread',
  p: 'prevThread',
  v: 'toggleViewed',
};

const OVERLAY_SELECTOR =
  '[role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]';

export function isInsideOverlay(el: Pick<Element, 'closest'> | null): boolean {
  return el?.closest(OVERLAY_SELECTOR) != null;
}

export function reviewKeyAction(e: KeyInput): ReviewKeyAction | null {
  if (e.altKey) return null;
  if (e.metaKey || e.ctrlKey) {
    return !e.shiftKey && e.key.toLowerCase() === 'b' ? 'toggleSplit' : null;
  }
  if (e.shiftKey) return null;
  return PLAIN_KEYS[e.key] ?? null;
}

export function useReviewKeys(enabled: boolean, onAction: (action: ReviewKeyAction) => void): void {
  const isActive = useOptionalTab()?.isActive ?? true;
  const handler = useRef(onAction);
  useEffect(() => {
    handler.current = onAction;
  });

  useEffect(() => {
    if (!isActive || !enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (isTypingTarget() || isInsideOverlay(document.activeElement)) return;
      const action = reviewKeyAction(e);
      if (!action) return;
      e.preventDefault();
      handler.current(action);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, enabled]);
}
