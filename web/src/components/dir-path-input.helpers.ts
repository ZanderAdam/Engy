import path from 'path';

interface ParsedBrowsePath {
  browsePath: string;
  filter: string;
}

/**
 * Split an input string into the parent directory to list and a filter for
 * the last in-progress segment.
 *
 * "/Users/aleks/de"  → { browsePath: "/Users/aleks", filter: "de" }
 * "/Users/aleks/"    → { browsePath: "/Users/aleks", filter: "" }
 * ""                 → { browsePath: "", filter: "" }
 * "/"                → { browsePath: "/", filter: "" }
 */
export function parseBrowsePath(input: string): ParsedBrowsePath {
  if (!input) return { browsePath: '', filter: '' };
  if (input.endsWith('/')) {
    return { browsePath: input.slice(0, -1) || '/', filter: '' };
  }
  return { browsePath: path.dirname(input), filter: path.basename(input) };
}

/**
 * Filter a list of directory names:
 * - removes dot-directories (names starting with '.')
 * - when a filter string is provided, keeps only entries that contain it
 *   as a case-insensitive substring
 */
export function filterDirs(dirs: string[], filter: string): string[] {
  const visible = dirs.filter((d) => !d.startsWith('.'));
  if (!filter) return visible;
  const lower = filter.toLowerCase();
  return visible.filter((d) => d.toLowerCase().includes(lower));
}

/**
 * Given filtered dirs and the current filter string, pick the directory to
 * autocomplete to when the user types a trailing '/'.
 * Preference: exact case-insensitive match > sole remaining entry.
 * Returns null when neither condition holds.
 */
export function pickAutocompleteMatch(filteredDirs: string[], filter: string): string | null {
  if (!filter) return null;
  const exact = filteredDirs.find((d) => d.toLowerCase() === filter.toLowerCase());
  if (exact) return exact;
  if (filteredDirs.length === 1) return filteredDirs[0];
  return null;
}
