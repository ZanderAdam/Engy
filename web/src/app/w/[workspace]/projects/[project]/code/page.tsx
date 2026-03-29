'use client';

import { useParams } from 'next/navigation';
import { CodePage } from '@/components/code/code-page';

export default function CodeRoute() {
  const params = useParams<{ workspace: string; project: string }>();
  return <CodePage workspaceSlug={params.workspace} />;
}
