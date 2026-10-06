import type { DiffViewMode } from './types';

export function viewedBaseFor(
  diffViewMode: DiffViewMode,
  baseBranch: string,
  selectedCommit: string | null,
): string | null {
  if (diffViewMode === 'branch') return baseBranch;
  if (diffViewMode === 'history') return selectedCommit;
  return 'latest';
}
