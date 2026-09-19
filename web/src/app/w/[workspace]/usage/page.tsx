'use client';

import { useVirtualParams } from '@/components/tabs/tab-context';
import { UsagePage } from '@/components/usage/usage-page';

export default function WorkspaceUsageRoute() {
  const params = useVirtualParams<{ workspace: string }>();
  return <UsagePage workspaceSlug={params.workspace} />;
}
