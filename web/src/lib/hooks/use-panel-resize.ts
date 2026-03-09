'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

export interface PanelConfig {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  defaultCollapsed?: boolean;
  storageKey?: string;
}

export interface PanelState {
  width: number;
  collapsed: boolean;
  isResizing: boolean;
  setCollapsed: (collapsed: boolean) => void;
  setWidth: (width: number) => void;
  handleMouseDown: (e: React.MouseEvent) => void;
}

interface UsePanelResizeOptions {
  left?: PanelConfig;
  right?: PanelConfig;
}

interface UsePanelResizeReturn {
  left: PanelState | null;
  right: PanelState | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function clampWidth(width: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, width));
}

export function readStoredWidth(config: PanelConfig): number | null {
  if (!config.storageKey) return null;

  const stored = localStorage.getItem(config.storageKey);
  if (!stored) return null;

  const width = parseInt(stored, 10);
  if (isNaN(width) || width < config.minWidth || width > config.maxWidth) {
    return null;
  }
  return width;
}

export function usePanelResize(options: UsePanelResizeOptions): UsePanelResizeReturn {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [leftWidth, setLeftWidth] = useState(options.left?.defaultWidth ?? 0);
  const [leftCollapsed, setLeftCollapsedState] = useState(options.left?.defaultCollapsed ?? false);
  const [isResizingLeft, setIsResizingLeft] = useState(false);

  const [rightWidth, setRightWidth] = useState(options.right?.defaultWidth ?? 0);
  const [rightCollapsed, setRightCollapsedState] = useState(
    options.right?.defaultCollapsed ?? false,
  );
  const [isResizingRight, setIsResizingRight] = useState(false);

  useEffect(() => {
    if (options.left) {
      const stored = readStoredWidth(options.left);
      if (stored !== null) setLeftWidth(stored);
    }
    if (options.right) {
      const stored = readStoredWidth(options.right);
      if (stored !== null) setRightWidth(stored);
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const leftWidthRef = useRef(leftWidth);
  leftWidthRef.current = leftWidth;
  const rightWidthRef = useRef(rightWidth);
  rightWidthRef.current = rightWidth;

  const handleLeftMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingLeft(true);
  }, []);

  const handleRightMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingRight(true);
  }, []);

  const setLeftWidthClamped = useCallback(
    (width: number) => {
      if (!options.left) return;
      setLeftWidth(clampWidth(width, options.left.minWidth, options.left.maxWidth));
    },
    [options.left],
  );

  const setRightWidthClamped = useCallback(
    (width: number) => {
      if (!options.right) return;
      setRightWidth(clampWidth(width, options.right.minWidth, options.right.maxWidth));
    },
    [options.right],
  );

  useEffect(() => {
    if (!isResizingLeft) return;

    const leftConfig = options.left;
    if (!leftConfig) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;
      setLeftWidth(clampWidth(newWidth, leftConfig.minWidth, leftConfig.maxWidth));
    };

    const handleMouseUp = () => {
      setIsResizingLeft(false);
      if (leftConfig.storageKey) {
        localStorage.setItem(leftConfig.storageKey, String(leftWidthRef.current));
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isResizingLeft]);

  useEffect(() => {
    if (!isResizingRight) return;

    const rightConfig = options.right;
    if (!rightConfig) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const newWidth = containerRect.right - e.clientX;
      setRightWidth(clampWidth(newWidth, rightConfig.minWidth, rightConfig.maxWidth));
    };

    const handleMouseUp = () => {
      setIsResizingRight(false);
      if (rightConfig.storageKey) {
        localStorage.setItem(rightConfig.storageKey, String(rightWidthRef.current));
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isResizingRight]);

  const leftState: PanelState | null = options.left
    ? {
        width: leftWidth,
        collapsed: leftCollapsed,
        isResizing: isResizingLeft,
        setCollapsed: setLeftCollapsedState,
        setWidth: setLeftWidthClamped,
        handleMouseDown: handleLeftMouseDown,
      }
    : null;

  const rightState: PanelState | null = options.right
    ? {
        width: rightWidth,
        collapsed: rightCollapsed,
        isResizing: isResizingRight,
        setCollapsed: setRightCollapsedState,
        setWidth: setRightWidthClamped,
        handleMouseDown: handleRightMouseDown,
      }
    : null;

  return {
    left: leftState,
    right: rightState,
    containerRef,
  };
}
