'use client';

import { useEffect, useCallback, useRef } from 'react';
import { RiArrowLeftSLine, RiArrowRightSLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { usePanelResize, type PanelConfig } from '@/lib/hooks/use-panel-resize';

type ShortcutMatcher = (e: KeyboardEvent) => boolean;

interface ThreePanelLayoutProps {
  left?: PanelConfig;
  right?: PanelConfig;
  leftContent?: React.ReactNode;
  centerContent: React.ReactNode;
  rightContent?: React.ReactNode;
  leftCollapsed?: boolean;
  onLeftCollapsedChange?: (collapsed: boolean) => void;
  rightCollapsed?: boolean;
  onRightCollapsedChange?: (collapsed: boolean) => void;
  leftWidth?: number;
  leftWidthKey?: number;
  leftShortcut?: ShortcutMatcher;
  rightShortcut?: ShortcutMatcher;
  className?: string;
}

export function defaultLeftShortcut(e: KeyboardEvent): boolean {
  const isModKey = e.metaKey || e.ctrlKey;
  return isModKey && e.shiftKey && (e.key === '<' || e.key === ',');
}

export function defaultRightShortcut(e: KeyboardEvent): boolean {
  const isModKey = e.metaKey || e.ctrlKey;
  return isModKey && e.shiftKey && (e.key === '>' || e.key === '.');
}

export type { PanelConfig, ShortcutMatcher };

export function ThreePanelLayout({
  left,
  right,
  leftContent,
  centerContent,
  rightContent,
  leftCollapsed: controlledLeftCollapsed,
  onLeftCollapsedChange,
  rightCollapsed: controlledRightCollapsed,
  onRightCollapsedChange,
  leftWidth: controlledLeftWidth,
  leftWidthKey,
  leftShortcut = defaultLeftShortcut,
  rightShortcut = defaultRightShortcut,
  className,
}: ThreePanelLayoutProps) {
  const {
    left: leftPanel,
    right: rightPanel,
    containerRef,
  } = usePanelResize({ left, right });

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

  const stateRef = useRef({ isLeftCollapsed, isRightCollapsed });
  stateRef.current = { isLeftCollapsed, isRightCollapsed };

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (!containerRef.current || containerRef.current.offsetWidth === 0) return;

      const isEditing =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement ||
        document.activeElement?.closest('[contenteditable="true"]') !== null;

      if (isEditing) return;

      if (leftPanel && leftShortcut(e)) {
        e.preventDefault();
        setLeftCollapsed(!stateRef.current.isLeftCollapsed);
      } else if (rightPanel && rightShortcut(e)) {
        e.preventDefault();
        setRightCollapsed(!stateRef.current.isRightCollapsed);
      }
    }

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [leftPanel, rightPanel, leftShortcut, rightShortcut, setLeftCollapsed, setRightCollapsed, containerRef]);

  return (
    <div ref={containerRef} className={cn('flex overflow-hidden', className)}>
      {leftPanel && (
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLeftCollapsed(false)}
                className="h-8 w-8 p-0"
                title="Show sidebar"
              >
                <RiArrowRightSLine className="size-4" />
              </Button>
            </div>
          )}

          {!isLeftCollapsed && (
            <div className="flex flex-col items-center flex-shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLeftCollapsed(true)}
                className="h-8 w-8 p-0"
                title="Collapse sidebar"
              >
                <RiArrowLeftSLine className="size-4" />
              </Button>
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

      <div className="flex-1 min-w-0 overflow-hidden">{centerContent}</div>

      {rightPanel && (
        <>
          {!isRightCollapsed && (
            <div className="flex flex-col items-center flex-shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRightCollapsed(true)}
                className="h-8 w-8 p-0"
                title="Collapse panel"
              >
                <RiArrowRightSLine className="size-4" />
              </Button>
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRightCollapsed(false)}
                className="h-8 w-8 p-0"
                title="Show panel"
              >
                <RiArrowLeftSLine className="size-4" />
              </Button>
            </div>
          )}

          <div
            className={cn(
              'flex flex-col flex-shrink-0 min-h-0 transition-[width] duration-200 ease-in-out',
              !isRightCollapsed && 'border-l',
            )}
            style={{
              width: isRightCollapsed ? 0 : rightPanel.width,
              visibility: isRightCollapsed ? 'hidden' : 'visible',
              overflow: isRightCollapsed ? 'hidden' : undefined,
            }}
          >
            {rightContent}
          </div>
        </>
      )}
    </div>
  );
}
