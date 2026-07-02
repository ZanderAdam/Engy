interface AttentionInfo {
  label: string;
  description: string;
}

export function getAttentionInfo(reason: string | null | undefined): AttentionInfo | null {
  if (!reason) return null;
  switch (reason) {
    case 'non-mechanical':
      return {
        label: 'CI failure needs manual attention',
        description:
          "The failing checks don't look mechanically fixable — review the failures and push a fix manually.",
      };
    case 'uncorrelated':
      return {
        label: 'No agent session for this branch',
        description:
          'No agent session is known for this branch — auto-fix requires an active session.',
      };
    case 'attempt-cap':
      return {
        label: 'Auto-fix attempts exhausted',
        description:
          'Auto-fix has run the maximum number of attempts for this commit — manual intervention required.',
      };
    case 'no-worktree':
      return {
        label: 'Agent session has no worktree to resume',
        description:
          'The correlated agent session has no worktree path — re-run the session with a worktree to enable auto-fix.',
      };
    default:
      return { label: 'CI failure needs attention', description: reason };
  }
}
