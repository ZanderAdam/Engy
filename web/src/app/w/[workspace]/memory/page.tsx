'use client';

import { useState } from 'react';
import { useVirtualParams } from '@/components/tabs/tab-context';
import { trpc } from '@/lib/trpc';
import { ThreePanelLayout } from '@/components/layout/three-panel-layout';
import { MemoryBrowser } from '@/components/memory/memory-browser';

const SIDEBAR_CONFIG = {
  defaultWidth: 320,
  minWidth: 240,
  maxWidth: 480,
  storageKey: 'engy-workspace-memory-sidebar-width',
} as const;

export default function MemoryPage() {
  const params = useVirtualParams<{ workspace: string }>();
  const [selectedMemoryId, setSelectedMemoryId] = useState<number | null>(null);

  const { data: workspace, isLoading } = trpc.workspace.get.useQuery({ slug: params.workspace });

  const repos: string[] = Array.isArray(workspace?.repos) ? (workspace.repos as string[]) : [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!workspace) return null;

  return (
    <ThreePanelLayout
      className="flex-1 min-h-0"
      left={SIDEBAR_CONFIG}
      leftContent={
        <MemoryBrowser
          workspaceSlug={params.workspace}
          repos={repos}
          selectedId={selectedMemoryId}
          onSelect={setSelectedMemoryId}
        />
      }
      centerContent={
        <div className="flex flex-1 items-center justify-center h-full">
          <p className="text-sm text-muted-foreground">
            {selectedMemoryId ? 'Loading memory…' : 'Select a memory to view'}
          </p>
        </div>
      }
    />
  );
}
