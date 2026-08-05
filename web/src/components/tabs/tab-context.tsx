'use client';

import { createContext, useContext, useMemo } from 'react';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { parseVirtualPath, type Tab, type VirtualParams } from './tab-state';

export interface TabContextValue {
  tabId: string;
  virtualPath: string;
  isActive: boolean;
  pushVirtual: (path: string) => void;
  openNewTab: (path: string, activate?: boolean) => string;
}

export const TabContext = createContext<TabContextValue | null>(null);

export interface TabsListContextValue {
  tabs: Tab[];
  activeTabId: string | null;
  activateTab: (id: string) => void;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeTabsToRight: (id: string) => void;
  closeAllTabs: () => void;
  openNewTab: (path: string, activate?: boolean) => string;
}

export const TabsListContext = createContext<TabsListContextValue | null>(null);

export function useTabsList(): TabsListContextValue | null {
  return useContext(TabsListContext);
}

export function useOptionalTab(): TabContextValue | null {
  return useContext(TabContext);
}

export function useTabId(): string | null {
  const ctx = useContext(TabContext);
  return ctx?.tabId ?? null;
}

export function useVirtualPathname(): string {
  const ctx = useContext(TabContext);
  const pathname = usePathname();
  if (!ctx) return pathname;
  const idx = ctx.virtualPath.indexOf('?');
  return idx >= 0 ? ctx.virtualPath.slice(0, idx) : ctx.virtualPath;
}

export function useVirtualSearchParams(): URLSearchParams {
  const ctx = useContext(TabContext);
  const realParams = useSearchParams();
  return useMemo(() => {
    if (!ctx) return new URLSearchParams(realParams?.toString() ?? '');
    const idx = ctx.virtualPath.indexOf('?');
    return new URLSearchParams(idx >= 0 ? ctx.virtualPath.slice(idx + 1) : '');
  }, [ctx, realParams]);
}

export function useVirtualParams<T = VirtualParams>(): T {
  const ctx = useContext(TabContext);
  const rawParams = useParams<Record<string, string | string[] | undefined>>();
  return useMemo<T>(() => {
    if (ctx) {
      return parseVirtualPath(ctx.virtualPath) as T;
    }
    const result: VirtualParams = {};
    const workspace = rawParams?.workspace;
    const project = rawParams?.project;
    if (typeof workspace === 'string') result.workspace = workspace;
    if (typeof project === 'string') result.project = project;
    return result as T;
  }, [ctx, rawParams]);
}

export function useVirtualNavigate(): {
  push: (path: string) => void;
  openNewTab: (path: string, activate?: boolean) => void;
} {
  const ctx = useContext(TabContext);
  return useMemo(() => {
    if (ctx) {
      return {
        push: ctx.pushVirtual,
        openNewTab: (path, activate) => {
          ctx.openNewTab(path, activate);
        },
      };
    }
    return {
      push: (path: string) => {
        if (typeof window !== 'undefined') window.location.assign(path);
      },
      openNewTab: (path: string) => {
        if (typeof window !== 'undefined') window.open(path, '_blank', 'noopener');
      },
    };
  }, [ctx]);
}

