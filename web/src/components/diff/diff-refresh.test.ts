import { describe, it, expect, vi } from 'vitest';
import { refreshDiff } from './diff-refresh';

describe('diff refresh', () => {
  describe('refreshDiff', () => {
    it('[FR-GIT-320] reloads the file list and the open panes together', () => {
      const utils = {
        diff: { invalidate: vi.fn() },
        file: { invalidate: vi.fn() },
      };

      refreshDiff(utils);

      expect(utils.diff.invalidate).toHaveBeenCalledTimes(1);
      expect(utils.file.invalidate).toHaveBeenCalledTimes(1);
    });
  });
});
