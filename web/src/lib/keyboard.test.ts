import { describe, it, expect } from 'vitest';
import { isSelfActivation } from './keyboard';

describe('keyboard', () => {
  describe('isSelfActivation', () => {
    const row = { id: 'row' } as unknown as EventTarget;
    const nested = { id: 'nested' } as unknown as EventTarget;

    it('should accept Enter pressed on the row itself', () => {
      expect(isSelfActivation({ key: 'Enter', target: row, currentTarget: row })).toBe(true);
    });

    it('should accept space pressed on the row itself', () => {
      expect(isSelfActivation({ key: ' ', target: row, currentTarget: row })).toBe(true);
    });

    it('should ignore space typed into a nested control', () => {
      expect(isSelfActivation({ key: ' ', target: nested, currentTarget: row })).toBe(false);
    });

    it('should ignore Enter pressed on a nested control', () => {
      expect(isSelfActivation({ key: 'Enter', target: nested, currentTarget: row })).toBe(false);
    });

    it('should ignore other keys on the row itself', () => {
      expect(isSelfActivation({ key: 'a', target: row, currentTarget: row })).toBe(false);
    });
  });
});
