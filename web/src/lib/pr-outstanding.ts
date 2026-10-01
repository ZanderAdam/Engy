export interface OutstandingPrFacts {
  authoredByViewer: boolean;
  reviewDecision: string | null;
  ciStatus: string;
  attentionReason: string | null;
  reviewRequests: string[];
}

export function isPrOutstanding(pr: OutstandingPrFacts, viewerLogin: string | null): boolean {
  if (pr.authoredByViewer) {
    return (
      pr.reviewDecision === 'CHANGES_REQUESTED' ||
      pr.ciStatus === 'failing' ||
      pr.attentionReason !== null
    );
  }
  if (!viewerLogin) return false;
  const login = viewerLogin.toLowerCase();
  return pr.reviewRequests.some((requested) => requested.toLowerCase() === login);
}
