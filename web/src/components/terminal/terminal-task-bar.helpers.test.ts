import { describe, it, expect } from 'vitest';
import { terminalTaskSlug, taskOpenDetail } from './terminal-task-bar.helpers';

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
