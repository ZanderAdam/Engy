import type { ChangedFile, GitFileStatus } from './types';

export type MatchMode = 'substring' | 'regex' | 'glob';

export interface FilterState {
  query: string;
  matchMode: MatchMode;
  matchCase: boolean;
  statuses: Set<GitFileStatus>;
  commentedOnly: boolean;
  unviewedOnly: boolean;
}

export const EMPTY_FILTER: FilterState = {
  query: '',
  matchMode: 'substring',
  matchCase: false,
  statuses: new Set(),
  commentedOnly: false,
  unviewedOnly: false,
};

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Translates a glob to a regex source. `**` crosses directory separators, `*`
 * and `?` do not, so `src/*.ts` matches `src/a.ts` but not `src/x/a.ts`.
 */
function globToRegexSource(glob: string): string {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        source += '.*';
        i++;
        // Let `**/` also match zero directories, so `**/*.ts` finds `a.ts`.
        if (glob[i + 1] === '/') {
          source += '(?:/)?';
          i++;
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    source += escapeRegex(char);
  }
  return `^${source}$`;
}

interface PathMatcher {
  matches: (path: string) => boolean;
  /** Set when the query is a malformed regex/glob, for surfacing in the UI. */
  error?: string;
}

export function createPathMatcher(
  query: string,
  matchMode: MatchMode,
  matchCase: boolean,
): PathMatcher {
  if (!query) return { matches: () => true };

  if (matchMode === 'substring') {
    if (matchCase) return { matches: (path) => path.includes(query) };
    const needle = query.toLowerCase();
    return { matches: (path) => path.toLowerCase().includes(needle) };
  }

  const source = matchMode === 'glob' ? globToRegexSource(query) : query;
  try {
    const regex = new RegExp(source, matchCase ? '' : 'i');
    return { matches: (path) => regex.test(path) };
  } catch (err) {
    // An in-progress pattern like `foo(` shouldn't blank the list.
    return {
      matches: () => true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

interface FilterContext {
  commentCounts?: Map<string, number>;
  viewedPaths?: Set<string>;
}

export function filterFiles(
  files: ChangedFile[],
  filter: FilterState,
  context: FilterContext = {},
): { files: ChangedFile[]; error?: string } {
  const matcher = createPathMatcher(filter.query, filter.matchMode, filter.matchCase);

  const filtered = files.filter((file) => {
    if (filter.statuses.size > 0 && !filter.statuses.has(file.status)) return false;
    if (filter.commentedOnly && !(context.commentCounts?.get(file.path) ?? 0)) return false;
    if (filter.unviewedOnly && context.viewedPaths?.has(file.path)) return false;
    return matcher.matches(file.path);
  });

  return { files: filtered, error: matcher.error };
}

export function countByStatus(files: ChangedFile[]): Record<GitFileStatus, number> {
  const counts: Record<GitFileStatus, number> = {
    added: 0,
    modified: 0,
    deleted: 0,
    renamed: 0,
  };
  for (const file of files) counts[file.status]++;
  return counts;
}

export function toggleStatus(
  statuses: Set<GitFileStatus>,
  status: GitFileStatus,
): Set<GitFileStatus> {
  const next = new Set(statuses);
  if (next.has(status)) {
    next.delete(status);
  } else {
    next.add(status);
  }
  return next;
}

/** True when every supplied path is already marked viewed (false for none). */
export function allViewed(paths: string[], viewedPaths: Set<string>): boolean {
  return paths.length > 0 && paths.every((path) => viewedPaths.has(path));
}

export function isFilterActive(filter: FilterState): boolean {
  return (
    filter.query.length > 0 ||
    filter.statuses.size > 0 ||
    filter.commentedOnly ||
    filter.unviewedOnly
  );
}
