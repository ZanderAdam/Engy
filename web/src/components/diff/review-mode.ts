export type ReviewMode = 'stack' | 'single';

/**
 * Past this many files the stack is not the default. Sections mount as they
 * approach the viewport but are never released, so reading to the end of a
 * large pull request accumulates every file's DOM at once.
 */
export const STACK_FILE_LIMIT = 40;

/**
 * How many sections may hold a rendered diff at once, whatever the file count.
 * Releasing a mounted section would collapse it under the reader and jump the
 * scroll, so a ceiling on how many ever mount is what bounds memory instead.
 */
export const MAX_MOUNTED_SECTIONS = 25;

export function defaultReviewMode(fileCount: number): ReviewMode {
  if (fileCount === 0) return 'single';
  return fileCount <= STACK_FILE_LIMIT ? 'stack' : 'single';
}

export function resolveReviewMode(preference: ReviewMode | null, fileCount: number): ReviewMode {
  return preference ?? defaultReviewMode(fileCount);
}

/**
 * Adds newly-visible sections to the mounted set, up to the cap. Returns the
 * original set when nothing is admitted, so the caller's state does not churn.
 */
export function admitSections(
  previous: Set<string>,
  arrived: string[],
  max: number = MAX_MOUNTED_SECTIONS,
): Set<string> {
  if (previous.size >= max) return previous;

  const next = new Set(previous);
  for (const id of arrived) {
    if (next.size >= max) break;
    next.add(id);
  }

  return next.size === previous.size ? previous : next;
}
