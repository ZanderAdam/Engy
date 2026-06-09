import { describe, it, expect } from 'vitest';
import { isImagePath, imageMimeType } from './file-types';

describe('file-types', () => {
  describe('isImagePath', () => {
    it('should accept common web image extensions', () => {
      for (const p of ['a.png', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'a.svg', 'a.avif']) {
        expect(isImagePath(p)).toBe(true);
      }
    });

    it('should be case-insensitive on the extension', () => {
      expect(isImagePath('Screenshot.PNG')).toBe(true);
      expect(isImagePath('photo.JPEG')).toBe(true);
    });

    it('should reject non-image files', () => {
      for (const p of ['readme.md', 'notes.txt', 'code.ts', 'data.json', 'archive.tar.gz']) {
        expect(isImagePath(p)).toBe(false);
      }
    });

    it('should reject dotfiles and extensionless names', () => {
      expect(isImagePath('.png')).toBe(false);
      expect(isImagePath('LICENSE')).toBe(false);
      expect(isImagePath('img')).toBe(false);
    });

    it('should resolve the extension from the basename, not the directory', () => {
      expect(isImagePath('png/notes.md')).toBe(false);
      expect(isImagePath('docs/diagram.png')).toBe(true);
    });
  });

  describe('imageMimeType', () => {
    it('should map extensions to MIME types', () => {
      expect(imageMimeType('a.png')).toBe('image/png');
      expect(imageMimeType('a.jpg')).toBe('image/jpeg');
      expect(imageMimeType('a.jpeg')).toBe('image/jpeg');
      expect(imageMimeType('a.svg')).toBe('image/svg+xml');
    });

    it('should return null for non-image paths', () => {
      expect(imageMimeType('a.md')).toBeNull();
    });
  });
});
