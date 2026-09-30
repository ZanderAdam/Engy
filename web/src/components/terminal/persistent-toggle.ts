'use client';

interface PersistentToggle {
  /** `useSyncExternalStore` subscribe — lazily initialises from localStorage. */
  subscribe: (listener: () => void) => () => void;
  get: () => boolean;
  getServerSnapshot: () => boolean;
  set: (next: boolean) => void;
}

/**
 * A boolean every mounted component shares: a module singleton persisted to
 * localStorage and mirrored across browser tabs via the `storage` event, so a
 * toggle flipped in one in-app tab lands everywhere without a provider.
 */
export function createPersistentToggle(storageKey: string, fallback: boolean): PersistentToggle {
  let enabled = fallback;
  let initialized = false;
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const listener of listeners) listener();
  }

  function read(raw: string | null): boolean {
    return raw === null ? fallback : raw === '1';
  }

  function ensureInit(): void {
    if (initialized || typeof window === 'undefined') return;
    initialized = true;
    enabled = read(window.localStorage.getItem(storageKey));
    window.addEventListener('storage', (e) => {
      if (e.key !== storageKey) return;
      const next = read(e.newValue);
      if (next === enabled) return;
      enabled = next;
      emit();
    });
  }

  return {
    subscribe(listener) {
      ensureInit();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => enabled,
    getServerSnapshot: () => fallback,
    set(next) {
      ensureInit();
      if (enabled === next) return;
      enabled = next;
      try {
        window.localStorage.setItem(storageKey, next ? '1' : '0');
      } catch {
        // localStorage unavailable — the in-memory toggle still works for this session.
      }
      emit();
    },
  };
}
