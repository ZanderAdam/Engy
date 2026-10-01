'use client';

import { useVirtualParams, useVirtualSearchParams } from '@/components/tabs/tab-context';
import { ReviewPage } from '@/components/review/review-page';
import { reviewUrlParams } from '@/components/review/review-url-params';

export default function WorkspaceReviewRoute() {
  const params = useVirtualParams<{ workspace: string }>();
  const { repo, pr, project } = reviewUrlParams(useVirtualSearchParams());

  if (!repo || !pr) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 py-20">
        <p className="text-sm font-medium">No pull request selected</p>
        <p className="text-xs text-muted-foreground">
          Open a pull request from the Inbox or the PRs tab.
        </p>
      </div>
    );
  }

  return (
    <ReviewPage
      key={`${repo}#${pr}`}
      workspaceSlug={params.workspace}
      repoFullName={repo}
      prNumber={pr}
      projectSlug={project}
    />
  );
}
