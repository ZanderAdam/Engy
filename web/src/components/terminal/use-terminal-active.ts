'use client';

import { useState, useEffect } from 'react';
import { useTabId } from '@/components/tabs/tab-context';

declare global {
  interface Window {
    __engy_terminal_active?: boolean;
    __engy_terminal_active_by_tab?: Record<string, boolean>;
  }
}

interface TerminalActiveDetail {
  hasActiveTab: boolean;
  tabId?: string;
}

export function useTerminalActive(): boolean {
  const tabId = useTabId();
  const [hasActiveTab, setHasActiveTab] = useState(() => {
    if (typeof window === 'undefined') return false;
    // Seed from the per-tab map so a component mounting in an inactive tab
    // does not inherit another tab's active state.
    if (tabId === null) return window.__engy_terminal_active ?? false;
    return window.__engy_terminal_active_by_tab?.[tabId] ?? false;
  });

  useEffect(() => {
    function onActiveChanged(e: Event) {
      const detail = (e as CustomEvent<TerminalActiveDetail>).detail;
      if (detail.tabId !== undefined && detail.tabId !== tabId) return;
      setHasActiveTab(detail.hasActiveTab);
    }

    window.addEventListener('terminal:active-changed', onActiveChanged);
    return () => window.removeEventListener('terminal:active-changed', onActiveChanged);
  }, [tabId]);

  return hasActiveTab;
}
