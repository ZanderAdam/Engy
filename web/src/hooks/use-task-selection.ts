'use client';

import { useCallback, useState } from 'react';

export function useTaskSelection() {
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const enterSelectMode = useCallback(() => {
    setIsSelecting(true);
  }, []);

  const exitSelectMode = useCallback(() => {
    setIsSelecting(false);
    setSelectedIds(new Set());
  }, []);

  const toggle = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((visibleIds: number[]) => {
    setSelectedIds(new Set(visibleIds));
  }, []);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  return {
    isSelecting,
    selectedIds,
    selectedCount: selectedIds.size,
    enterSelectMode,
    exitSelectMode,
    toggle,
    selectAll,
    clear,
  };
}
