import { describe, it, expect } from 'vitest';
import { sanitizeOscTitle } from './osc-title';

describe('sanitizeOscTitle', () => {
  it('should pass through a plain title', () => {
    expect(sanitizeOscTitle('✳ Fixing tests — engy')).toBe('✳ Fixing tests — engy');
  });

  it('should strip C0 and C1 control characters', () => {
    expect(sanitizeOscTitle('a\x1b[31mb\x07c\x9bd')).toBe('a[31mbcd');
  });

  it('should trim surrounding whitespace', () => {
    expect(sanitizeOscTitle('  title  ')).toBe('title');
  });

  it('should cap overly long titles', () => {
    expect(sanitizeOscTitle('x'.repeat(1000))).toHaveLength(256);
  });

  it('should not split a surrogate pair at the length cap', () => {
    const capped = sanitizeOscTitle('💚'.repeat(300));
    expect(capped.isWellFormed()).toBe(true);
    expect(capped.length).toBeLessThanOrEqual(256);
  });

  it('should return empty string for control-only input', () => {
    expect(sanitizeOscTitle('\x07\x1b')).toBe('');
  });
});
