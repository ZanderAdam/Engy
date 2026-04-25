'use client';

import { useVirtualParams } from '@/components/tabs/tab-context';
import { DiffsPage } from '@/components/diff/diffs-page';

export default function DiffsRoute() {
  const params = useVirtualParams<{ workspace: string; project: string }>();
  return <DiffsPage workspaceSlug={params.workspace} projectSlug={params.project} />;
}
