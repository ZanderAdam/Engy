export type ReviewMode = 'stack' | 'single';

/**
 * How many sections may hold a rendered diff at once, whatever the file count.
 * Releasing a mounted section would collapse it under the reader and jump the
 * scroll, so a ceiling on how many ever mount is what bounds memory instead.
 */
export const MAX_MOUNTED_SECTIONS = 25;

/** Past the mount cap a default stack could never show its last files. */
export function defaultReviewMode(fileCount: number): ReviewMode {
  if (fileCount === 0) return 'single';
  return fileCount <= MAX_MOUNTED_SECTIONS ? 'stack' : 'single';
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

/**
 * Drops sections that no longer need a slot — the file left the list, or it was
 * marked viewed and renders no diff — so stale ids cannot fill the cap. Returns
 * the original set when nothing is dropped.
 */
export function keepSections(previous: Set<string>, live: Set<string>): Set<string> {
  const next = new Set([...previous].filter((id) => live.has(id)));
  return next.size === previous.size ? previous : next;
}
