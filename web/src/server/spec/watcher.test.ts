import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleSpecFileChange, getSpecLastChanged, clearDebounceTimers } from './watcher';
import { createAppState, type AppState } from '../trpc/context';

describe('spec watcher', () => {
  let state: AppState;

  beforeEach(() => {
    vi.useFakeTimers();
    state = createAppState();
  });

  afterEach(() => {
    clearDebounceTimers(state);
    vi.useRealTimers();
  });

  describe('[FR-EDITOR-100] handleSpecFileChange', () => {
    it('[FR-EDITOR-100] should update timestamp after debounce period', () => {
      handleSpecFileChange('test-ws', state);
      expect(getSpecLastChanged('test-ws', state)).toBeNull();

      vi.advanceTimersByTime(300);
      expect(getSpecLastChanged('test-ws', state)).toBeTypeOf('number');
    });

    it('[FR-EDITOR-100] should debounce multiple changes into one update', () => {
      handleSpecFileChange('test-ws', state);
      vi.advanceTimersByTime(100);
      handleSpecFileChange('test-ws', state);
      vi.advanceTimersByTime(100);
      handleSpecFileChange('test-ws', state);
      vi.advanceTimersByTime(100);
      handleSpecFileChange('test-ws', state);
      vi.advanceTimersByTime(100);
      handleSpecFileChange('test-ws', state);

      // Not yet debounced
      expect(getSpecLastChanged('test-ws', state)).toBeNull();

      // After 300ms from last change
      vi.advanceTimersByTime(300);
      expect(getSpecLastChanged('test-ws', state)).toBeTypeOf('number');
    });

    it('[FR-EDITOR-100] should track separate timestamps per workspace', () => {
      handleSpecFileChange('ws-a', state);
      vi.advanceTimersByTime(300);

      handleSpecFileChange('ws-b', state);
      vi.advanceTimersByTime(300);

      const tsA = getSpecLastChanged('ws-a', state);
      const tsB = getSpecLastChanged('ws-b', state);
      expect(tsA).toBeTypeOf('number');
      expect(tsB).toBeTypeOf('number');
      expect(tsB!).toBeGreaterThanOrEqual(tsA!);
    });
  });

  describe('[FR-EDITOR-100] getSpecLastChanged', () => {
    it('[FR-EDITOR-100] should return null for unknown workspace', () => {
      expect(getSpecLastChanged('unknown', state)).toBeNull();
    });

    it('[FR-EDITOR-100] should return the latest timestamp', () => {
      handleSpecFileChange('test-ws', state);
      vi.advanceTimersByTime(300);
      const first = getSpecLastChanged('test-ws', state);

      vi.advanceTimersByTime(1000);
      handleSpecFileChange('test-ws', state);
      vi.advanceTimersByTime(300);
      const second = getSpecLastChanged('test-ws', state);

      expect(second!).toBeGreaterThan(first!);
    });
  });
});
