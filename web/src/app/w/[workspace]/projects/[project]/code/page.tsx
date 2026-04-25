'use client';

import { useVirtualParams } from '@/components/tabs/tab-context';
import { CodePage } from '@/components/code/code-page';

export default function CodeRoute() {
  const params = useVirtualParams<{ workspace: string; project: string }>();
  return <CodePage workspaceSlug={params.workspace} />;
}
