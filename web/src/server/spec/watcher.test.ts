import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleSpecFileChange, getSpecLastChanged, clearDebounceTimers } from './watcher';
import type { AppState } from '../trpc/context';

function createTestState(): AppState {
  return {
    daemon: null,
    fileChanges: new Map(),
    pendingValidations: new Map(),
    pendingFileSearches: new Map(),
    pendingGitStatus: new Map(),
    pendingGitDiff: new Map(),
    pendingGitLog: new Map(),
    pendingGitShow: new Map(),
    pendingGitBranchFiles: new Map(),
    specLastChanged: new Map(),
    specDebounceTimers: new Map(),
    terminalSessions: new Map(),
    terminalSessionMeta: new Map(),
    terminalDaemon: null,
    fileChangeListeners: new Set(),
    containerProgressListeners: new Map(),
    pendingContainerUp: new Map(),
    pendingContainerDown: new Map(),
    pendingContainerStatus: new Map(),
  };
}

describe('spec watcher', () => {
  let state: AppState;

  beforeEach(() => {
    vi.useFakeTimers();
    state = createTestState();
  });

  afterEach(() => {
    clearDebounceTimers(state);
    vi.useRealTimers();
  });

  describe('handleSpecFileChange', () => {
    it('should update timestamp after debounce period', () => {
      handleSpecFileChange('test-ws', state);
      expect(getSpecLastChanged('test-ws', state)).toBeNull();

      vi.advanceTimersByTime(300);
      expect(getSpecLastChanged('test-ws', state)).toBeTypeOf('number');
    });

    it('should debounce multiple changes into one update', () => {
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

    it('should track separate timestamps per workspace', () => {
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

  describe('getSpecLastChanged', () => {
    it('should return null for unknown workspace', () => {
      expect(getSpecLastChanged('unknown', state)).toBeNull();
    });

    it('should return the latest timestamp', () => {
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
