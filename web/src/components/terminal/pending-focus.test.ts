import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPendingFocus, FOCUS_REQUEST_TIMEOUT_MS } from './pending-focus';

function fakeDock(panelIds: string[]) {
  const activated: string[] = [];
  const dock = {
    getPanel: (id: string) =>
      panelIds.includes(id) ? { api: { setActive: () => activated.push(id) } } : undefined,
  };
  return { dock, activated };
}

describe('createPendingFocus', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('request', () => {
    it('[FR-TERMINAL-1030] should activate a panel that already exists', () => {
      const onActivated = vi.fn();
      const { dock, activated } = fakeDock(['s1']);

      createPendingFocus(onActivated).request('s1', dock);

      expect(activated).toEqual(['s1']);
      expect(onActivated).toHaveBeenCalledWith('s1');
    });

    it('[FR-TERMINAL-1030] should keep the request while the dock is not ready', () => {
      const onActivated = vi.fn();
      const pending = createPendingFocus(onActivated);
      const { dock, activated } = fakeDock(['s1']);

      pending.request('s1', null);
      expect(onActivated).not.toHaveBeenCalled();

      pending.flush(dock);
      expect(activated).toEqual(['s1']);
      expect(onActivated).toHaveBeenCalledWith('s1');
    });

    it('[FR-TERMINAL-1030] should keep the request while the panel is not loaded yet', () => {
      const pending = createPendingFocus(vi.fn());
      const empty = fakeDock([]);
      const loaded = fakeDock(['s1']);

      pending.request('s1', empty.dock);
      pending.flush(empty.dock);
      pending.flush(loaded.dock);

      expect(loaded.activated).toEqual(['s1']);
    });
  });

  describe('flush', () => {
    it('[FR-TERMINAL-1030] should activate a request once only', () => {
      const pending = createPendingFocus(vi.fn());
      const { dock, activated } = fakeDock(['s1']);

      pending.request('s1', null);
      pending.flush(dock);
      pending.flush(dock);

      expect(activated).toEqual(['s1']);
    });

    it('[FR-TERMINAL-1030] should drop a request that never found its panel', () => {
      vi.useFakeTimers();
      const pending = createPendingFocus(vi.fn());
      const { dock, activated } = fakeDock(['s1']);

      pending.request('s1', null);
      vi.advanceTimersByTime(FOCUS_REQUEST_TIMEOUT_MS + 1);
      pending.flush(dock);

      expect(activated).toEqual([]);
    });

    it('[FR-TERMINAL-1030] should do nothing without a request', () => {
      const onActivated = vi.fn();
      createPendingFocus(onActivated).flush(fakeDock(['s1']).dock);
      expect(onActivated).not.toHaveBeenCalled();
    });
  });
});
