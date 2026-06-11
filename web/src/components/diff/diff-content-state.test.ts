import { describe, it, expect } from 'vitest';
import { resolveFileReadError } from './diff-content-state';

describe('diff content state', () => {
  describe('resolveFileReadError', () => {
    it('should return null when there are no errors', () => {
      expect(resolveFileReadError('modified', null, null)).toBeNull();
    });

    it('should return the modified-read error for a modified file', () => {
      expect(resolveFileReadError('modified', null, 'read failed')).toBe('read failed');
    });

    it('should return the original-read error for a modified file', () => {
      expect(resolveFileReadError('modified', 'no such ref', null)).toBe('no such ref');
    });

    it('should ignore original-read errors for added files', () => {
      expect(resolveFileReadError('added', 'not in HEAD', null)).toBeNull();
    });

    it('should ignore modified-read errors for deleted files', () => {
      expect(resolveFileReadError('deleted', null, 'file gone')).toBeNull();
    });

    it('should still report original-read errors for deleted files', () => {
      expect(resolveFileReadError('deleted', 'no such ref', 'file gone')).toBe('no such ref');
    });

    it('should report original-read errors for deleted files when modified read succeeds', () => {
      expect(resolveFileReadError('deleted', 'no such ref', null)).toBe('no such ref');
    });

    it('should prefer the modified-read error when both fail', () => {
      expect(resolveFileReadError('modified', 'original failed', 'modified failed')).toBe(
        'modified failed',
      );
    });

    it('should report errors when the file status is unknown', () => {
      expect(resolveFileReadError(undefined, 'boom', null)).toBe('boom');
    });
  });
});
