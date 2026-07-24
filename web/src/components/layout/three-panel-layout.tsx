'use client';

import { useEffect, useCallback, useMemo } from 'react';
import { RiArrowLeftSLine, RiArrowRightSLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useOptionalMobileOverlay } from './mobile-overlay-context';
import { MobileFilesSheet } from './mobile-files-sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { usePanelResize, type PanelConfig } from '@/lib/hooks/use-panel-resize';

export interface ShortcutDef {
  mod?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  key: string;
}

export function matchShortcut(def: ShortcutDef, e: KeyboardEvent): boolean {
  if (def.mod && !(e.metaKey || e.ctrlKey)) return false;
  if (def.ctrl && !e.ctrlKey) return false;
  if (def.shift && !e.shiftKey) return false;
  return e.key === def.key || e.key.toLowerCase() === def.key.toLowerCase();
}

export function shortcutKeys(def: ShortcutDef): string[] {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
  const keys: string[] = [];
  if (def.mod) keys.push(isMac ? '⌘' : 'Ctrl');
  if (def.ctrl) keys.push(isMac ? '⌃' : 'Ctrl');
  if (def.shift) keys.push(isMac ? '⇧' : 'Shift');
  keys.push(def.key.toUpperCase());
  return keys;
}

export const DEFAULT_LEFT_SHORTCUT: ShortcutDef = { mod: true, shift: true, key: ',' };
export const DEFAULT_RIGHT_SHORTCUT: ShortcutDef = { mod: true, shift: true, key: '.' };

interface ThreePanelLayoutProps {
  left?: PanelConfig;
  right?: PanelConfig;
  leftContent?: React.ReactNode;
  centerContent: React.ReactNode;
  rightContent?: React.ReactNode;
  // Rendered immediately left of the right panel (desktop), receiving the
  // panel's collapse state so it can own the collapse control. Because it sits
  // before the collapsible panel, it lands at the screen edge when that panel
  // collapses to zero width — no repositioning logic needed. When provided, the
  // legacy collapse-button column is replaced by a bare resize handle + the rail.
  rightRail?: (controls: {
    collapsed: boolean;
    setCollapsed: (collapsed: boolean) => void;
  }) => React.ReactNode;
  leftCollapsed?: boolean;
  onLeftCollapsedChange?: (collapsed: boolean) => void;
  rightCollapsed?: boolean;
  onRightCollapsedChange?: (collapsed: boolean) => void;
  leftWidth?: number;
  leftWidthKey?: number;
  leftShortcut?: ShortcutDef;
  rightShortcut?: ShortcutDef;
  isMobile?: boolean;
  className?: string;
}

function ShortcutButton({
  onClick,
  side,
  label,
  keys,
  icon: Icon,
}: {
  onClick: () => void;
  side: 'left' | 'right';
  label: string;
  keys: string[];
  icon: typeof RiArrowLeftSLine;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="sm" onClick={onClick} className="h-8 w-8 p-0">
            <Icon className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side={side}>
          <span className="flex items-center gap-1.5">
            {label}
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
  );
}

export function ThreePanelLayout({
  left,
  right,
  leftContent,
  centerContent,
  rightContent,
  rightRail,
  leftCollapsed: controlledLeftCollapsed,
  onLeftCollapsedChange,
  rightCollapsed: controlledRightCollapsed,
  onRightCollapsedChange,
  leftWidth: controlledLeftWidth,
  leftWidthKey,
  leftShortcut = DEFAULT_LEFT_SHORTCUT,
  rightShortcut = DEFAULT_RIGHT_SHORTCUT,
  isMobile = false,
  className,
}: ThreePanelLayoutProps) {
  const {
    left: leftPanel,
    right: rightPanel,
    containerRef,
  } = usePanelResize(isMobile ? {} : { left, right });

  const setLeftPanelWidth = leftPanel?.setWidth;
  useEffect(() => {
    if (controlledLeftWidth !== undefined && setLeftPanelWidth) {
      setLeftPanelWidth(controlledLeftWidth);
    }
  }, [controlledLeftWidth, setLeftPanelWidth, leftWidthKey]);

  const isLeftCollapsed = controlledLeftCollapsed ?? leftPanel?.collapsed ?? false;
  const isRightCollapsed = controlledRightCollapsed ?? rightPanel?.collapsed ?? false;

  const setLeftCollapsed = useCallback(
    (collapsed: boolean) => {
      if (onLeftCollapsedChange) {
        onLeftCollapsedChange(collapsed);
      } else {
        leftPanel?.setCollapsed(collapsed);
      }
    },
    [onLeftCollapsedChange, leftPanel],
  );

  const setRightCollapsed = useCallback(
    (collapsed: boolean) => {
      if (onRightCollapsedChange) {
        onRightCollapsedChange(collapsed);
      } else {
        rightPanel?.setCollapsed(collapsed);
      }
    },
    [onRightCollapsedChange, rightPanel],
  );

  const leftKeys = useMemo(() => shortcutKeys(leftShortcut), [leftShortcut]);
  const rightKeys = useMemo(() => shortcutKeys(rightShortcut), [rightShortcut]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (!containerRef.current || containerRef.current.offsetWidth === 0) return;

      const isEditing =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement ||
        document.activeElement?.closest('[contenteditable="true"]') !== null;

      if (isEditing) return;

      if (leftPanel && matchShortcut(leftShortcut, e)) {
        e.preventDefault();
        setLeftCollapsed(!isLeftCollapsed);
      } else if (rightPanel && matchShortcut(rightShortcut, e)) {
        e.preventDefault();
        setRightCollapsed(!isRightCollapsed);
      }
    }

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [leftPanel, rightPanel, leftShortcut, rightShortcut, setLeftCollapsed, setRightCollapsed, containerRef, isLeftCollapsed, isRightCollapsed]);

  const hasLeft = !!left;
  const hasRight = !!right;
  const rightPanelExpanded = hasRight && !isRightCollapsed;

  const mobileOverlay = useOptionalMobileOverlay();
  const useMobileOverlayFiles = isMobile && hasLeft && !!mobileOverlay;

  return (
    <div ref={containerRef} className={cn('flex overflow-hidden relative', className)}>
      {/* Left panel */}
      {leftPanel && !isMobile && (
        <>
          <div
            className={cn(
              'transition-[width] duration-200 ease-in-out',
              isLeftCollapsed ? 'w-0 overflow-hidden' : '',
            )}
            style={{
              width: isLeftCollapsed ? 0 : leftPanel.width,
              visibility: isLeftCollapsed ? 'hidden' : 'visible',
            }}
          >
            {leftContent}
          </div>

          {isLeftCollapsed && (
            <div className="flex items-start pt-2">
              <ShortcutButton
                onClick={() => setLeftCollapsed(false)}
                side="right"
                label="Show sidebar"
                keys={leftKeys}
                icon={RiArrowRightSLine}
              />
            </div>
          )}

          {!isLeftCollapsed && (
            <div className="flex flex-col items-center flex-shrink-0">
              <ShortcutButton
                onClick={() => setLeftCollapsed(true)}
                side="right"
                label="Collapse sidebar"
                keys={leftKeys}
                icon={RiArrowLeftSLine}
              />
              <div
                className={cn(
                  'flex-1 w-1 bg-border hover:bg-blue-500 cursor-col-resize transition-colors',
                  leftPanel.isResizing && 'bg-blue-500',
                )}
                onMouseDown={leftPanel.handleMouseDown}
                onDoubleClick={() => setLeftCollapsed(true)}
                title="Drag to resize sidebar"
              />
            </div>
          )}
        </>
      )}

      {hasLeft && isMobile && useMobileOverlayFiles && (
        <MobileFilesSheet>{leftContent}</MobileFilesSheet>
      )}

      {hasLeft && isMobile && !useMobileOverlayFiles && (
        <>
          {isLeftCollapsed && (
            <div className="absolute left-1 top-1 z-10">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLeftCollapsed(false)}
                className="h-6 w-6 p-0 opacity-70"
                aria-label="Show sidebar"
              >
                <RiArrowRightSLine className="size-3" />
              </Button>
            </div>
          )}
          <Sheet open={!isLeftCollapsed} onOpenChange={(open) => setLeftCollapsed(!open)}>
            <SheetContent side="left" className="w-3/4 max-w-[300px] p-0" showCloseButton={false}>
              <SheetTitle className="sr-only">Sidebar</SheetTitle>
              {leftContent}
            </SheetContent>
          </Sheet>
        </>
      )}

      {/* Center content — hidden on mobile only when the inline right panel is
          shown in its place (no overlay). In overlay mode the terminal is a
          full-screen Sheet, so the center must stay mounted/visible underneath —
          otherwise closing the overlay leaves a blank screen. */}
      <div
        className={cn(
          'flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden',
          isMobile && rightPanelExpanded && !mobileOverlay && 'hidden',
        )}
      >
        {centerContent}
      </div>

      {/* Right panel — desktop: fixed width, mobile: full width */}
      {rightPanel && !isMobile && (
        <>
          {rightRail ? (
            // Rail owns the collapse control; only the bare resize handle lives
            // here, as the leftmost edge (no handle when collapsed — nothing to
            // resize).
            !isRightCollapsed && (
              <div
                className={cn(
                  'w-1 flex-shrink-0 bg-border hover:bg-blue-500 cursor-col-resize transition-colors',
                  rightPanel.isResizing && 'bg-blue-500',
                )}
                onMouseDown={rightPanel.handleMouseDown}
                onDoubleClick={() => setRightCollapsed(true)}
                title="Drag to resize panel"
              />
            )
          ) : (
            <>
              {!isRightCollapsed && (
                <div className="flex flex-col items-center flex-shrink-0">
                  <ShortcutButton
                    onClick={() => setRightCollapsed(true)}
                    side="left"
                    label="Collapse panel"
                    keys={rightKeys}
                    icon={RiArrowRightSLine}
                  />
                  <div
                    className={cn(
                      'flex-1 w-1 bg-border hover:bg-blue-500 cursor-col-resize transition-colors',
                      rightPanel.isResizing && 'bg-blue-500',
                    )}
                    onMouseDown={rightPanel.handleMouseDown}
                    onDoubleClick={() => setRightCollapsed(true)}
                    title="Drag to resize panel"
                  />
                </div>
              )}

              {isRightCollapsed && (
                <div className="flex items-start pt-2">
                  <ShortcutButton
                    onClick={() => setRightCollapsed(false)}
                    side="left"
                    label="Show panel"
                    keys={rightKeys}
                    icon={RiArrowLeftSLine}
                  />
                </div>
              )}
            </>
          )}

          {rightRail?.({ collapsed: isRightCollapsed, setCollapsed: setRightCollapsed })}

          {/* Collapse/expand only animates this clip wrapper. The inner host
              keeps its fixed width so panel content (dockview terminals) never
              lays out through zero or mid-transition widths — those degenerate
              layouts left xterm overlays stuck at sliver sizes. The transition
              is disabled while drag-resizing so both divs track the pointer. */}
          <div
            className={cn(
              'flex flex-shrink-0 min-h-0 overflow-hidden',
              !rightPanel.isResizing && 'transition-[width] duration-200 ease-in-out',
            )}
            style={{
              width: isRightCollapsed ? 0 : rightPanel.width,
              visibility: isRightCollapsed ? 'hidden' : 'visible',
            }}
          >
            <div
              className={cn('flex flex-col flex-shrink-0 min-h-0', !isRightCollapsed && 'border-l')}
              style={{ width: rightPanel.width }}
            >
              {rightContent}
            </div>
          </div>
        </>
      )}

      {hasRight && isMobile && !mobileOverlay && (
        <>
          <div className="flex items-start pt-2 flex-shrink-0">
            <ShortcutButton
              onClick={() => setRightCollapsed(!isRightCollapsed)}
              side="left"
              label={isRightCollapsed ? 'Show panel' : 'Collapse panel'}
              keys={rightKeys}
              icon={isRightCollapsed ? RiArrowLeftSLine : RiArrowRightSLine}
            />
          </div>
          {!isRightCollapsed && (
            <div className="flex flex-1 flex-col min-h-0 border-l">{rightContent}</div>
          )}
        </>
      )}
    </div>
  );
}
