import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SerializedDockview } from 'dockview';
import { clearLayout, getLayoutKey, loadLayout, saveLayout } from './doc-dock-storage';

const SAMPLE_LAYOUT: SerializedDockview = {
  grid: { root: { type: 'branch', data: [], size: 0 }, height: 0, width: 0, orientation: 'HORIZONTAL' },
  panels: { 'spec.md': { id: 'spec.md', contentComponent: 'doc', title: 'spec.md' } },
} as unknown as SerializedDockview;

const memoryStore: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => memoryStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    memoryStore[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete memoryStore[key];
  }),
};

beforeEach(() => {
  for (const key of Object.keys(memoryStore)) delete memoryStore[key];
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
  vi.stubGlobal('localStorage', localStorageMock);
});

describe('doc-dock-storage', () => {
  describe('getLayoutKey', () => {
    it('should prefix the group key with doc-layout:', () => {
      expect(getLayoutKey('docs:workspace:my-ws')).toBe('doc-layout:docs:workspace:my-ws');
    });
  });

  describe('saveLayout / loadLayout round-trip', () => {
    it('should restore exactly what was saved', () => {
      saveLayout('docs:workspace:my-ws', SAMPLE_LAYOUT);
      const loaded = loadLayout('docs:workspace:my-ws');
      expect(loaded).toEqual(SAMPLE_LAYOUT);
    });
  });

  describe('loadLayout', () => {
    it('should return null when nothing is saved', () => {
      expect(loadLayout('docs:workspace:none')).toBeNull();
    });

    it('should return null and not throw when saved value is malformed', () => {
      memoryStore[getLayoutKey('docs:workspace:bad')] = 'not-json{';
      expect(loadLayout('docs:workspace:bad')).toBeNull();
    });
  });

  describe('clearLayout', () => {
    it('should remove the saved layout', () => {
      saveLayout('docs:workspace:my-ws', SAMPLE_LAYOUT);
      clearLayout('docs:workspace:my-ws');
      expect(loadLayout('docs:workspace:my-ws')).toBeNull();
    });
  });

  describe('failure modes', () => {
    it('should silently swallow setItem errors', () => {
      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new Error('quota exceeded');
      });
      expect(() => saveLayout('docs:workspace:my-ws', SAMPLE_LAYOUT)).not.toThrow();
    });

    it('should silently swallow removeItem errors', () => {
      localStorageMock.removeItem.mockImplementationOnce(() => {
        throw new Error('boom');
      });
      expect(() => clearLayout('docs:workspace:my-ws')).not.toThrow();
    });

    it('should silently swallow getItem errors', () => {
      localStorageMock.getItem.mockImplementationOnce(() => {
        throw new Error('boom');
      });
      expect(loadLayout('docs:workspace:my-ws')).toBeNull();
    });
  });
});
