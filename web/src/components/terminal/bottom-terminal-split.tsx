'use client';

import { useEffect, useCallback, useMemo, useRef } from 'react';
import { RiArrowUpSLine, RiArrowDownSLine } from '@remixicon/react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { matchShortcut, shortcutKeys, type ShortcutDef } from '@/components/layout/three-panel-layout';
import {
  useVerticalPanelResize,
  type VerticalPanelConfig,
} from '@/lib/hooks/use-vertical-panel-resize';
import { useBottomTerminalScope, deriveShellScope } from './use-terminal-scope';
import { TerminalManager } from './terminal-manager';
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
  const keys = useMemo(() => shortcutKeys(BOTTOM_TERMINAL_SHORTCUT), []);
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

  if (isMobile) {
    return <>{children}</>;
  }

  return (
    <div ref={containerRef} className="flex flex-1 min-h-0 flex-col overflow-hidden">
      {/* Page content */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">{children}</div>

      {/* Toggle bar — always visible */}
      <div className="flex items-center justify-end shrink-0">
        {/* Drag handle — inline with button */}
        {!collapsed && (
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
        )}

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCollapsed(!collapsed)}
                className="h-8 w-8 p-0"
              >
                {collapsed ? (
                  <RiArrowUpSLine className="size-4" />
                ) : (
                  <RiArrowDownSLine className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <span className="flex items-center gap-1.5">
                {collapsed ? 'Show terminal' : 'Collapse terminal'}
                <KbdGroup>
                  {keys.map((k, i) => (
                    <span key={k} className="flex items-center gap-0.5">
                      {i > 0 && <span className="text-[10px] opacity-60">+</span>}
                      <Kbd>{k}</Kbd>
                    </span>
                  ))}
                </KbdGroup>
              </span>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

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
  );
}
