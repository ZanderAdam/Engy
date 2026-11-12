import { describe, it, expect } from 'vitest';
import { orderTaskIds, terminalTaskSlug, taskOpenDetail } from './terminal-task-actions.helpers';

describe('terminal task bar helpers', () => {
  describe('terminalTaskSlug', () => {
    it('should format slug as workspaceSlug-T{taskId}', () => {
      expect(terminalTaskSlug('engy', 215)).toBe('engy-T215');
    });
  });

  describe('taskOpenDetail', () => {
    it('should return object without a tab key when tab is omitted', () => {
      const detail = taskOpenDetail({ taskId: 42, tabId: 'tab-1' });
      expect('tab' in detail).toBe(false);
      expect(detail).toEqual({ taskId: 42, tabId: 'tab-1' });
    });

    it('should return object without a tab key when tab is undefined', () => {
      const detail = taskOpenDetail({ taskId: 42, tabId: 'tab-1', tab: undefined });
      expect('tab' in detail).toBe(false);
      expect(detail).toEqual({ taskId: 42, tabId: 'tab-1' });
    });

    it("should return object with tab:'plan' when tab is 'plan'", () => {
      const detail = taskOpenDetail({ taskId: 42, tabId: 'tab-1', tab: 'plan' });
      expect(detail).toEqual({ taskId: 42, tab: 'plan', tabId: 'tab-1' });
    });

    it('should handle null tabId', () => {
      const detail = taskOpenDetail({ taskId: 7, tabId: null });
      expect('tab' in detail).toBe(false);
      expect(detail).toEqual({ taskId: 7, tabId: null });
    });
  });
});

describe('orderTaskIds', () => {
  it('[FR-TERMINAL-1150] should put the spawn task first and drop its duplicate', () => {
    expect(orderTaskIds(2, [3, 2, 1])).toEqual([2, 3, 1]);
  });

  it('[FR-TERMINAL-1150] should keep the link order when the terminal has no spawn task', () => {
    expect(orderTaskIds(undefined, [3, 1])).toEqual([3, 1]);
  });
});
