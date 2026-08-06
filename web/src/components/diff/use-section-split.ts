'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Neither section may be dragged below this share of the pane. */
const MIN_FRACTION = 0.15;

export function clampFraction(fraction: number): number {
  return Math.max(MIN_FRACTION, Math.min(1 - MIN_FRACTION, fraction));
}

/** Where the pointer sits within the pane, as a share of its height. */
export function fractionFromPointer(clientY: number, top: number, height: number): number {
  if (height <= 0) return MIN_FRACTION;
  return clampFraction((clientY - top) / height);
}

export function readStoredFraction(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return null;
  return clampFraction(parsed);
}

function loadFraction(storageKey: string): number | null {
  if (typeof window === 'undefined') return null;
  return readStoredFraction(localStorage.getItem(storageKey));
}

interface SectionSplit {
  /** Share of the pane given to the first section while both are expanded. */
  fraction: number;
  isDragging: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onHandleMouseDown: (e: React.MouseEvent) => void;
}

/**
 * Splits a pane between two stacked sections along a draggable divider. The
 * share is stored rather than a pixel height so the split survives the sidebar
 * being resized or the window changing height.
 */
export function useSectionSplit(storageKey: string, defaultFraction = 0.4): SectionSplit {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Read once at mount rather than in an effect, so the first paint already has
  // the stored split instead of jumping to it.
  const [fraction, setFraction] = useState(
    () => loadFraction(storageKey) ?? clampFraction(defaultFraction),
  );
  const [isDragging, setIsDragging] = useState(false);

  // Read by the drag teardown, which must not re-subscribe on every pointer move.
  const fractionRef = useRef(fraction);
  useEffect(() => {
    fractionRef.current = fraction;
  }, [fraction]);

  const onHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      setFraction(fractionFromPointer(e.clientY, rect.top, rect.height));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      localStorage.setItem(storageKey, String(fractionRef.current));
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
  }, [isDragging, storageKey]);

  return { fraction, isDragging, containerRef, onHandleMouseDown };
}
