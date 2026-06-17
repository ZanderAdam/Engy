'use client';

import { useVirtualParams } from '@/components/tabs/tab-context';
import { MemoryWorkspaceView } from '@/components/memory/memory-workspace-view';

export default function ProjectMemoryPage() {
  const params = useVirtualParams<{ workspace: string; project: string }>();

  return (
    <MemoryWorkspaceView
      workspaceSlug={params.workspace}
      sidebarStorageKey="engy-project-memory-sidebar-width"
    />
  );
}
