import type { DiffViewMode } from './types';

const DIFF_VIEW_MODES: DiffViewMode[] = ['latest', 'history', 'branch'];

interface DiffUrlParams {
  repo: string | null;
  view: DiffViewMode | null;
}

/**
 * `?diffRepo` and `?diffView` let another surface — the terminal's Diff button
 * — open the Diffs page already pointed at a review, instead of making the
 * reader reselect what they were just looking at. The names carry a prefix
 * because the project nav copies every param onto its section links, and the
 * Tasks page reads a `view` of its own.
 */
export function diffUrlParams(search: URLSearchParams): DiffUrlParams {
  const view = search.get('diffView');
  return {
    repo: search.get('diffRepo') || null,
    view: DIFF_VIEW_MODES.find((mode) => mode === view) ?? null,
  };
}
