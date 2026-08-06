import type { ChangedFile, DiffSide } from './types';

const SIDE_PREFIX: Record<DiffSide, string> = {
  staged: 'staged:',
  unstaged: 'unstaged:',
};

/**
 * A path can be changed on both sides of the index at once, and the two halves
 * are different diffs, so a bare path cannot say which one the user picked.
 * Selection therefore travels as a side-qualified id wherever an index exists.
 */
export function encodeSelection(path: string, side: DiffSide | null): string {
  return side ? `${SIDE_PREFIX[side]}${path}` : path;
}

/** The prefix {@link encodeSelection} would apply, for callers building ids in bulk. */
export function selectionPrefix(side: DiffSide): string {
  return SIDE_PREFIX[side];
}

/**
 * How a row is addressed inside the list — always side-qualified, unlike the
 * selection handed back to the caller. Review progress is recorded against it,
 * so the two halves of one path are ticked off separately rather than one
 * standing in for the other.
 */
export function rowId(file: ChangedFile): string {
  return encodeSelection(file.path, file.staged ? 'staged' : 'unstaged');
}

/**
 * `sided` mirrors how the id was built. Passing it — rather than sniffing for a
 * prefix — keeps a file genuinely named `staged:…` from being mistaken for a
 * qualified id in the views that never qualify one.
 */
export function decodeSelection(
  id: string | null,
  sided: boolean,
): { path: string | null; side: DiffSide | null } {
  if (!id) return { path: null, side: null };
  if (!sided) return { path: id, side: null };
  for (const side of ['staged', 'unstaged'] as const) {
    if (id.startsWith(SIDE_PREFIX[side])) {
      return { path: id.slice(SIDE_PREFIX[side].length), side };
    }
  }
  return { path: id, side: null };
}

/**
 * The row a selection came from. Two rows can share a path, so the side has to
 * take part in the match; without a side there is at most one row per path.
 */
export function findSelectedFile(
  files: ChangedFile[],
  path: string | null,
  side: DiffSide | null,
): ChangedFile | undefined {
  if (!path) return undefined;
  return files.find(
    (f) => f.path === path && (side === null || f.staged === (side === 'staged')),
  );
}
