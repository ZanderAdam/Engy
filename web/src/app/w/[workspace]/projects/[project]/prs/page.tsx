'use client';

import { useVirtualParams } from '@/components/tabs/tab-context';
import { PrsPage } from '@/components/prs/prs-page';

export default function PrsRoute() {
  const params = useVirtualParams<{ workspace: string }>();
  return <PrsPage workspaceSlug={params.workspace} />;
}
