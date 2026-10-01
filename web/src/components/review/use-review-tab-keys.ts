'use client';

import { useEffect } from 'react';
import { useOptionalTab } from '@/components/tabs/tab-context';
import { isTypingTarget } from '@/lib/keyboard';
import { REVIEW_TABS, type ReviewTab } from './review-helpers';

export function useReviewTabKeys(onSelect: (tab: ReviewTab) => void): void {
  const isActive = useOptionalTab()?.isActive ?? true;

  useEffect(() => {
    if (!isActive) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isTypingTarget()) return;
      const tab = REVIEW_TABS.find((candidate) => candidate.key === e.key);
      if (!tab) return;
      e.preventDefault();
      onSelect(tab.value);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, onSelect]);
}
