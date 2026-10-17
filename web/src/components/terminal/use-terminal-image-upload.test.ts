// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileAsBase64 } from './use-terminal-image-upload';

describe('terminal image upload', () => {
  describe('readFileAsBase64', () => {
    it('should return the raw base64 payload without the data URL prefix', async () => {
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
      const file = new File([bytes], 'shot.png', { type: 'image/png' });

      const base64 = await readFileAsBase64(file);

      expect(base64).toBe(Buffer.from(bytes).toString('base64'));
    });
  });
});
