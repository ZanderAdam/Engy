'use client';

import { useVirtualParams } from '@/components/tabs/tab-context';
import { UsagePage } from '@/components/usage/usage-page';

export default function ProjectUsageRoute() {
  const params = useVirtualParams<{ workspace: string; project: string }>();
  return <UsagePage workspaceSlug={params.workspace} projectSlug={params.project} />;
}
