'use client';

import { useEffect, useCallback, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';
import { matchShortcut, type ShortcutDef } from '@/components/layout/three-panel-layout';
import { BottomTerminalProvider } from '@/components/layout/workspace-terminal-context';
import {
  useVerticalPanelResize,
  type VerticalPanelConfig,
} from '@/lib/hooks/use-vertical-panel-resize';
import { useBottomTerminalScope, deriveShellScope } from './use-terminal-scope';
import { TerminalManager } from './terminal-manager';
import { BottomTerminalToggle } from './bottom-terminal-toggle';
import type { TerminalDropdownGroup } from './types';

const BOTTOM_TERMINAL_SHORTCUT: ShortcutDef = { ctrl: true, key: 'j' };

const BOTTOM_TERMINAL_CONFIG: VerticalPanelConfig = {
  defaultHeight: 240,
  minHeight: 120,
  maxHeightPercent: 70,
  storageKey: 'engy-bottom-terminal-height',
};

const COLLAPSED_STORAGE_KEY = 'engy-bottom-terminal-expanded';

function toShellDropdownGroups(
  groups: TerminalDropdownGroup[] | undefined,
): TerminalDropdownGroup[] | undefined {
  if (!groups) return undefined;
  return groups.map((group) => ({
    ...group,
    label: group.label?.replace('Claude in', 'Shell in'),
    entries: group.entries.map((entry) => ({
      ...entry,
      label: entry.label.replace('claude: ', ''),
      scope: deriveShellScope(entry.scope),
    })),
  }));
}

interface BottomTerminalSplitProps {
  children: React.ReactNode;
  isMobile?: boolean;
  extraDropdownGroups?: TerminalDropdownGroup[];
  containerEnabled?: boolean;
}

// BOTTOM terminal — the plain shell terminal that docks under the page
// content. Its scope (deriveShellScope) has no `claude` command, and it opts
// out of the terminal:open/inject events (the RIGHT/Claude TerminalPanel owns
// those). Toggled by the floating BottomTerminalToggle on desktop; on mobile
// it surfaces as the MobileShellTerminalSheet. Returns just `children` on
// mobile (the inline dock is desktop-only).
export function BottomTerminalSplit({
  children,
  isMobile = false,
  extraDropdownGroups,
  containerEnabled,
}: BottomTerminalSplitProps) {
  const { height, collapsed, isResizing, setCollapsed, handleMouseDown, containerRef } =
    useVerticalPanelResize(BOTTOM_TERMINAL_CONFIG);

  const scope = useBottomTerminalScope();
  const scopeKey = scope.groupKey;
  const shellDropdownGroups = useMemo(
    () => toShellDropdownGroups(extraDropdownGroups),
    [extraDropdownGroups],
  );
  const mountedRef = useRef(false);

  // Restore expanded state on mount
  useEffect(() => {
    const stored = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (stored === 'true') setCollapsed(false);
    mountedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist expanded state (skip first render to avoid overwriting stored value)
  useEffect(() => {
    if (!mountedRef.current) return;
    localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? 'false' : 'true');
  }, [collapsed]);

  // Keyboard shortcut: Ctrl+J
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const isEditing =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement ||
        document.activeElement?.closest('[contenteditable="true"]') !== null;

      if (isEditing) return;

      if (matchShortcut(BOTTOM_TERMINAL_SHORTCUT, e)) {
        e.preventDefault();
        setCollapsed(!collapsed);
      }
    }

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [collapsed, setCollapsed]);

  const handleCollapse = useCallback(() => {
    setCollapsed(true);
  }, [setCollapsed]);

  const ctxValue = useMemo(() => ({ collapsed, setCollapsed }), [collapsed, setCollapsed]);

  if (isMobile) {
    return (
      <BottomTerminalProvider value={ctxValue}>
        {children}
        <BottomTerminalToggle />
      </BottomTerminalProvider>
    );
  }

  return (
    <BottomTerminalProvider value={ctxValue}>
      <div ref={containerRef} className="flex flex-1 min-h-0 flex-col overflow-hidden">
        {/* Page content */}
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">{children}</div>

        <BottomTerminalToggle />

        {/* Drag handle — only visible when expanded */}
        {!collapsed && (
          <div className="flex items-center shrink-0">
            <div
              role="separator"
              aria-orientation="horizontal"
              className={cn(
                'flex-1 h-1 bg-border hover:bg-blue-500 cursor-row-resize transition-colors',
                isResizing && 'bg-blue-500',
              )}
              onMouseDown={handleMouseDown}
              onDoubleClick={() => setCollapsed(true)}
              title="Drag to resize terminal"
            />
          </div>
        )}

        {/* Terminal — hidden when collapsed to preserve live connections */}
        <div
          className="flex flex-col min-h-0 shrink-0 bg-[#0a0a0a]"
          style={{
            height: collapsed ? 0 : height,
            overflow: collapsed ? 'hidden' : undefined,
            visibility: collapsed ? 'hidden' : undefined,
          }}
        >
          <TerminalManager
            key={scopeKey}
            onCollapse={handleCollapse}
            defaultScope={scope}
            extraDropdownGroups={shellDropdownGroups}
            containerEnabled={containerEnabled}
            disableExternalEvents
          />
        </div>
      </div>
    </BottomTerminalProvider>
  );
}
