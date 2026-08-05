'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { RiAddLine, RiArrowDownSLine, RiCloseLine, RiGitBranchLine } from '@remixicon/react';
import { cn } from '@/lib/utils';
import { isTypingTarget } from '@/lib/keyboard';
import { HeaderActions } from '@/components/header-actions';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { OpenTabsPicker } from './open-tabs-picker';
import {
  TabContext,
  TabsListContext,
  type TabContextValue,
  type TabsListContextValue,
} from './tab-context';
import { useIsMobile } from '@/hooks/use-mobile';
import { TabContent } from './tab-content';
import {
  closeOtherTabs,
  closeTabsToRight,
  collapseToFreshTab,
  computeInitialTabs,
  deriveDefaultTitle,
  deriveTabTitle,
  findReusableProjectTab,
  loadPersisted,
  makeTab,
  navigateOrReuseTab,
  navigateTab,
  normalizeVirtualPath,
  parseVirtualPath,
  savePersisted,
  type Tab,
  type TabsState,
} from './tab-state';
import { ProjectActivityBadge } from '@/components/projects/project-activity-badge';

const PERSIST_DEBOUNCE_MS = 200;

const SUBSCRIBE_NOOP = () => () => {};

function useIsClient(): boolean {
  return useSyncExternalStore(
    SUBSCRIBE_NOOP,
    () => true,
    () => false,
  );
}

export function TabShell() {
  const isClient = useIsClient();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchString = searchParams?.toString() ?? '';
  const initialUrlPath = normalizeVirtualPath(
    searchString ? `${pathname}?${searchString}` : pathname,
  );

  if (!isClient) {
    return (
      <>
        <div className="flex h-11 shrink-0 items-stretch border-b border-border bg-background">
          <div className="flex-1" />
          <div className="w-20" aria-hidden />
        </div>
        <div className="flex flex-1 flex-col min-h-0" />
      </>
    );
  }
  return <TabShellClient initialUrlPath={initialUrlPath} />;
}

interface TabShellClientProps {
  initialUrlPath: string;
}

interface HistoryState {
  engy: true;
  tabId: string;
  virtualPath: string;
}

function TabShellClient({ initialUrlPath }: TabShellClientProps) {
  const [state, setState] = useState<TabsState>(() =>
    computeInitialTabs(initialUrlPath, loadPersisted()?.tabs ?? []),
  );
  const { tabs, activeTabId } = state;
  const isMobile = useIsMobile();

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId],
  );

  // Last `{tabId}::{virtualPath}` we wrote to history. Used to skip writes that
  // originate from a popstate-driven state restore (we already are in sync).
  const lastWrittenRef = useRef<string | null>(null);
  // When set, the next history write replaces instead of pushing — closing a
  // tab swaps the URL without leaving a back-stack entry to the closed tab.
  const replaceNextRef = useRef(false);

  useEffect(() => {
    if (!activeTab) return;
    if (typeof window === 'undefined') return;

    const target = activeTab.virtualPath;
    document.title = `engy:${deriveDefaultTitle(target)}`;

    const key = `${activeTab.id}::${target}`;
    if (lastWrittenRef.current === key) return;

    const isFirstRun = lastWrittenRef.current === null;
    const shouldReplace = isFirstRun || replaceNextRef.current;
    replaceNextRef.current = false;
    lastWrittenRef.current = key;

    const historyState: HistoryState = {
      engy: true,
      tabId: activeTab.id,
      virtualPath: target,
    };
    if (shouldReplace) {
      window.history.replaceState(historyState, '', target);
    } else {
      window.history.pushState(historyState, '', target);
    }
  }, [activeTab]);

  useEffect(() => {
    function onPop(e: PopStateEvent) {
      const s = e.state as HistoryState | null;
      if (!s || s.engy !== true) return;
      setState((prev) => {
        const target = prev.tabs.find((t) => t.id === s.tabId);
        if (!target) return prev;
        lastWrittenRef.current = `${s.tabId}::${s.virtualPath}`;
        return {
          tabs: prev.tabs.map((t) =>
            t.id === s.tabId
              ? {
                  ...t,
                  virtualPath: s.virtualPath,
                  title: deriveDefaultTitle(s.virtualPath),
                  lastActiveAt: Date.now(),
                }
              : t,
          ),
          activeTabId: s.tabId,
        };
      });
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      savePersisted({ tabs, activeTabId });
    }, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [tabs, activeTabId]);

  const updateTabPath = useCallback((tabId: string, rawPath: string) => {
    const path = normalizeVirtualPath(rawPath);
    setState((s) => navigateOrReuseTab(s, tabId, path));
  }, []);

  const openNewTab = useCallback((rawPath: string, activate = true): string => {
    const path = normalizeVirtualPath(rawPath);
    const newTab = makeTab(path);
    let openedId = newTab.id;
    setState((s) => {
      const existing = findReusableProjectTab(s.tabs, path);
      if (existing) {
        openedId = existing.id;
        // Background opens must not disturb the visible tab — only re-point the
        // reused tab to the requested section when we're actually focusing it.
        if (!activate) return s;
        return { tabs: navigateTab(s.tabs, existing.id, path), activeTabId: existing.id };
      }
      return {
        tabs: [...s.tabs, newTab],
        activeTabId: activate ? newTab.id : s.activeTabId,
      };
    });
    return openedId;
  }, []);

  const activateTab = useCallback((id: string) => {
    setState((s) => {
      if (id === s.activeTabId) return s;
      if (!s.tabs.find((t) => t.id === id)) return s;
      return {
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, lastActiveAt: Date.now() } : t)),
        activeTabId: id,
      };
    });
  }, []);

  const closeTab = useCallback((id: string) => {
    setState((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      if (idx < 0) return s;
      const closingActive = s.activeTabId === id;
      const remaining = s.tabs.filter((t) => t.id !== id);
      if (remaining.length === 0) {
        replaceNextRef.current = true;
        return collapseToFreshTab();
      }
      if (closingActive) {
        const next = remaining[Math.min(idx, remaining.length - 1)];
        replaceNextRef.current = true;
        return { tabs: remaining, activeTabId: next.id };
      }
      return { tabs: remaining, activeTabId: s.activeTabId };
    });
  }, []);

  const closeOthers = useCallback((id: string) => {
    setState((s) => {
      const next = closeOtherTabs(s, id);
      if (next !== s) replaceNextRef.current = true;
      return next;
    });
  }, []);

  const closeToRight = useCallback((id: string) => {
    setState((s) => {
      const next = closeTabsToRight(s, id);
      if (next !== s) replaceNextRef.current = true;
      return next;
    });
  }, []);

  const closeAllTabs = useCallback(() => {
    setState(() => {
      replaceNextRef.current = true;
      return collapseToFreshTab();
    });
  }, []);

  const latest = useRef({ tabs, activeTabId, openNewTab, activateTab, closeTab });
  useEffect(() => {
    latest.current = { tabs, activeTabId, openNewTab, activateTab, closeTab };
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      // The letter combos collide with readline bindings a focused terminal or
      // input needs (Ctrl+W deletes a word, Ctrl+T transposes), so they yield
      // while typing. Arrow switching has no such collision and stays global.
      const typing = isTypingTarget();

      if (e.key === 't' && !e.altKey && !e.shiftKey) {
        if (typing) return;
        e.preventDefault();
        latest.current.openNewTab('/');
        return;
      }

      // Matched on `code` so the Option key's macOS character remapping (W → ∑)
      // can't hide it: Cmd+W is reserved by the browser in a plain tab and
      // never reaches us there, but Cmd+Alt+W always does — and it mirrors the
      // Cmd+Alt+Arrow switching already bound below.
      if (e.code === 'KeyW' && !e.shiftKey) {
        const { activeTabId: aid } = latest.current;
        if (typing || !aid) return;
        e.preventDefault();
        latest.current.closeTab(aid);
        return;
      }

      if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        const { tabs: ts, activeTabId: aid } = latest.current;
        if (ts.length <= 1) return;
        e.preventDefault();
        const idx = ts.findIndex((t) => t.id === aid);
        if (idx < 0) return;
        const delta = e.key === 'ArrowRight' ? 1 : -1;
        const next = ts[(idx + delta + ts.length) % ts.length];
        latest.current.activateTab(next.id);
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const tabsListValue = useMemo<TabsListContextValue>(
    () => ({
      tabs,
      activeTabId,
      activateTab,
      closeTab,
      closeOtherTabs: closeOthers,
      closeTabsToRight: closeToRight,
      closeAllTabs,
      openNewTab,
    }),
    [tabs, activeTabId, activateTab, closeTab, closeOthers, closeToRight, closeAllTabs, openNewTab],
  );

  return (
    <TabsListContext.Provider value={tabsListValue}>
      {!isMobile && (
        <TabStrip
          tabs={tabs}
          activeTabId={activeTabId}
          onActivate={activateTab}
          onClose={closeTab}
          onCloseOthers={closeOthers}
          onCloseToRight={closeToRight}
          onCloseAll={closeAllTabs}
          onNew={() => openNewTab('/')}
        />
      )}
      <div className="flex flex-1 flex-col min-h-0">
        {tabs.map((tab) => (
          <TabPanel
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onPushVirtual={(path) => updateTabPath(tab.id, path)}
            onOpenNewTab={openNewTab}
          />
        ))}
      </div>
    </TabsListContext.Provider>
  );
}

interface TabPanelProps {
  tab: Tab;
  isActive: boolean;
  onPushVirtual: (path: string) => void;
  onOpenNewTab: (path: string, activate?: boolean) => string;
}

function TabPanel({ tab, isActive, onPushVirtual, onOpenNewTab }: TabPanelProps) {
  const ctxValue = useMemo<TabContextValue>(
    () => ({
      tabId: tab.id,
      virtualPath: tab.virtualPath,
      isActive,
      pushVirtual: onPushVirtual,
      openNewTab: onOpenNewTab,
    }),
    [tab.id, tab.virtualPath, isActive, onPushVirtual, onOpenNewTab],
  );

  return (
    <div
      role="tabpanel"
      aria-hidden={!isActive}
      className={cn('flex flex-col min-h-0', isActive ? 'flex-1' : 'hidden')}
    >
      <TabContext.Provider value={ctxValue}>
        <TabContent virtualPath={tab.virtualPath} />
      </TabContext.Provider>
    </div>
  );
}

interface TabStripProps {
  tabs: Tab[];
  activeTabId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseToRight: (id: string) => void;
  onCloseAll: () => void;
  onNew: () => void;
}

function TabStrip({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
  onNew,
}: TabStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Build a map of derived title → count so duplicate tabs get ordinal suffixes.
  // When count > 1, all duplicates get a suffix: (1), (2), etc.
  const titleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tab of tabs) {
      const base = deriveDefaultTitle(tab.virtualPath);
      counts.set(base, (counts.get(base) ?? 0) + 1);
    }
    return counts;
  }, [tabs]);
  const titleOrdinals = new Map<string, number>();

  return (
    <div
      className="flex h-11 shrink-0 items-stretch border-b border-border bg-background"
      role="tablist"
      aria-label="Workspace tabs"
    >
      <div
        ref={scrollRef}
        className="flex flex-1 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const { segments, worktree } = deriveTabTitle(tab.virtualPath);
          const projectSlug = parseVirtualPath(tab.virtualPath).project;
          const base = deriveDefaultTitle(tab.virtualPath);
          const isDuplicate = (titleCounts.get(base) ?? 0) > 1;
          let ordinalSuffix = '';
          if (isDuplicate) {
            const ordinal = (titleOrdinals.get(base) ?? 0) + 1;
            titleOrdinals.set(base, ordinal);
            ordinalSuffix = ` (${ordinal})`;
          }
          const isLast = tab.id === tabs[tabs.length - 1].id;
          return (
            <ContextMenu key={tab.id}>
              <ContextMenuTrigger asChild>
                <div
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={0}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('[data-tab-close]')) return;
                    onActivate(tab.id);
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      onClose(tab.id);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onActivate(tab.id);
                    }
                  }}
                  title={tab.virtualPath}
                  className={cn(
                    'group flex min-w-0 shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-3 text-xs transition-all',
                    isActive
                      ? 'bg-secondary text-foreground shadow-[inset_0_-1px_0_0_var(--foreground)]'
                      : 'text-muted-foreground/50 opacity-60 hover:bg-muted/40 hover:text-foreground hover:opacity-100',
                  )}
                >
                  <span className="flex min-w-0 max-w-[22rem] flex-col justify-center gap-0.5 py-1">
                    <span className="flex items-center gap-1 truncate leading-tight">
                      {segments.map((seg, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && (
                            <span className={isActive ? 'text-muted-foreground/60' : 'opacity-60'}>
                              ›
                            </span>
                          )}
                          <span
                            className={cn(
                              'truncate',
                              i === segments.length - 1
                                ? isActive
                                  ? 'font-semibold text-foreground'
                                  : 'font-semibold'
                                : isActive
                                  ? 'text-muted-foreground'
                                  : '',
                            )}
                          >
                            {seg}
                            {i === segments.length - 1 && ordinalSuffix && (
                              <span className="font-normal text-muted-foreground">
                                {ordinalSuffix}
                              </span>
                            )}
                          </span>
                        </span>
                      ))}
                    </span>
                    {worktree ? (
                      <span
                        className={cn(
                          'flex items-center gap-0.5 font-mono text-[9px] leading-none',
                          isActive ? 'text-muted-foreground' : 'text-muted-foreground/70',
                        )}
                        title={`Worktree: ${worktree}`}
                      >
                        <RiGitBranchLine className="size-2.5" />
                        <span className="max-w-[10rem] truncate">{worktree}</span>
                      </span>
                    ) : (
                      <span aria-hidden className="h-2.5" />
                    )}
                  </span>
                  <ProjectActivityBadge projectSlug={projectSlug} className="shrink-0" />
                  <button
                    type="button"
                    aria-label={`Close ${tab.title}`}
                    data-tab-close
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose(tab.id);
                    }}
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded transition-opacity hover:bg-background',
                      isActive
                        ? 'opacity-60 hover:opacity-100'
                        : 'opacity-0 group-hover:opacity-60',
                    )}
                  >
                    <RiCloseLine className="size-3" />
                  </button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="min-w-48">
                <ContextMenuItem onSelect={() => onClose(tab.id)}>
                  Close
                  {isActive && <ContextMenuShortcut>⌥⌘W</ContextMenuShortcut>}
                </ContextMenuItem>
                <ContextMenuItem disabled={tabs.length <= 1} onSelect={() => onCloseOthers(tab.id)}>
                  Close others
                </ContextMenuItem>
                <ContextMenuItem disabled={isLast} onSelect={() => onCloseToRight(tab.id)}>
                  Close tabs to the right
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem disabled={tabs.length <= 1} onSelect={onCloseAll}>
                  Close all tabs
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
        <button
          type="button"
          onClick={onNew}
          aria-label="New tab"
          className="flex size-9 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          <RiAddLine className="size-4" />
        </button>
      </div>
      <OpenTabsPicker align="end">
        <button
          type="button"
          aria-label="Open tabs"
          className="flex shrink-0 items-center gap-0.5 border-l border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          <span className="tabular-nums">{tabs.length}</span>
          <RiArrowDownSLine className="size-3.5" />
        </button>
      </OpenTabsPicker>
      <HeaderActions />
    </div>
  );
}
