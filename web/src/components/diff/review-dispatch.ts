import type { GitPatchSpec } from '@engy/common';

/** How the reviewing agent should reproduce the diff the reader is looking at. */
export function describePatchSpec(spec: GitPatchSpec): string {
  switch (spec.kind) {
    case 'staged':
      return 'staged changes (`git diff --cached`)';
    case 'unstaged':
      return 'unstaged working tree changes (`git diff`)';
    case 'commit':
      return `commit ${spec.hash} against its first parent (\`git show ${spec.hash}\`)`;
    case 'range':
      return spec.to
        ? `the range ${spec.from}..${spec.to} (\`git diff ${spec.from} ${spec.to}\`)`
        : `${spec.from} against the working tree (\`git diff ${spec.from}\`)`;
  }
}

export function buildReviewPrompt(repoDir: string, spec: GitPatchSpec): string {
  return [
    '/engy:review-diff',
    '',
    `repoDir: ${repoDir}`,
    `scope: ${describePatchSpec(spec)}`,
    '',
    `Write findings back with the diff_review_* MCP tools against repoDir ${repoDir}, so they appear on the diff I am reading.`,
  ].join('\n');
}
