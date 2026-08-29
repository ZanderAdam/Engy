export type ReviewMode = 'stack' | 'single';

/**
 * Sections mount only as they approach the viewport, so a large diff costs
 * only what the reviewer actually scrolls through. That is what makes the
 * stack safe as the default at any file count.
 */
export function defaultReviewMode(fileCount: number): ReviewMode {
  return fileCount > 0 ? 'stack' : 'single';
}

export function resolveReviewMode(preference: ReviewMode | null, fileCount: number): ReviewMode {
  return preference ?? defaultReviewMode(fileCount);
}
