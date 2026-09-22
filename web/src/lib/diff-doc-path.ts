/**
 * Comment threads on a diff are keyed by `diff://<repoDir>#<branch>/<filePath>`,
 * so a review stays with the branch it was written against instead of following
 * the checkout into the next branch.
 *
 * The branch is percent-encoded: a branch name may contain `/`, and without the
 * encoding `feature/x/src/a.ts` could not be split back into branch and file.
 */
const SCHEME = 'diff://';

export function diffScopePrefix(repoDir: string, branch: string): string {
  return `${SCHEME}${repoDir}#${encodeURIComponent(branch)}/`;
}

export function diffDocPath(repoDir: string, branch: string, filePath: string): string {
  return `${diffScopePrefix(repoDir, branch)}${filePath}`;
}

interface ParsedDiffDocPath {
  repoDir: string;
  branch: string;
  /** Empty for the repo-wide review summary, which sits at the scope prefix. */
  filePath: string;
}

export function parseDiffDocPath(documentPath: string): ParsedDiffDocPath | null {
  if (!documentPath.startsWith(SCHEME)) return null;
  const rest = documentPath.slice(SCHEME.length);
  const hash = rest.indexOf('#');
  if (hash < 0) return null;
  const slash = rest.indexOf('/', hash);
  if (slash < 0) return null;
  return {
    repoDir: rest.slice(0, hash),
    branch: decodeURIComponent(rest.slice(hash + 1, slash)),
    filePath: rest.slice(slash + 1),
  };
}

export function diffDocFilePath(documentPath: string): string | null {
  const parsed = parseDiffDocPath(documentPath);
  if (!parsed) return null;
  return parsed.filePath || null;
}
