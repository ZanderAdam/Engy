'use client';

import { useParams } from 'next/navigation';
import { DiffsPage } from '@/components/diff/diffs-page';

export default function DiffsRoute() {
  const params = useParams<{ workspace: string; project: string }>();
  return <DiffsPage workspaceSlug={params.workspace} projectSlug={params.project} />;
}
