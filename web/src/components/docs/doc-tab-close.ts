export type TabCloseScope = 'others' | 'right';

export function panelsToClose<T extends { id: string }>(
  panels: readonly T[],
  anchorId: string,
  scope: TabCloseScope,
): T[] {
  const index = panels.findIndex((p) => p.id === anchorId);
  if (index === -1) return [];
  if (scope === 'others') return panels.filter((p) => p.id !== anchorId);
  return panels.slice(index + 1);
}

export function activeLast<T extends { id: string }>(
  panels: readonly T[],
  activeId: string | undefined,
): T[] {
  const active = panels.filter((p) => p.id === activeId);
  return [...panels.filter((p) => p.id !== activeId), ...active];
}
