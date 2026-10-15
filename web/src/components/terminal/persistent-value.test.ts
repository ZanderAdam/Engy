// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createPersistentValue } from './persistent-value';

describe('createPersistentValue', () => {
  const codec = {
    parse: (raw: string) => (raw.startsWith('ok:') ? raw.slice(3) : undefined),
    serialize: (value: string) => `ok:${value}`,
  };

  it('should fall back when the stored value does not parse', () => {
    window.localStorage.setItem('test:bad', 'garbage');
    const value = createPersistentValue('test:bad', 'fallback', codec);
    value.subscribe(() => {});
    expect(value.get()).toBe('fallback');
  });

  it('should read the stored value before anything subscribes', () => {
    window.localStorage.setItem('test:early', 'ok:stored');
    const value = createPersistentValue('test:early', 'fallback', codec);
    expect(value.get()).toBe('stored');
  });

  it('[FR-TERMINAL-980] should pick up a change made in another browser tab', () => {
    const value = createPersistentValue('test:sync', 'a', codec);
    let notified = 0;
    value.subscribe(() => notified++);
    window.dispatchEvent(new StorageEvent('storage', { key: 'test:sync', newValue: 'ok:b' }));
    expect(value.get()).toBe('b');
    expect(notified).toBe(1);
  });
});
