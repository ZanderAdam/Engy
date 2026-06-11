import type { GitFileStatus } from './types';

/**
 * Resolve which file-content read error (if any) should be surfaced to the
 * user. Added files have no original content and deleted files have no
 * modified content, so read failures on those sides are expected and ignored.
 */
export function resolveFileReadError(
  status: GitFileStatus | undefined,
  originalError: string | null,
  modifiedError: string | null,
): string | null {
  if (modifiedError && status !== 'deleted') return modifiedError;
  if (originalError && status !== 'added') return originalError;
  return null;
}
