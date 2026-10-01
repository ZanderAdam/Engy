import { describe, it, expect } from 'vitest';
import { reviewUrlParams } from './review-url-params';

describe('[FR-PRREVIEW-230] reviewUrlParams', () => {
  it('should read repo and pr', () => {
    expect(reviewUrlParams(new URLSearchParams('repo=org/app&pr=42'))).toEqual({
      repo: 'org/app',
      pr: 42,
    });
  });

  it.each(['', 'abc', '0', '-3', '1.5'])('should reject pr=%s', (pr) => {
    expect(reviewUrlParams(new URLSearchParams(`repo=org/app&pr=${pr}`)).pr).toBeNull();
  });

  it('should return nulls for an empty query', () => {
    expect(reviewUrlParams(new URLSearchParams())).toEqual({ repo: null, pr: null });
  });
});
