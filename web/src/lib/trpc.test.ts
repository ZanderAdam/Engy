import { describe, it, expect } from 'vitest';
import { MAX_BATCH_URL_LENGTH } from './trpc';

/**
 * Node answers a request line past its 16 KB header budget with a bodyless 431,
 * which every call in the batch then reports as a JSON parse failure. Refreshing
 * a large diff refetches every open patch at once and reaches that on its own.
 */
const NODE_HEADER_BUDGET = 16 * 1024;

describe('the tRPC browser client', () => {
  describe('batch size', () => {
    it('[FR-GIT-540] should split a batch well before its URL outgrows the header budget', () => {
      expect(MAX_BATCH_URL_LENGTH).toBeGreaterThan(0);
      expect(MAX_BATCH_URL_LENGTH * 2).toBeLessThan(NODE_HEADER_BUDGET);
    });
  });
});
