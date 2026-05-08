'use client';

import { useState, useEffect } from 'react';
import { useTabId } from '@/components/tabs/tab-context';

declare global {
  interface Window {
    __engy_terminal_active?: boolean;
  }
}

interface TerminalActiveDetail {
  hasActiveTab: boolean;
  tabId?: string;
}

export function useTerminalActive(): boolean {
  const tabId = useTabId();
  const [hasActiveTab, setHasActiveTab] = useState(
    () => (typeof window !== 'undefined' ? window.__engy_terminal_active ?? false : false),
  );

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
