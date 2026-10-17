import { describe, it, expect } from 'vitest';
import { TERMINAL_IMAGE_MAX_BYTES, terminalImageError } from './terminal-image';

describe('terminal image', () => {
  describe('terminalImageError', () => {
    it.each(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])(
      'should accept %s within the size limit',
      (mimeType) => {
        expect(terminalImageError(mimeType, 1024)).toBeNull();
      },
    );

    it('should accept an image of exactly the size limit', () => {
      expect(terminalImageError('image/png', TERMINAL_IMAGE_MAX_BYTES)).toBeNull();
    });

    it('[FR-TERMINAL-990] should reject a type the agent cannot read', () => {
      expect(terminalImageError('image/heic', 1024)).toMatch(/PNG, JPEG, GIF or WebP/);
    });

    it('should reject a type named like an object prototype property', () => {
      expect(terminalImageError('constructor', 1024)).toMatch(/PNG, JPEG, GIF or WebP/);
    });

    it('[FR-TERMINAL-990] should reject an image over the size limit', () => {
      expect(terminalImageError('image/png', TERMINAL_IMAGE_MAX_BYTES + 1)).toMatch(/5 MB/);
    });

    it('should reject an empty file', () => {
      expect(terminalImageError('image/png', 0)).toMatch(/empty/);
    });
  });
});
