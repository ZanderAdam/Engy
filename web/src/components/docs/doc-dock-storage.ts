import type { SerializedDockview } from 'dockview';

export function getLayoutKey(groupKey: string): string {
  return `doc-layout:${groupKey}`;
}

export function saveLayout(groupKey: string, layout: SerializedDockview): void {
  try {
    localStorage.setItem(getLayoutKey(groupKey), JSON.stringify(layout));
  } catch {
    // localStorage may be full or unavailable
  }
}

export function loadLayout(groupKey: string): SerializedDockview | null {
  try {
    const raw = localStorage.getItem(getLayoutKey(groupKey));
    if (!raw) return null;
    return JSON.parse(raw) as SerializedDockview;
  } catch {
    return null;
  }
}

export function clearLayout(groupKey: string): void {
  try {
    localStorage.removeItem(getLayoutKey(groupKey));
  } catch {
    // ignore
  }
}
