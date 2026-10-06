type ThreadMetadata = Record<string, unknown> | null | undefined;

export function isGithubDraft(metadata: ThreadMetadata): boolean {
  return metadata?.githubDraft === true && metadata.source === 'local';
}

export function toGithubSide(side: unknown): 'LEFT' | 'RIGHT' {
  return side === 'original' ? 'LEFT' : 'RIGHT';
}

export function isDraftOfPr(metadata: ThreadMetadata, prNumber: number): boolean {
  return isGithubDraft(metadata) && metadata?.prNumber === prNumber;
}
