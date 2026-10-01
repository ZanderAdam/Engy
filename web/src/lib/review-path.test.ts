import { describe, it, expect } from 'vitest';
import { buildReviewPath } from './review-path';

describe('buildReviewPath', () => {
  it('[FR-PRMON-230] should build the review route that a PR title opens', () => {
    expect(buildReviewPath('my-ws', 'acme/web', 7)).toBe('/w/my-ws/review?repo=acme%2Fweb&pr=7');
  });

  it('should add the project slug when given', () => {
    expect(buildReviewPath('my-ws', 'acme/web', 7, 'initial')).toBe(
      '/w/my-ws/review?repo=acme%2Fweb&pr=7&project=initial',
    );
  });

  it('should omit the project when null', () => {
    expect(buildReviewPath('my-ws', 'acme/web', 7, null)).not.toContain('project');
  });
});
