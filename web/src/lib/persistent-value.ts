'use client';

interface PersistentValue<T> {
  /** `useSyncExternalStore` subscribe — lazily initialises from localStorage. */
  subscribe: (listener: () => void) => () => void;
  get: () => T;
  getServerSnapshot: () => T;
  set: (next: T) => void;
}

interface PersistentValueCodec<T> {
  /** Returns the stored value, or `undefined` when the raw string is not a valid one. */
  parse: (raw: string) => T | undefined;
  serialize: (value: T) => string;
}

/**
 * A value every mounted component shares: a module singleton persisted to
 * localStorage and mirrored across browser tabs via the `storage` event, so a
 * change made in one in-app tab lands everywhere without a provider.
 */
export function createPersistentValue<T>(
  storageKey: string,
  fallback: T,
  codec: PersistentValueCodec<T>,
): PersistentValue<T> {
  let value = fallback;
  let initialized = false;
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const listener of listeners) listener();
  }

  function read(raw: string | null): T {
    return raw === null ? fallback : (codec.parse(raw) ?? fallback);
  }

  function ensureInit(): void {
    if (initialized || typeof window === 'undefined') return;
    initialized = true;
    value = read(window.localStorage.getItem(storageKey));
    window.addEventListener('storage', (e) => {
      if (e.key !== storageKey) return;
      const next = read(e.newValue);
      if (next === value) return;
      value = next;
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
    get() {
      ensureInit();
      return value;
    },
    getServerSnapshot: () => fallback,
    set(next) {
      ensureInit();
      if (value === next) return;
      value = next;
      try {
        window.localStorage.setItem(storageKey, codec.serialize(next));
      } catch {
        // localStorage unavailable — the in-memory value still works for this session.
      }
      emit();
    },
  };
}

export function createPersistentToggle(storageKey: string, fallback: boolean) {
  return createPersistentValue(storageKey, fallback, {
    parse: (raw) => raw === '1',
    serialize: (enabled) => (enabled ? '1' : '0'),
  });
}
