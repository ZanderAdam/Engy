'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

export interface VerticalPanelConfig {
  defaultHeight: number;
  minHeight: number;
  maxHeightPercent: number;
  storageKey: string;
}

interface VerticalPanelState {
  height: number;
  collapsed: boolean;
  isResizing: boolean;
  setCollapsed: (collapsed: boolean) => void;
  setHeight: (height: number) => void;
  handleMouseDown: (e: React.MouseEvent) => void;
}

function clampHeight(height: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, height));
}

function readStoredHeight(config: VerticalPanelConfig): number | null {
  const stored = localStorage.getItem(config.storageKey);
  if (!stored) return null;

  const height = parseInt(stored, 10);
  if (isNaN(height) || height < config.minHeight) return null;
  return height;
}

export function useVerticalPanelResize(
  config: VerticalPanelConfig,
): VerticalPanelState & { containerRef: React.RefObject<HTMLDivElement | null> } {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeightState] = useState(config.defaultHeight);
  const [collapsed, setCollapsed] = useState(true);
  const [isResizing, setIsResizing] = useState(false);

  const heightRef = useRef(height);
  heightRef.current = height;

  useEffect(() => {
    const stored = readStoredHeight(config);
    if (stored !== null) setHeightState(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getMaxHeight = useCallback(() => {
    const container = containerRef.current;
    if (!container) return config.defaultHeight * 2;
    return container.clientHeight * (config.maxHeightPercent / 100);
  }, [config.defaultHeight, config.maxHeightPercent]);

  const setHeight = useCallback(
    (h: number) => {
      setHeightState(clampHeight(h, config.minHeight, getMaxHeight()));
    },
    [config.minHeight, getMaxHeight],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const newHeight = containerRect.bottom - e.clientY;
      const maxH = container.clientHeight * (config.maxHeightPercent / 100);
      setHeightState(clampHeight(newHeight, config.minHeight, maxH));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      localStorage.setItem(config.storageKey, String(heightRef.current));
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isResizing]);

  return {
    height,
    collapsed,
    isResizing,
    setCollapsed,
    setHeight,
    handleMouseDown,
    containerRef,
  };
}
