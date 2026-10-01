'use client';

import { trpc } from '@/lib/trpc';
import { InboxView } from '@/components/inbox/inbox-view';

interface PrsPageProps {
  workspaceSlug: string;
}

export function PrsPage({ workspaceSlug }: PrsPageProps) {
  const { data: workspace } = trpc.workspace.get.useQuery({ slug: workspaceSlug });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {workspace && <InboxView workspaceId={workspace.id} />}
    </div>
  );
}
