import { commentOrigin } from './review-drafts';

interface ThreadControlsInput {
  comment: { source: string; githubDraft: boolean; resolved: boolean };
  onReviewPage: boolean;
  canResolveLocally: boolean;
}

interface ThreadControls {
  composer: boolean;
  githubResolveLabel: 'Resolve' | 'Unresolve' | null;
  localResolveLabel: 'Resolve' | 'Dismiss' | null;
  localOnlyBadge: boolean;
}

export function threadControls({
  comment,
  onReviewPage,
  canResolveLocally,
}: ThreadControlsInput): ThreadControls {
  const origin = commentOrigin(comment);
  const onGithub = origin === 'github' && onReviewPage;

  let githubResolveLabel: ThreadControls['githubResolveLabel'] = null;
  if (onGithub) githubResolveLabel = comment.resolved ? 'Unresolve' : 'Resolve';

  let localResolveLabel: ThreadControls['localResolveLabel'] = null;
  const canResolve = canResolveLocally && !comment.resolved && origin !== 'github-draft';
  if (!onGithub && canResolve) localResolveLabel = origin === 'github' ? 'Dismiss' : 'Resolve';

  return {
    composer: origin === 'engy' || onGithub,
    githubResolveLabel,
    localResolveLabel,
    localOnlyBadge: onReviewPage && origin === 'engy',
  };
}
