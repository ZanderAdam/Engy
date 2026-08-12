'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

export interface PanelConfig {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  defaultCollapsed?: boolean;
  storageKey?: string;
}

interface PanelState {
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

// Smallest center column a side panel may leave behind. It keeps a generous
// `maxWidth` usable on wide screens without letting a drag squeeze the center
// content to nothing on narrow ones.
const MIN_CENTER_WIDTH = 320;

export function clampWidth(width: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, width));
}

// `siblingWidth` is the width the opposite panel currently occupies, so both
// sides draw from one budget instead of each assuming it owns the container.
export function resolveMaxWidth(
  config: PanelConfig,
  containerWidth: number,
  siblingWidth = 0,
): number {
  if (containerWidth <= 0) return config.maxWidth;
  const available = containerWidth - siblingWidth - MIN_CENTER_WIDTH;
  return clampWidth(available, config.minWidth, config.maxWidth);
}

export function readStoredWidth(config: PanelConfig): number | null {
  if (!config.storageKey) return null;

  const stored = localStorage.getItem(config.storageKey);
  if (!stored) return null;

  const width = parseInt(stored, 10);
  if (isNaN(width)) return null;

  return clampWidth(width, config.minWidth, config.maxWidth);
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

  // The width the user last asked for, kept separate from the rendered width so
  // a temporarily narrow container shrinks the panel without forgetting the
  // request — it is restored as soon as there is room again.
  const leftRequestedRef = useRef(leftWidth);
  const rightRequestedRef = useRef(rightWidth);

  useEffect(() => {
    if (options.left) {
      const stored = readStoredWidth(options.left);
      if (stored !== null) {
        leftRequestedRef.current = stored;
        setLeftWidth(stored);
      }
    }
    if (options.right) {
      const stored = readStoredWidth(options.right);
      if (stored !== null) {
        rightRequestedRef.current = stored;
        setRightWidth(stored);
      }
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const leftWidthRef = useRef(leftWidth);
  leftWidthRef.current = leftWidth;
  const rightWidthRef = useRef(rightWidth);
  rightWidthRef.current = rightWidth;
  const leftCollapsedRef = useRef(leftCollapsed);
  leftCollapsedRef.current = leftCollapsed;
  const rightCollapsedRef = useRef(rightCollapsed);
  rightCollapsedRef.current = rightCollapsed;

  const measureContainer = useCallback(
    () => containerRef.current?.getBoundingClientRect().width ?? 0,
    [],
  );

  const visibleLeftWidth = useCallback(
    () => (options.left && !leftCollapsedRef.current ? leftWidthRef.current : 0),
    [options.left],
  );

  const visibleRightWidth = useCallback(
    () => (options.right && !rightCollapsedRef.current ? rightWidthRef.current : 0),
    [options.right],
  );

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
      const config = options.left;
      if (!config) return;
      leftRequestedRef.current = clampWidth(width, config.minWidth, config.maxWidth);
      const max = resolveMaxWidth(config, measureContainer(), visibleRightWidth());
      setLeftWidth(clampWidth(width, config.minWidth, max));
    },
    [options.left, measureContainer, visibleRightWidth],
  );

  const setRightWidthClamped = useCallback(
    (width: number) => {
      const config = options.right;
      if (!config) return;
      rightRequestedRef.current = clampWidth(width, config.minWidth, config.maxWidth);
      const max = resolveMaxWidth(config, measureContainer(), visibleLeftWidth());
      setRightWidth(clampWidth(width, config.minWidth, max));
    },
    [options.right, measureContainer, visibleLeftWidth],
  );

  // A width restored from storage, or chosen on a wider window, must not
  // survive into a container that can no longer afford it.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      const containerWidth = measureContainer();
      if (containerWidth <= 0) return;

      const leftConfig = options.left;
      if (leftConfig) {
        const max = resolveMaxWidth(leftConfig, containerWidth, visibleRightWidth());
        setLeftWidth(clampWidth(leftRequestedRef.current, leftConfig.minWidth, max));
      }

      const rightConfig = options.right;
      if (rightConfig) {
        const max = resolveMaxWidth(rightConfig, containerWidth, visibleLeftWidth());
        setRightWidth(clampWidth(rightRequestedRef.current, rightConfig.minWidth, max));
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [options.left, options.right, measureContainer, visibleLeftWidth, visibleRightWidth]);

  useEffect(() => {
    if (!isResizingLeft) return;

    const leftConfig = options.left;
    if (!leftConfig) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;
      leftRequestedRef.current = clampWidth(newWidth, leftConfig.minWidth, leftConfig.maxWidth);
      const max = resolveMaxWidth(leftConfig, containerRect.width, visibleRightWidth());
      setLeftWidth(clampWidth(newWidth, leftConfig.minWidth, max));
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
      rightRequestedRef.current = clampWidth(newWidth, rightConfig.minWidth, rightConfig.maxWidth);
      const max = resolveMaxWidth(rightConfig, containerRect.width, visibleLeftWidth());
      setRightWidth(clampWidth(newWidth, rightConfig.minWidth, max));
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
