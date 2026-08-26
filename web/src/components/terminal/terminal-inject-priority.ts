'use client';

// BOTTOM's listener always mounts before RIGHT's, so "first listener wins"
// would let a collapsed BOTTOM dock steal injects from a visible RIGHT
// terminal. Primaries register live readiness here so a fallback can check
// before claiming.
interface PrimaryReadiness {
  tabId: string | null;
  isReady: () => boolean;
}

const primaries = new Set<PrimaryReadiness>();

/** Called by a primary (RIGHT) TerminalManager while mounted. `isReady` is
 * queried live, not snapshotted — it should read current refs, not close
 * over a point-in-time value. */
export function registerPrimaryInjectTarget(tabId: string | null, isReady: () => boolean): () => void {
  const entry: PrimaryReadiness = { tabId, isReady };
  primaries.add(entry);
  return () => {
    primaries.delete(entry);
  };
}

/** True if some registered primary, scoped to `eventTabId`, has a live
 * terminal it could write to. Mirrors the `tabId` scoping other handlers use. */
export function isPrimaryReadyFor(eventTabId: string | undefined | null): boolean {
  for (const primary of primaries) {
    if (eventTabId != null && eventTabId !== primary.tabId) continue;
    if (primary.isReady()) return true;
  }
  return false;
}
