import { describe, it, expect } from 'vitest';
import { estimateBlockTokens, estimateImageTokens, readPngDimensions } from './tokens.js';

function pngBase64(width: number, height: number): string {
  const head = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.write('IHDR', 12, 'ascii');
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return head.toString('base64');
}

describe('usage token estimation', () => {
  describe('readPngDimensions', () => {
    it('should read width and height from the IHDR header', () => {
      expect(readPngDimensions(pngBase64(1920, 1080))).toEqual({ width: 1920, height: 1080 });
    });

    it('should return null for a payload that is not a PNG', () => {
      expect(readPngDimensions(Buffer.from('not an image at all!!').toString('base64'))).toBeNull();
    });

    it('should return null for a payload too short to contain a header', () => {
      expect(readPngDimensions('iVBO')).toBeNull();
    });
  });

  describe('estimateImageTokens', () => {
    it('should price a full-HD screenshot at roughly 1800 tokens', () => {
      const tokens = estimateImageTokens(pngBase64(1920, 1080));
      expect(tokens).toBeGreaterThan(1700);
      expect(tokens).toBeLessThan(1900);
    });

    it('should cap the long edge at 1568px before pricing', () => {
      const huge = estimateImageTokens(pngBase64(6000, 4000));
      const capped = estimateImageTokens(pngBase64(1568, 1045));
      expect(Math.abs(huge - capped)).toBeLessThan(capped * 0.02);
    });

    it('should not scale up an image already below the cap', () => {
      expect(estimateImageTokens(pngBase64(280, 720))).toBe(Math.round((280 * 720) / 750));
    });

    it('should fall back to a fixed estimate when dimensions are unreadable', () => {
      expect(estimateImageTokens('')).toBe(1500);
    });
  });

  describe('estimateBlockTokens', () => {
    it('should price an image block by pixels, not by payload length', () => {
      // A real base64 screenshot runs to ~1.26M characters. Estimating it as
      // text overstates the cost ~25x and inverts every ranking built on it.
      const data = pngBase64(1920, 1080) + 'A'.repeat(1_260_000);
      const result = estimateBlockTokens({ type: 'image', source: { type: 'base64', data } });
      expect(result.isImage).toBe(true);
      expect(result.tokens).toBeLessThan(2000);
    });

    it('should price a text block from its character count', () => {
      const result = estimateBlockTokens({ type: 'text', text: 'x'.repeat(360) });
      expect(result.isImage).toBe(false);
      expect(result.tokens).toBeCloseTo(100, 0);
    });

    it('should return zero tokens for a non-object block', () => {
      expect(estimateBlockTokens(null).tokens).toBe(0);
    });
  });
});
